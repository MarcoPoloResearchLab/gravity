package notes

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	errMissingDatabase   = errors.New("database handle is required")
	errMissingIDProvider = errors.New("id provider is required")
	errMissingUserID     = errors.New("user identifier is required")
)

type ServiceError struct {
	code string
	err  error
}

func (e *ServiceError) Error() string {
	if e.err == nil {
		return e.code
	}
	return fmt.Sprintf("%s: %v", e.code, e.err)
}

func (e *ServiceError) Unwrap() error {
	return e.err
}

func (e *ServiceError) Code() string {
	return e.code
}

const (
	opServiceNew   = "notes.service.new"
	opApplyChanges = "notes.apply_changes"
	opListNotes    = "notes.list_notes"
)

func newServiceError(operation, reason string, cause error) error {
	code := fmt.Sprintf("%s.%s", operation, reason)
	return &ServiceError{code: code, err: cause}
}

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

func NewService(cfg ServiceConfig) (*Service, error) {
	if cfg.Database == nil {
		return nil, newServiceError(opServiceNew, "missing_database", errMissingDatabase)
	}

	clock := cfg.Clock
	if clock == nil {
		clock = time.Now
	}

	if cfg.IDProvider == nil {
		return nil, newServiceError(opServiceNew, "missing_id_provider", errMissingIDProvider)
	}

	return &Service{
		db:         cfg.Database,
		clock:      clock,
		idProvider: cfg.IDProvider,
	}, nil
}

type ChangeOutcome struct {
	Envelope ChangeEnvelope
	Outcome  ConflictOutcome
}

type SyncResult struct {
	ChangeOutcomes []ChangeOutcome
}

func (s *Service) ApplyChanges(ctx context.Context, userID UserID, changes []ChangeEnvelope) (SyncResult, error) {
	if s.db == nil {
		return SyncResult{}, newServiceError(opApplyChanges, "missing_database", errMissingDatabase)
	}
	if s.idProvider == nil {
		return SyncResult{}, newServiceError(opApplyChanges, "missing_id_provider", errMissingIDProvider)
	}

	result := SyncResult{ChangeOutcomes: make([]ChangeOutcome, 0, len(changes))}
	txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, change := range changes {
			var existing Note
			var existingPtr *Note
			err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("user_id = ? AND note_id = ?", userID.String(), change.NoteID().String()).
				Take(&existing).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				existingPtr = nil
			} else if err != nil {
				return newServiceError(opApplyChanges, "note_select_failed", err)
			} else {
				existingPtr = &existing
			}

			appliedAt := s.clock().UTC()
			outcome, err := resolveChange(existingPtr, change, appliedAt)
			if err != nil {
				return newServiceError(opApplyChanges, "resolve_change_failed", err)
			}

			if outcome.Accepted {
				outcome.UpdatedNote.UserID = userID.String()
				outcome.UpdatedNote.NoteID = change.NoteID().String()

				if err := tx.Save(outcome.UpdatedNote).Error; err != nil {
					return newServiceError(opApplyChanges, "note_save_failed", err)
				}

				if outcome.AuditRecord != nil {
					changeID, err := s.idProvider.NewID()
					if err != nil {
						return newServiceError(opApplyChanges, "id_generation_failed", err)
					}
					outcome.AuditRecord.ChangeID = changeID
					outcome.AuditRecord.UserID = userID.String()
					outcome.AuditRecord.NoteID = change.NoteID().String()
					if err := tx.Create(outcome.AuditRecord).Error; err != nil {
						return newServiceError(opApplyChanges, "audit_insert_failed", err)
					}
				}
			}

			result.ChangeOutcomes = append(result.ChangeOutcomes, ChangeOutcome{
				Envelope: change,
				Outcome:  outcome,
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
		return nil, newServiceError(opListNotes, "missing_database", errMissingDatabase)
	}
	if userID == "" {
		return nil, newServiceError(opListNotes, "missing_user_id", errMissingUserID)
	}

	var notes []Note
	if err := s.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("updated_at_s DESC").
		Find(&notes).Error; err != nil {
		return nil, newServiceError(opListNotes, "query_failed", err)
	}

	return notes, nil
}
