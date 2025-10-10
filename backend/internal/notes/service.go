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

func (s *Service) ApplyChanges(ctx context.Context, userID string, changes []ChangeRequest) (SyncResult, error) {
    if s.db == nil {
        return SyncResult{}, errMissingDatabase
    }
    if s.idProvider == nil {
        return SyncResult{}, errMissingIDProvider
    }
    if userID == "" {
        return SyncResult{}, errMissingUserID
    }

    result := SyncResult{ChangeOutcomes: make([]ChangeOutcome, 0, len(changes))}
    txErr := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
        for _, change := range changes {
            sanitized := change
            sanitized.UserID = userID

            if sanitized.NoteID == "" {
                return errMissingNoteID
            }

            if sanitized.CreatedAtSeconds == 0 {
                sanitized.CreatedAtSeconds = sanitized.ClientTimeSeconds
                if sanitized.CreatedAtSeconds == 0 {
                    sanitized.CreatedAtSeconds = s.clock().UTC().Unix()
                }
            }

            if sanitized.UpdatedAtSeconds == 0 {
                sanitized.UpdatedAtSeconds = sanitized.ClientTimeSeconds
                if sanitized.UpdatedAtSeconds == 0 {
                    sanitized.UpdatedAtSeconds = s.clock().UTC().Unix()
                }
            }

            var existing Note
            var existingPtr *Note
            err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
                Where("user_id = ? AND note_id = ?", userID, sanitized.NoteID).
                Take(&existing).Error
            if errors.Is(err, gorm.ErrRecordNotFound) {
                existingPtr = nil
            } else if err != nil {
                return err
            } else {
                existingPtr = &existing
            }

            appliedAt := s.clock().UTC()
            outcome, err := resolveChange(existingPtr, sanitized, appliedAt)
            if err != nil {
                return err
            }

            if outcome.Accepted {
                outcome.UpdatedNote.UserID = userID
                outcome.UpdatedNote.NoteID = sanitized.NoteID

                if err := tx.Save(outcome.UpdatedNote).Error; err != nil {
                    return err
                }

                if outcome.AuditRecord != nil {
                    changeID, err := s.idProvider.NewID()
                    if err != nil {
                        return err
                    }
                    outcome.AuditRecord.ChangeID = changeID
                    outcome.AuditRecord.UserID = userID
                    outcome.AuditRecord.NoteID = sanitized.NoteID
                    if err := tx.Create(outcome.AuditRecord).Error; err != nil {
                        return err
                    }
                }
            }

            result.ChangeOutcomes = append(result.ChangeOutcomes, ChangeOutcome{
                Request: sanitized,
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
