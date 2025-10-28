package notes

import (
	"testing"
	"time"
)

func TestResolveChangeAcceptsHigherEditSequence(t *testing.T) {
	userID := mustUserID(t, "user-1")
	noteID := mustNoteID(t, "note-1")
	existing := &Note{
		UserID:            userID.String(),
		NoteID:            noteID.String(),
		UpdatedAtSeconds:  1700000000,
		Version:           2,
		LastWriterEditSeq: 4,
		IsDeleted:         false,
		PayloadJSON:       `{"content":"stored"}`,
		LastWriterDevice:  "phone",
		CreatedAtSeconds:  1699990000,
	}
	change := ChangeRequest{
		UserID:            userID,
		NoteID:            noteID,
		Operation:         OperationTypeUpsert,
		ClientEditSeq:     5,
		ClientDevice:      "web",
		ClientTimeSeconds: mustTimestamp(t, 1700000500),
		CreatedAtSeconds:  mustTimestamp(t, 1700000400),
		UpdatedAtSeconds:  mustTimestamp(t, 1700000500),
		PayloadJSON:       `{"content":"incoming"}`,
	}

	outcome, err := resolveChange(existing, change, time.Unix(1700000600, 0).UTC())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if outcome.Accepted == false {
		t.Fatalf("expected change to be accepted")
	}
	if outcome.UpdatedNote.Version != 3 {
		t.Fatalf("expected version to increment to 3, got %d", outcome.UpdatedNote.Version)
	}
	if outcome.UpdatedNote.LastWriterEditSeq != 5 {
		t.Fatalf("expected last writer edit seq to update")
	}
	if outcome.UpdatedNote.LastWriterDevice != "web" {
		t.Fatalf("expected device to update")
	}
	if outcome.AuditRecord == nil {
		t.Fatalf("expected audit record")
	}
	if outcome.AuditRecord.Operation != OperationTypeUpsert {
		t.Fatalf("expected audit operation to be upsert")
	}
	if outcome.AuditRecord.PreviousVersion == nil || *outcome.AuditRecord.PreviousVersion != 2 {
		t.Fatalf("unexpected previous version pointer: %#v", outcome.AuditRecord.PreviousVersion)
	}
	if outcome.AuditRecord.NewVersion == nil || *outcome.AuditRecord.NewVersion != 3 {
		t.Fatalf("unexpected audit versions: %#v", outcome.AuditRecord)
	}
}

func TestResolveChangeRejectsLowerEditSequence(t *testing.T) {
	userID := mustUserID(t, "user-1")
	noteID := mustNoteID(t, "note-1")
	existing := &Note{
		UserID:            userID.String(),
		NoteID:            noteID.String(),
		UpdatedAtSeconds:  1700000000,
		Version:           6,
		LastWriterEditSeq: 10,
		PayloadJSON:       `{"content":"stored"}`,
	}
	change := ChangeRequest{
		UserID:            userID,
		NoteID:            noteID,
		Operation:         OperationTypeUpsert,
		ClientEditSeq:     8,
		ClientDevice:      "tablet",
		ClientTimeSeconds: mustTimestamp(t, 1700000001),
		CreatedAtSeconds:  mustTimestamp(t, 1699999000),
		UpdatedAtSeconds:  mustTimestamp(t, 1700000001),
		PayloadJSON:       `{"content":"incoming"}`,
	}

	outcome, err := resolveChange(existing, change, time.Unix(1700000600, 0).UTC())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if outcome.Accepted {
		t.Fatalf("expected change to be rejected")
	}
	if outcome.UpdatedNote.Version != 6 {
		t.Fatalf("existing note should remain unchanged on rejection")
	}
	if outcome.AuditRecord != nil {
		t.Fatalf("audit record should be nil when rejecting change")
	}
}

func TestResolveChangeBreaksTieByUpdatedAt(t *testing.T) {
	userID := mustUserID(t, "user-1")
	noteID := mustNoteID(t, "note-1")
	existing := &Note{
		UserID:            userID.String(),
		NoteID:            noteID.String(),
		UpdatedAtSeconds:  1700000000,
		Version:           4,
		LastWriterEditSeq: 7,
		PayloadJSON:       `{"content":"stored"}`,
	}

	tests := []struct {
		name              string
		clientUpdatedAt   int64
		expectAcceptance  bool
		expectedVersion   int64
		expectedEditSeq   int64
		expectedIsDeleted bool
	}{
		{
			name:             "client-newer",
			clientUpdatedAt:  1700000100,
			expectAcceptance: true,
			expectedVersion:  5,
			expectedEditSeq:  7,
		},
		{
			name:             "server-newer",
			clientUpdatedAt:  1699999990,
			expectAcceptance: false,
			expectedVersion:  4,
			expectedEditSeq:  7,
		},
		{
			name:             "equal-timestamp",
			clientUpdatedAt:  1700000000,
			expectAcceptance: true,
			expectedVersion:  5,
			expectedEditSeq:  7,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			change := ChangeRequest{
				UserID:            userID,
				NoteID:            noteID,
				Operation:         OperationTypeDelete,
				ClientEditSeq:     7,
				ClientDevice:      "wearable",
				ClientTimeSeconds: mustTimestamp(t, tt.clientUpdatedAt),
				CreatedAtSeconds:  mustTimestamp(t, 1699990000),
				UpdatedAtSeconds:  mustTimestamp(t, tt.clientUpdatedAt),
				PayloadJSON:       "",
			}
			outcome, err := resolveChange(existing, change, time.Unix(1700000600, 0).UTC())
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if outcome.Accepted != tt.expectAcceptance {
				t.Fatalf("acceptance mismatch, want %v got %v", tt.expectAcceptance, outcome.Accepted)
			}
			if outcome.UpdatedNote.Version != tt.expectedVersion {
				t.Fatalf("unexpected version %d", outcome.UpdatedNote.Version)
			}
			if outcome.UpdatedNote.LastWriterEditSeq != tt.expectedEditSeq {
				t.Fatalf("unexpected edit seq %d", outcome.UpdatedNote.LastWriterEditSeq)
			}
			if outcome.Accepted && change.Operation == OperationTypeDelete && outcome.UpdatedNote.IsDeleted != true {
				t.Fatalf("accepted delete should mark note as deleted")
			}
		})
	}
}

func mustUserID(t *testing.T, value string) UserID {
	t.Helper()
	id, err := NewUserID(value)
	if err != nil {
		t.Fatalf("unexpected user id error: %v", err)
	}
	return id
}

func mustNoteID(t *testing.T, value string) NoteID {
	t.Helper()
	id, err := NewNoteID(value)
	if err != nil {
		t.Fatalf("unexpected note id error: %v", err)
	}
	return id
}

func mustTimestamp(t *testing.T, value int64) UnixTimestamp {
	t.Helper()
	ts, err := NewUnixTimestamp(value)
	if err != nil {
		t.Fatalf("unexpected timestamp error: %v", err)
	}
	return ts
}
