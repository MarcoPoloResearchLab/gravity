package notes

import (
	"context"
	"errors"
	"testing"
	"time"

	"gorm.io/gorm"
)

func TestResolveChangeAcceptsMatchingBaseVersion(t *testing.T) {
	userID := mustUserID(t, "user-1")
	noteID := mustNoteID(t, "note-1")
	existing := &Note{
		UserID:            userID.String(),
		NoteID:            noteID.String(),
		UpdatedAtSeconds:  1700000000,
		Version:           2,
		LastWriterEditSeq: 4,
		IsDeleted:         false,
		PayloadJSON:       `{"noteId":"note-1","markdownText":"stored"}`,
		LastWriterDevice:  "phone",
		CreatedAtSeconds:  1699990000,
	}
	change := mustEnvelope(t, ChangeEnvelopeConfig{
		UserID:          userID,
		NoteID:          noteID,
		Operation:       OperationTypeUpsert,
		BaseVersion:     mustNoteVersion(t, 2),
		ClientEditSeq:   5,
		ClientDevice:    "web",
		ClientTimestamp: mustTimestamp(t, 1700000500),
		CreatedAt:       mustTimestamp(t, 1700000400),
		UpdatedAt:       mustTimestamp(t, 1700000500),
		PayloadJSON:     `{"noteId":"note-1","markdownText":"incoming"}`,
	})

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

func TestResolveChangeRejectsStaleBaseVersion(t *testing.T) {
	userID := mustUserID(t, "user-1")
	noteID := mustNoteID(t, "note-1")
	existing := &Note{
		UserID:            userID.String(),
		NoteID:            noteID.String(),
		UpdatedAtSeconds:  1700000000,
		Version:           6,
		LastWriterEditSeq: 10,
		PayloadJSON:       `{"noteId":"note-1","markdownText":"stored"}`,
	}
	change := mustEnvelope(t, ChangeEnvelopeConfig{
		UserID:          userID,
		NoteID:          noteID,
		Operation:       OperationTypeUpsert,
		BaseVersion:     mustNoteVersion(t, 5),
		ClientEditSeq:   12,
		ClientDevice:    "tablet",
		ClientTimestamp: mustTimestamp(t, 1700000001),
		CreatedAt:       mustTimestamp(t, 1699999000),
		UpdatedAt:       mustTimestamp(t, 1700000001),
		PayloadJSON:     `{"noteId":"note-1","markdownText":"incoming"}`,
	})

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

func TestResolveChangeAcceptsNoOpWithoutVersionBump(t *testing.T) {
	userID := mustUserID(t, "user-1")
	noteID := mustNoteID(t, "note-1")
	existing := &Note{
		UserID:            userID.String(),
		NoteID:            noteID.String(),
		UpdatedAtSeconds:  1700000000,
		Version:           4,
		LastWriterEditSeq: 7,
		PayloadJSON:       `{"noteId":"note-1","markdownText":"stored"}`,
	}
	change := mustEnvelope(t, ChangeEnvelopeConfig{
		UserID:          userID,
		NoteID:          noteID,
		Operation:       OperationTypeUpsert,
		BaseVersion:     mustNoteVersion(t, 4),
		ClientEditSeq:   9,
		ClientDevice:    "wearable",
		ClientTimestamp: mustTimestamp(t, 1700000100),
		CreatedAt:       mustTimestamp(t, 1699990000),
		UpdatedAt:       mustTimestamp(t, 1700000100),
		PayloadJSON:     `{"noteId":"note-1","markdownText":"stored"}`,
	})
	outcome, err := resolveChange(existing, change, time.Unix(1700000600, 0).UTC())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if outcome.Accepted == false {
		t.Fatalf("expected change to be accepted")
	}
	if outcome.UpdatedNote.Version != 4 {
		t.Fatalf("expected version to remain 4, got %d", outcome.UpdatedNote.Version)
	}
	if outcome.AuditRecord != nil {
		t.Fatalf("expected no audit record for no-op change")
	}
}

func TestResolveChangeAcceptsDuplicatePayloadWhenVersionMismatch(t *testing.T) {
	userID := mustUserID(t, "user-1")
	noteID := mustNoteID(t, "note-1")
	existing := &Note{
		UserID:            userID.String(),
		NoteID:            noteID.String(),
		UpdatedAtSeconds:  1700000000,
		Version:           4,
		LastWriterEditSeq: 7,
		PayloadJSON:       `{"noteId":"note-1","markdownText":"stored"}`,
	}
	change := mustEnvelope(t, ChangeEnvelopeConfig{
		UserID:          userID,
		NoteID:          noteID,
		Operation:       OperationTypeUpsert,
		BaseVersion:     mustNoteVersion(t, 3),
		ClientEditSeq:   7,
		ClientDevice:    "tablet",
		ClientTimestamp: mustTimestamp(t, 1700000100),
		CreatedAt:       mustTimestamp(t, 1699990000),
		UpdatedAt:       mustTimestamp(t, 1700000100),
		PayloadJSON:     `{"noteId":"note-1","markdownText":"stored"}`,
	})
	outcome, err := resolveChange(existing, change, time.Unix(1700000600, 0).UTC())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if outcome.Accepted == false {
		t.Fatalf("expected duplicate payload to be accepted")
	}
	if outcome.UpdatedNote.Version != 4 {
		t.Fatalf("expected version to remain 4, got %d", outcome.UpdatedNote.Version)
	}
	if outcome.AuditRecord != nil {
		t.Fatalf("expected no audit record for duplicate payload")
	}
}

func TestNewChangeEnvelopeInvalidCases(t *testing.T) {
	baseConfig := ChangeEnvelopeConfig{
		UserID:          mustUserID(t, "user-1"),
		NoteID:          mustNoteID(t, "note-1"),
		Operation:       OperationTypeUpsert,
		BaseVersion:     mustNoteVersion(t, 0),
		ClientEditSeq:   1,
		ClientDevice:    "device",
		ClientTimestamp: mustTimestamp(t, 1700000000),
		CreatedAt:       mustTimestamp(t, 1700000000),
		UpdatedAt:       mustTimestamp(t, 1700000000),
		PayloadJSON:     `{"noteId":"note-1","markdownText":"body"}`,
	}

	testCases := []struct {
		name   string
		mutate func(*ChangeEnvelopeConfig)
	}{
		{
			name: "empty-user",
			mutate: func(cfg *ChangeEnvelopeConfig) {
				cfg.UserID = ""
			},
		},
		{
			name: "empty-note",
			mutate: func(cfg *ChangeEnvelopeConfig) {
				cfg.NoteID = ""
			},
		},
		{
			name: "unsupported-operation",
			mutate: func(cfg *ChangeEnvelopeConfig) {
				cfg.Operation = OperationType("truncate")
			},
		},
		{
			name: "negative-edit-seq",
			mutate: func(cfg *ChangeEnvelopeConfig) {
				cfg.ClientEditSeq = -1
			},
		},
		{
			name: "negative-base-version",
			mutate: func(cfg *ChangeEnvelopeConfig) {
				cfg.BaseVersion = NoteVersion(-1)
			},
		},
		{
			name: "empty-payload",
			mutate: func(cfg *ChangeEnvelopeConfig) {
				cfg.PayloadJSON = ""
			},
		},
		{
			name: "invalid-payload-json",
			mutate: func(cfg *ChangeEnvelopeConfig) {
				cfg.PayloadJSON = "not-json"
			},
		},
		{
			name: "payload-missing-note-id",
			mutate: func(cfg *ChangeEnvelopeConfig) {
				cfg.PayloadJSON = `{"markdownText":"body"}`
			},
		},
		{
			name: "payload-missing-markdown",
			mutate: func(cfg *ChangeEnvelopeConfig) {
				cfg.PayloadJSON = `{"noteId":"note-1"}`
			},
		},
		{
			name: "payload-note-id-mismatch",
			mutate: func(cfg *ChangeEnvelopeConfig) {
				cfg.PayloadJSON = `{"noteId":"note-2","markdownText":"body"}`
			},
		},
		{
			name: "delete-invalid-payload",
			mutate: func(cfg *ChangeEnvelopeConfig) {
				cfg.Operation = OperationTypeDelete
				cfg.PayloadJSON = "invalid"
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := baseConfig
			tc.mutate(&cfg)
			_, err := NewChangeEnvelope(cfg)
			if !errors.Is(err, ErrInvalidChange) {
				t.Fatalf("expected invalid change error, got %v", err)
			}
		})
	}
}

func TestNewServiceRequiresDatabase(t *testing.T) {
	_, err := NewService(ServiceConfig{IDProvider: stubIDProvider{}})
	if !errors.Is(err, errMissingDatabase) {
		t.Fatalf("expected missing database error, got %v", err)
	}
}

func TestNewServiceRequiresIDProvider(t *testing.T) {
	_, err := NewService(ServiceConfig{Database: &gorm.DB{}})
	if !errors.Is(err, errMissingIDProvider) {
		t.Fatalf("expected missing id provider error, got %v", err)
	}
}

type stubIDProvider struct{}

func (stubIDProvider) NewID() (string, error) {
	return "stub-id", nil
}

func TestApplyChangesWrapsMissingDatabase(t *testing.T) {
	service := &Service{}
	_, err := service.ApplyChanges(context.Background(), mustUserID(t, "user-1"), nil)
	if err == nil {
		t.Fatal("expected error from missing database")
	}
	var serviceErr *ServiceError
	if !errors.As(err, &serviceErr) {
		t.Fatalf("expected ServiceError, got %T", err)
	}
	if serviceErr.Code() != "notes.apply_changes.missing_database" {
		t.Fatalf("unexpected service error code: %s", serviceErr.Code())
	}
	if !errors.Is(err, errMissingDatabase) {
		t.Fatalf("expected underlying missing database error, got %v", err)
	}
}

func TestApplyChangesWrapsMissingIDProvider(t *testing.T) {
	service := &Service{db: &gorm.DB{}}
	_, err := service.ApplyChanges(context.Background(), mustUserID(t, "user-1"), nil)
	if err == nil {
		t.Fatal("expected error from missing id provider")
	}
	var serviceErr *ServiceError
	if !errors.As(err, &serviceErr) {
		t.Fatalf("expected ServiceError, got %T", err)
	}
	if serviceErr.Code() != "notes.apply_changes.missing_id_provider" {
		t.Fatalf("unexpected service error code: %s", serviceErr.Code())
	}
	if !errors.Is(err, errMissingIDProvider) {
		t.Fatalf("expected underlying missing id provider error, got %v", err)
	}
}

func TestListNotesWrapsMissingDatabase(t *testing.T) {
	service := &Service{}
	_, err := service.ListNotes(context.Background(), "user-1")
	if err == nil {
		t.Fatal("expected error from missing database")
	}
	var serviceErr *ServiceError
	if !errors.As(err, &serviceErr) {
		t.Fatalf("expected ServiceError, got %T", err)
	}
	if serviceErr.Code() != "notes.list_notes.missing_database" {
		t.Fatalf("unexpected service error code: %s", serviceErr.Code())
	}
	if !errors.Is(err, errMissingDatabase) {
		t.Fatalf("expected underlying missing database error, got %v", err)
	}
}
