package notes

import (
	"errors"
	"fmt"
	"time"
)

var (
	errUnsupportedOperation = errors.New("unsupported operation type")
	errMissingNoteID        = errors.New("note identifier is required")
	errMissingUserID        = errors.New("user identifier is required")
)

func resolveChange(existing *Note, change ChangeRequest, appliedAt time.Time) (ConflictOutcome, error) {
	if change.NoteID == "" {
		return ConflictOutcome{}, errMissingNoteID
	}
	if change.UserID == "" {
		return ConflictOutcome{}, errMissingUserID
	}
	if change.Operation != OperationTypeUpsert && change.Operation != OperationTypeDelete {
		return ConflictOutcome{}, fmt.Errorf("%w: %s", errUnsupportedOperation, change.Operation)
	}

	stored := Note{
		UserID:            change.UserID,
		NoteID:            change.NoteID,
		CreatedAtSeconds:  change.CreatedAtSeconds,
		UpdatedAtSeconds:  0,
		PayloadJSON:       "",
		IsDeleted:         false,
		Version:           0,
		LastWriterDevice:  "",
		LastWriterEditSeq: 0,
	}

	if existing != nil {
		stored = *existing
	}

	serverEditSeq := stored.LastWriterEditSeq
	clientEditSeq := change.ClientEditSeq
	clientUpdatedAt := change.UpdatedAtSeconds
	serverUpdatedAt := stored.UpdatedAtSeconds

	acceptChange := false
	switch {
	case existing == nil:
		acceptChange = true
	case clientEditSeq > serverEditSeq:
		acceptChange = true
	case clientEditSeq < serverEditSeq:
		acceptChange = false
	default:
		if clientUpdatedAt > serverUpdatedAt {
			acceptChange = true
		} else if clientUpdatedAt < serverUpdatedAt {
			acceptChange = false
		} else {
			acceptChange = true
		}
	}

	if !acceptChange {
		copyStored := stored
		return ConflictOutcome{
			Accepted:    false,
			UpdatedNote: &copyStored,
			AuditRecord: nil,
		}, nil
	}

	updated := stored
	if updated.CreatedAtSeconds == 0 {
		if change.CreatedAtSeconds > 0 {
			updated.CreatedAtSeconds = change.CreatedAtSeconds
		} else if change.UpdatedAtSeconds > 0 {
			updated.CreatedAtSeconds = change.UpdatedAtSeconds
		} else {
			updated.CreatedAtSeconds = appliedAt.Unix()
		}
	}

	updated.LastWriterDevice = change.ClientDevice
	updated.LastWriterEditSeq = clientEditSeq
	if change.Operation == OperationTypeDelete {
		updated.IsDeleted = true
	} else if change.IsDeleted {
		updated.IsDeleted = true
	} else {
		updated.IsDeleted = false
		updated.PayloadJSON = change.PayloadJSON
	}

	if change.Operation == OperationTypeDelete && change.PayloadJSON == "" {
		updated.PayloadJSON = stored.PayloadJSON
	} else if change.PayloadJSON != "" {
		updated.PayloadJSON = change.PayloadJSON
	}

	if clientUpdatedAt > serverUpdatedAt {
		updated.UpdatedAtSeconds = clientUpdatedAt
	} else {
		updated.UpdatedAtSeconds = serverUpdatedAt
		if updated.UpdatedAtSeconds == 0 {
			updated.UpdatedAtSeconds = appliedAt.Unix()
		}
	}

	if updated.UpdatedAtSeconds < updated.CreatedAtSeconds {
		updated.CreatedAtSeconds = updated.UpdatedAtSeconds
	}

	nextVersion := stored.Version + 1
	if nextVersion <= 0 {
		nextVersion = 1
	}
	updated.Version = nextVersion

	prevVersion := stored.Version
	audit := &NoteChange{
		UserID:            updated.UserID,
		NoteID:            updated.NoteID,
		AppliedAtSeconds:  appliedAt.Unix(),
		ClientDevice:      change.ClientDevice,
		ClientTimeSeconds: change.ClientTimeSeconds,
		Operation:         change.Operation,
		PayloadJSON:       updated.PayloadJSON,
		PreviousVersion:   nil,
		NewVersion:        nil,
		ClientEditSeq:     clientEditSeq,
		ServerEditSeqSeen: serverEditSeq,
	}

	if prevVersion > 0 {
		audit.PreviousVersion = pointerTo(prevVersion)
	}
	audit.NewVersion = pointerTo(updated.Version)

	outcome := ConflictOutcome{
		Accepted:    true,
		UpdatedNote: &updated,
		AuditRecord: audit,
	}
	return outcome, nil
}

func pointerTo(value int64) *int64 {
	v := value
	return &v
}
