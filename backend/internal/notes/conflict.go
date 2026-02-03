package notes

import "time"

func resolveChange(existing *Note, change ChangeEnvelope, appliedAt time.Time) (ConflictOutcome, error) {
	userID := change.UserID().String()
	noteID := change.NoteID().String()
	baseVersion := change.BaseVersion().Int64()
	clientEditSeq := change.ClientEditSeq()
	clientUpdatedAt := change.UpdatedAt().Int64()

	stored := Note{
		UserID:            userID,
		NoteID:            noteID,
		CreatedAtSeconds:  change.CreatedAt().Int64(),
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
	serverUpdatedAt := stored.UpdatedAtSeconds

	if existing == nil && baseVersion > 0 {
		copyStored := stored
		return ConflictOutcome{
			Accepted:    false,
			UpdatedNote: &copyStored,
			AuditRecord: nil,
		}, nil
	}

	if existing != nil && baseVersion != stored.Version {
		if changeMatchesStored(stored, change) {
			copyStored := stored
			return ConflictOutcome{
				Accepted:    true,
				UpdatedNote: &copyStored,
				AuditRecord: nil,
			}, nil
		}
		copyStored := stored
		return ConflictOutcome{
			Accepted:    false,
			UpdatedNote: &copyStored,
			AuditRecord: nil,
		}, nil
	}

	if existing != nil && changeMatchesStored(stored, change) {
		copyStored := stored
		return ConflictOutcome{
			Accepted:    true,
			UpdatedNote: &copyStored,
			AuditRecord: nil,
		}, nil
	}

	updated := stored
	if updated.CreatedAtSeconds == 0 {
		if change.CreatedAt().Int64() > 0 {
			updated.CreatedAtSeconds = change.CreatedAt().Int64()
		} else if change.UpdatedAt().Int64() > 0 {
			updated.CreatedAtSeconds = change.UpdatedAt().Int64()
		} else {
			updated.CreatedAtSeconds = appliedAt.Unix()
		}
	}

	updated.LastWriterDevice = change.ClientDevice()
	updated.LastWriterEditSeq = clientEditSeq
	if change.Operation() == OperationTypeDelete {
		updated.IsDeleted = true
	} else if change.IsDeleted() {
		updated.IsDeleted = true
	} else {
		updated.IsDeleted = false
		updated.PayloadJSON = change.Payload()
	}

	if change.Operation() == OperationTypeDelete && change.Payload() == "" {
		updated.PayloadJSON = stored.PayloadJSON
	} else if change.Payload() != "" {
		updated.PayloadJSON = change.Payload()
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
		ClientDevice:      change.ClientDevice(),
		ClientTimeSeconds: change.ClientTimestamp().Int64(),
		Operation:         change.Operation(),
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

func changeMatchesStored(stored Note, change ChangeEnvelope) bool {
	incomingIsDeleted := change.Operation() == OperationTypeDelete || change.IsDeleted()
	if incomingIsDeleted != stored.IsDeleted {
		return false
	}
	if incomingIsDeleted {
		if change.Payload() == "" {
			return true
		}
		return change.Payload() == stored.PayloadJSON
	}
	return change.Payload() == stored.PayloadJSON
}
