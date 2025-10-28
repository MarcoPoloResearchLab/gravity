package notes

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	sqlite "github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

type staticIDGenerator struct {
	ids   []string
	index int
}

func (g *staticIDGenerator) NewID() (string, error) {
	if g.index >= len(g.ids) {
		return "", errors.New("exhausted ids")
	}
	id := g.ids[g.index]
	g.index++
	return id, nil
}

func TestServiceAppliesNewUpsert(t *testing.T) {
	service, db := newTestService(t, []string{"change-1"})
	userID := mustUserID(t, "user-1")
	noteID := mustNoteID(t, "note-1")

	changes := []ChangeEnvelope{
		mustEnvelope(t, ChangeEnvelopeConfig{
			UserID:          userID,
			NoteID:          noteID,
			CreatedAt:       mustTimestamp(t, 1700000000),
			UpdatedAt:       mustTimestamp(t, 1700000000),
			ClientTimestamp: mustTimestamp(t, 1700000000),
			ClientEditSeq:   1,
			ClientDevice:    "web",
			Operation:       OperationTypeUpsert,
			PayloadJSON:     `{"content":"hello"}`,
		}),
	}

	result, err := service.ApplyChanges(context.Background(), userID, changes)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.ChangeOutcomes) != 1 {
		t.Fatalf("expected 1 change outcome, got %d", len(result.ChangeOutcomes))
	}
	if !result.ChangeOutcomes[0].Outcome.Accepted {
		t.Fatalf("expected change to be accepted")
	}

	var stored Note
	if err := db.First(&stored).Error; err != nil {
		t.Fatalf("failed to load stored note: %v", err)
	}
	if stored.Version != 1 {
		t.Fatalf("expected version 1, got %d", stored.Version)
	}
	if stored.LastWriterEditSeq != 1 {
		t.Fatalf("expected edit seq 1, got %d", stored.LastWriterEditSeq)
	}

	var audit NoteChange
	if err := db.First(&audit).Error; err != nil {
		t.Fatalf("failed to load audit record: %v", err)
	}
	if audit.ChangeID != "change-1" {
		t.Fatalf("unexpected change id %s", audit.ChangeID)
	}
	if audit.Operation != OperationTypeUpsert {
		t.Fatalf("unexpected operation %s", audit.Operation)
	}
}

func TestServiceRejectsStaleEditSequence(t *testing.T) {
	service, db := newTestService(t, []string{"change-1"})
	userID := mustUserID(t, "user-1")
	noteID := mustNoteID(t, "note-1")

	existing := Note{
		UserID:            userID.String(),
		NoteID:            noteID.String(),
		CreatedAtSeconds:  1699990000,
		UpdatedAtSeconds:  1700000000,
		PayloadJSON:       `{"content":"existing"}`,
		LastWriterDevice:  "phone",
		LastWriterEditSeq: 4,
		Version:           2,
	}
	if err := db.Create(&existing).Error; err != nil {
		t.Fatalf("failed to seed note: %v", err)
	}

	changes := []ChangeEnvelope{
		mustEnvelope(t, ChangeEnvelopeConfig{
			UserID:          userID,
			NoteID:          noteID,
			CreatedAt:       mustTimestamp(t, 1699990000),
			UpdatedAt:       mustTimestamp(t, 1700000000),
			ClientTimestamp: mustTimestamp(t, 1700000000),
			ClientEditSeq:   3,
			ClientDevice:    "tablet",
			Operation:       OperationTypeUpsert,
			PayloadJSON:     `{"content":"stale"}`,
		}),
	}

	result, err := service.ApplyChanges(context.Background(), userID, changes)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.ChangeOutcomes[0].Outcome.Accepted {
		t.Fatalf("expected stale change to be rejected")
	}

	var stored Note
	if err := db.First(&stored).Error; err != nil {
		t.Fatalf("failed to load stored note: %v", err)
	}
	if stored.PayloadJSON != `{"content":"existing"}` {
		t.Fatalf("expected payload to remain existing, got %s", stored.PayloadJSON)
	}

	var auditCount int64
	if err := db.Model(&NoteChange{}).Count(&auditCount).Error; err != nil {
		t.Fatalf("failed to count audits: %v", err)
	}
	if auditCount != 0 {
		t.Fatalf("expected no audit rows for rejected change")
	}
}

func newTestService(t *testing.T, ids []string) (*Service, *gorm.DB) {
	t.Helper()

	dsn := fmt.Sprintf("file:gravity_test_%d?mode=memory&cache=shared", time.Now().UnixNano())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&Note{}, &NoteChange{}); err != nil {
		t.Fatalf("failed to migrate: %v", err)
	}

	generator := &staticIDGenerator{ids: ids}
	clock := func() time.Time { return time.Unix(1700000600, 0).UTC() }

	service, err := NewService(ServiceConfig{
		Database:   db,
		Clock:      clock,
		IDProvider: generator,
	})
	if err != nil {
		t.Fatalf("failed to construct notes service: %v", err)
	}

	return service, db
}
