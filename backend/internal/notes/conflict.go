package notes

import "time"

func resolveChange(existing *Note, change ChangeEnvelope, appliedAt time.Time) (ConflictOutcome, error) {
	userID := change.UserID().String()
	noteID := change.NoteID().String()
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
