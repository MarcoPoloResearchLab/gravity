package notes

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"

	"go.uber.org/zap"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	opApplyCrdtUpdates            = "notes.apply_crdt_updates"
	opListCrdtSnapshots           = "notes.list_crdt_snapshots"
	opListCrdtUpdates             = "notes.list_crdt_updates"
	fieldUserID                   = "user_id"
	fieldNoteID                   = "note_id"
	columnUpdateID                = "update_id"
	orderUpdateIDAsc              = columnUpdateID + " ASC"
	queryUserID                   = fieldUserID + " = ?"
	queryUserNote                 = fieldUserID + " = ? AND " + fieldNoteID + " = ?"
	queryUserNoteIn               = fieldUserID + " = ? AND " + fieldNoteID + " IN ?"
	queryUserNoteHash             = fieldUserID + " = ? AND " + fieldNoteID + " = ? AND update_hash = ?"
	reasonMissingDatabase         = "missing_database"
	reasonUpdateHashFailed        = "update_hash_failed"
	reasonUpdateInsertFailed      = "update_insert_failed"
	reasonUpdateLookupFailed      = "update_lookup_failed"
	reasonUpdateIDInvalid         = "update_id_invalid"
	reasonSnapshotUpsertFailed    = "snapshot_upsert_failed"
	reasonQueryFailed             = "query_failed"
	reasonSnapshotNoteInvalid     = "snapshot_note_invalid"
	reasonSnapshotPayloadInvalid  = "snapshot_payload_invalid"
	reasonSnapshotUpdateIDInvalid = "snapshot_update_id_invalid"
	reasonUpdateNoteInvalid       = "update_note_invalid"
	reasonUpdatePayloadInvalid    = "update_payload_invalid"
)

// CrdtUpdateOutcome captures the stored outcome for a CRDT update.
type CrdtUpdateOutcome struct {
	noteID    NoteID
	updateID  CrdtUpdateID
	duplicate bool
}

// NoteID returns the associated note identifier.
func (outcome CrdtUpdateOutcome) NoteID() NoteID {
	return outcome.noteID
}

// UpdateID returns the stored update identifier.
func (outcome CrdtUpdateOutcome) UpdateID() CrdtUpdateID {
	return outcome.updateID
}

// Duplicate reports whether the update was already stored.
func (outcome CrdtUpdateOutcome) Duplicate() bool {
	return outcome.duplicate
}

// CrdtSyncResult aggregates outcomes for applied CRDT updates.
type CrdtSyncResult struct {
	UpdateOutcomes []CrdtUpdateOutcome
}

// CrdtSnapshotRecord captures a stored snapshot entry.
type CrdtSnapshotRecord struct {
	noteID           NoteID
	snapshotB64      CrdtSnapshotBase64
	snapshotUpdateID CrdtUpdateID
}

// NoteID returns the snapshot note identifier.
func (record CrdtSnapshotRecord) NoteID() NoteID {
	return record.noteID
}

// SnapshotB64 returns the snapshot payload.
func (record CrdtSnapshotRecord) SnapshotB64() CrdtSnapshotBase64 {
	return record.snapshotB64
}

// SnapshotUpdateID returns the snapshot update identifier.
func (record CrdtSnapshotRecord) SnapshotUpdateID() CrdtUpdateID {
	return record.snapshotUpdateID
}

// CrdtUpdateRecord captures a CRDT update stored for replay.
type CrdtUpdateRecord struct {
	noteID    NoteID
	updateID  CrdtUpdateID
	updateB64 CrdtUpdateBase64
}

// NoteID returns the update note identifier.
func (record CrdtUpdateRecord) NoteID() NoteID {
	return record.noteID
}

// UpdateID returns the update identifier.
func (record CrdtUpdateRecord) UpdateID() CrdtUpdateID {
	return record.updateID
}

// UpdateB64 returns the update payload.
func (record CrdtUpdateRecord) UpdateB64() CrdtUpdateBase64 {
	return record.updateB64
}

// ApplyCrdtUpdates persists CRDT updates and snapshots.
func (service *Service) ApplyCrdtUpdates(ctx context.Context, userID UserID, updates []CrdtUpdateEnvelope) (CrdtSyncResult, error) {
	if service.db == nil {
		service.logError(opApplyCrdtUpdates, reasonMissingDatabase, errMissingDatabase)
		return CrdtSyncResult{}, newServiceError(opApplyCrdtUpdates, reasonMissingDatabase, errMissingDatabase)
	}

	result := CrdtSyncResult{UpdateOutcomes: make([]CrdtUpdateOutcome, 0, len(updates))}
	if len(updates) == 0 {
		return result, nil
	}

	transactionError := service.db.WithContext(ctx).Transaction(func(transaction *gorm.DB) error {
		for _, update := range updates {
			updateHash, hashErr := hashCrdtPayload(update.UpdateB64().String())
			if hashErr != nil {
				service.logError(opApplyCrdtUpdates, reasonUpdateHashFailed, hashErr,
					zap.String(fieldUserID, userID.String()),
					zap.String(fieldNoteID, update.NoteID().String()))
				return newServiceError(opApplyCrdtUpdates, reasonUpdateHashFailed, hashErr)
			}

			appliedAtSeconds := service.clock().UTC().Unix()
			model := CrdtUpdate{
				UserID:           userID.String(),
				NoteID:           update.NoteID().String(),
				UpdateB64:        update.UpdateB64().String(),
				UpdateHash:       updateHash,
				AppliedAtSeconds: appliedAtSeconds,
			}
			createResult := transaction.Clauses(clause.OnConflict{DoNothing: true}).Create(&model)
			if createResult.Error != nil {
				service.logError(opApplyCrdtUpdates, reasonUpdateInsertFailed, createResult.Error,
					zap.String(fieldUserID, userID.String()),
					zap.String(fieldNoteID, update.NoteID().String()))
				return newServiceError(opApplyCrdtUpdates, reasonUpdateInsertFailed, createResult.Error)
			}

			duplicate := createResult.RowsAffected == 0
			updateID := model.UpdateID
			if duplicate {
				var existing CrdtUpdate
				err := transaction.Select(columnUpdateID).
					Where(queryUserNoteHash, userID.String(), update.NoteID().String(), updateHash).
					Take(&existing).Error
				if err != nil {
					service.logError(opApplyCrdtUpdates, reasonUpdateLookupFailed, err,
						zap.String(fieldUserID, userID.String()),
						zap.String(fieldNoteID, update.NoteID().String()))
					return newServiceError(opApplyCrdtUpdates, reasonUpdateLookupFailed, err)
				}
				updateID = existing.UpdateID
			}

			updateIDDomain, idErr := NewCrdtUpdateID(updateID)
			if idErr != nil {
				service.logError(opApplyCrdtUpdates, reasonUpdateIDInvalid, idErr,
					zap.String(fieldUserID, userID.String()),
					zap.String(fieldNoteID, update.NoteID().String()))
				return newServiceError(opApplyCrdtUpdates, reasonUpdateIDInvalid, idErr)
			}

			outcome := CrdtUpdateOutcome{
				noteID:    update.NoteID(),
				updateID:  updateIDDomain,
				duplicate: duplicate,
			}
			result.UpdateOutcomes = append(result.UpdateOutcomes, outcome)

			snapshotUpdateID := update.SnapshotUpdateID().Int64()
			if snapshotUpdateID > updateID {
				snapshotUpdateID = updateID
			}
			allowEqualSnapshotUpdateID := !duplicate
			if snapshotErr := service.upsertCrdtSnapshot(transaction, userID, update.NoteID(), update.SnapshotB64(), snapshotUpdateID, allowEqualSnapshotUpdateID); snapshotErr != nil {
				service.logError(opApplyCrdtUpdates, reasonSnapshotUpsertFailed, snapshotErr,
					zap.String(fieldUserID, userID.String()),
					zap.String(fieldNoteID, update.NoteID().String()))
				return newServiceError(opApplyCrdtUpdates, reasonSnapshotUpsertFailed, snapshotErr)
			}
		}
		return nil
	})

	if transactionError != nil {
		return CrdtSyncResult{}, transactionError
	}
	return result, nil
}

// ListCrdtSnapshots returns stored CRDT snapshots for a user.
func (service *Service) ListCrdtSnapshots(ctx context.Context, userID UserID) ([]CrdtSnapshotRecord, error) {
	if service.db == nil {
		service.logError(opListCrdtSnapshots, reasonMissingDatabase, errMissingDatabase)
		return nil, newServiceError(opListCrdtSnapshots, reasonMissingDatabase, errMissingDatabase)
	}

	var snapshots []CrdtSnapshot
	if err := service.db.WithContext(ctx).
		Where(queryUserID, userID.String()).
		Find(&snapshots).Error; err != nil {
		service.logError(opListCrdtSnapshots, reasonQueryFailed, err, zap.String(fieldUserID, userID.String()))
		return nil, newServiceError(opListCrdtSnapshots, reasonQueryFailed, err)
	}

	records := make([]CrdtSnapshotRecord, 0, len(snapshots))
	for _, snapshot := range snapshots {
		noteID, noteErr := NewNoteID(snapshot.NoteID)
		if noteErr != nil {
			service.logError(opListCrdtSnapshots, reasonSnapshotNoteInvalid, noteErr, zap.String(fieldNoteID, snapshot.NoteID))
			return nil, newServiceError(opListCrdtSnapshots, reasonSnapshotNoteInvalid, noteErr)
		}
		snapshotB64, snapErr := NewCrdtSnapshotBase64(snapshot.SnapshotB64)
		if snapErr != nil {
			service.logError(opListCrdtSnapshots, reasonSnapshotPayloadInvalid, snapErr, zap.String(fieldNoteID, snapshot.NoteID))
			return nil, newServiceError(opListCrdtSnapshots, reasonSnapshotPayloadInvalid, snapErr)
		}
		snapshotUpdateID, idErr := NewCrdtUpdateID(snapshot.SnapshotUpdateID)
		if idErr != nil {
			service.logError(opListCrdtSnapshots, reasonSnapshotUpdateIDInvalid, idErr, zap.String(fieldNoteID, snapshot.NoteID))
			return nil, newServiceError(opListCrdtSnapshots, reasonSnapshotUpdateIDInvalid, idErr)
		}
		records = append(records, CrdtSnapshotRecord{
			noteID:           noteID,
			snapshotB64:      snapshotB64,
			snapshotUpdateID: snapshotUpdateID,
		})
	}
	return records, nil
}

// ListCrdtUpdates returns updates after the provided cursors.
func (service *Service) ListCrdtUpdates(ctx context.Context, userID UserID, cursors []CrdtCursor) ([]CrdtUpdateRecord, error) {
	if service.db == nil {
		service.logError(opListCrdtUpdates, reasonMissingDatabase, errMissingDatabase)
		return nil, newServiceError(opListCrdtUpdates, reasonMissingDatabase, errMissingDatabase)
	}
	if len(cursors) == 0 {
		return nil, nil
	}

	cursorByNoteID := make(map[string]int64, len(cursors))
	noteIDs := make([]string, 0, len(cursors))
	for _, cursor := range cursors {
		noteID := cursor.NoteID().String()
		cursorByNoteID[noteID] = cursor.LastUpdateID().Int64()
		noteIDs = append(noteIDs, noteID)
	}

	var updates []CrdtUpdate
	if err := service.db.WithContext(ctx).
		Where(queryUserNoteIn, userID.String(), noteIDs).
		Order(orderUpdateIDAsc).
		Find(&updates).Error; err != nil {
		service.logError(opListCrdtUpdates, reasonQueryFailed, err, zap.String(fieldUserID, userID.String()))
		return nil, newServiceError(opListCrdtUpdates, reasonQueryFailed, err)
	}

	records := make([]CrdtUpdateRecord, 0, len(updates))
	for _, update := range updates {
		lastSeen, ok := cursorByNoteID[update.NoteID]
		if !ok {
			continue
		}
		if update.UpdateID <= lastSeen {
			continue
		}

		noteID, noteErr := NewNoteID(update.NoteID)
		if noteErr != nil {
			service.logError(opListCrdtUpdates, reasonUpdateNoteInvalid, noteErr, zap.String(fieldNoteID, update.NoteID))
			return nil, newServiceError(opListCrdtUpdates, reasonUpdateNoteInvalid, noteErr)
		}
		updateID, idErr := NewCrdtUpdateID(update.UpdateID)
		if idErr != nil {
			service.logError(opListCrdtUpdates, reasonUpdateIDInvalid, idErr, zap.String(fieldNoteID, update.NoteID))
			return nil, newServiceError(opListCrdtUpdates, reasonUpdateIDInvalid, idErr)
		}
		updateB64, updateErr := NewCrdtUpdateBase64(update.UpdateB64)
		if updateErr != nil {
			service.logError(opListCrdtUpdates, reasonUpdatePayloadInvalid, updateErr, zap.String(fieldNoteID, update.NoteID))
			return nil, newServiceError(opListCrdtUpdates, reasonUpdatePayloadInvalid, updateErr)
		}
		records = append(records, CrdtUpdateRecord{
			noteID:    noteID,
			updateID:  updateID,
			updateB64: updateB64,
		})
	}
	return records, nil
}

func (service *Service) upsertCrdtSnapshot(transaction *gorm.DB, userID UserID, noteID NoteID, snapshot CrdtSnapshotBase64, snapshotUpdateID int64, allowEqualSnapshotUpdateID bool) error {
	var existing CrdtSnapshot
	err := transaction.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(queryUserNote, userID.String(), noteID.String()).
		Take(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		snapshotValue := snapshot.String()
		return transaction.Create(&CrdtSnapshot{
			UserID:           userID.String(),
			NoteID:           noteID.String(),
			SnapshotB64:      snapshotValue,
			SnapshotUpdateID: snapshotUpdateID,
		}).Error
	}
	if err != nil {
		return err
	}
	if snapshotUpdateID < existing.SnapshotUpdateID {
		return nil
	}
	snapshotValue := snapshot.String()
	if snapshotUpdateID == existing.SnapshotUpdateID {
		incomingHash, hashErr := hashCrdtPayload(snapshotValue)
		if hashErr != nil {
			return hashErr
		}
		existingHash, existingHashErr := hashCrdtPayload(existing.SnapshotB64)
		if existingHashErr != nil {
			return existingHashErr
		}
		if incomingHash == existingHash {
			return nil
		}
		if !allowEqualSnapshotUpdateID {
			return nil
		}
		existing.SnapshotB64 = snapshotValue
		return transaction.Save(&existing).Error
	}
	existing.SnapshotB64 = snapshotValue
	existing.SnapshotUpdateID = snapshotUpdateID
	return transaction.Save(&existing).Error
}

func hashCrdtPayload(payload string) (string, error) {
	rawBytes, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(rawBytes)
	return hex.EncodeToString(sum[:]), nil
}
