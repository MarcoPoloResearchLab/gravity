package notes

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	errMissingDatabase   = errors.New("database handle is required")
	errMissingIDProvider = errors.New("id provider is required")
	errMissingUserID     = errors.New("user identifier is required")
)

type ServiceConfig struct {
	Database   *gorm.DB
	Clock      func() time.Time
	IDProvider IDProvider
}

type IDProvider interface {
	NewID() (string, error)
}

type Service struct {
	db         *gorm.DB
	clock      func() time.Time
	idProvider IDProvider
}

func NewService(cfg ServiceConfig) *Service {
	clock := cfg.Clock
	if clock == nil {
		clock = time.Now
	}

	provider := cfg.IDProvider
	if provider == nil {
		provider = newUUIDProvider()
	}

	return &Service{
		db:         cfg.Database,
		clock:      clock,
		idProvider: provider,
	}
}

type ChangeOutcome struct {
	Request ChangeRequest
	Outcome ConflictOutcome
}

type SyncResult struct {
	ChangeOutcomes []ChangeOutcome
}

func (s *Service) ApplyChanges(ctx context.Context, userID UserID, changes []ChangeRequest) (SyncResult, error) {
	if s.db == nil {
		return SyncResult{}, errMissingDatabase
	}
	if s.idProvider == nil {
		return SyncResult{}, errMissingIDProvider
	}

	result := SyncResult{ChangeOutcomes: make([]ChangeOutcome, 0, len(changes))}
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, change := range changes {
			prepared := change
			prepared.UserID = userID

			var existing Note
			var existingPtr *Note
			err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("user_id = ? AND note_id = ?", userID.String(), prepared.NoteID.String()).
				Take(&existing).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				existingPtr = nil
			} else if err != nil {
				return err
			} else {
				existingPtr = &existing
			}

			appliedAt := s.clock().UTC()
			outcome, err := resolveChange(existingPtr, prepared, appliedAt)
			if err != nil {
				return err
			}

			if outcome.Accepted {
				outcome.UpdatedNote.UserID = userID.String()
				outcome.UpdatedNote.NoteID = prepared.NoteID.String()

				if err := tx.Save(outcome.UpdatedNote).Error; err != nil {
					return err
				}

				if outcome.AuditRecord != nil {
					changeID, err := s.idProvider.NewID()
					if err != nil {
						return err
					}
					outcome.AuditRecord.ChangeID = changeID
					outcome.AuditRecord.UserID = userID.String()
					outcome.AuditRecord.NoteID = prepared.NoteID.String()
					if err := tx.Create(outcome.AuditRecord).Error; err != nil {
						return err
					}
				}
			}

			result.ChangeOutcomes = append(result.ChangeOutcomes, ChangeOutcome{
				Request: prepared,
				Outcome: outcome,
			})
		}
		return nil
	})

	if txErr != nil {
		return SyncResult{}, txErr
	}

	return result, nil
}

// ListNotes returns all persisted notes for the provided user identifier.
func (s *Service) ListNotes(ctx context.Context, userID string) ([]Note, error) {
	if s.db == nil {
		return nil, errMissingDatabase
	}
	if userID == "" {
		return nil, errMissingUserID
	}

	var notes []Note
	if err := s.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("updated_at_s DESC").
		Find(&notes).Error; err != nil {
		return nil, err
	}

	return notes, nil
}
