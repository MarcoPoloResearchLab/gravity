package notes

import (
	"context"
	"testing"
	"time"

	sqlite "github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

const (
	baseUpdateB64     = "AQID"
	baseSnapshotB64   = "AQID"
	secondUpdateB64   = "AQIE"
	secondSnapshotB64 = "AQIE"
)

func TestApplyCrdtUpdatesStoresSnapshot(testContext *testing.T) {
	service := mustCrdtService(testContext)
	userID := mustUserID(testContext, "user-crdt")
	noteID := mustNoteID(testContext, "note-crdt")

	update := mustCrdtUpdateEnvelope(testContext, userID, noteID, baseUpdateB64, baseSnapshotB64, 0)
	result, err := service.ApplyCrdtUpdates(context.Background(), userID, []CrdtUpdateEnvelope{update})
	if err != nil {
		testContext.Fatalf("apply crdt updates failed: %v", err)
	}
	if len(result.UpdateOutcomes) != 1 {
		testContext.Fatalf("expected single update outcome, got %d", len(result.UpdateOutcomes))
	}
	if result.UpdateOutcomes[0].Duplicate() {
		testContext.Fatalf("expected update to be new")
	}

	var storedUpdate CrdtUpdate
	if err := service.db.WithContext(context.Background()).
		Where("user_id = ? AND note_id = ?", userID.String(), noteID.String()).
		Take(&storedUpdate).Error; err != nil {
		testContext.Fatalf("failed to load stored update: %v", err)
	}
	if storedUpdate.UpdateB64 == "" {
		testContext.Fatalf("expected update payload to be stored")
	}

	var storedSnapshot CrdtSnapshot
	if err := service.db.WithContext(context.Background()).
		Where("user_id = ? AND note_id = ?", userID.String(), noteID.String()).
		Take(&storedSnapshot).Error; err != nil {
		testContext.Fatalf("failed to load stored snapshot: %v", err)
	}
	if storedSnapshot.SnapshotB64 == "" {
		testContext.Fatalf("expected snapshot payload to be stored")
	}
}

func TestApplyCrdtUpdatesDeduplicates(testContext *testing.T) {
	service := mustCrdtService(testContext)
	userID := mustUserID(testContext, "user-crdt-dup")
	noteID := mustNoteID(testContext, "note-crdt-dup")

	update := mustCrdtUpdateEnvelope(testContext, userID, noteID, baseUpdateB64, baseSnapshotB64, 0)
	firstResult, err := service.ApplyCrdtUpdates(context.Background(), userID, []CrdtUpdateEnvelope{update})
	if err != nil {
		testContext.Fatalf("apply crdt updates failed: %v", err)
	}
	if len(firstResult.UpdateOutcomes) != 1 {
		testContext.Fatalf("expected single update outcome, got %d", len(firstResult.UpdateOutcomes))
	}
	firstUpdateID := firstResult.UpdateOutcomes[0].UpdateID()

	secondResult, err := service.ApplyCrdtUpdates(context.Background(), userID, []CrdtUpdateEnvelope{update})
	if err != nil {
		testContext.Fatalf("apply crdt updates failed: %v", err)
	}
	if len(secondResult.UpdateOutcomes) != 1 {
		testContext.Fatalf("expected single update outcome, got %d", len(secondResult.UpdateOutcomes))
	}
	if !secondResult.UpdateOutcomes[0].Duplicate() {
		testContext.Fatalf("expected duplicate update")
	}
	if secondResult.UpdateOutcomes[0].UpdateID() != firstUpdateID {
		testContext.Fatalf("expected duplicate to reuse update id")
	}
}

func TestListCrdtUpdatesRespectsCursor(testContext *testing.T) {
	service := mustCrdtService(testContext)
	userID := mustUserID(testContext, "user-crdt-cursor")
	noteID := mustNoteID(testContext, "note-crdt-cursor")

	firstUpdate := mustCrdtUpdateEnvelope(testContext, userID, noteID, baseUpdateB64, baseSnapshotB64, 0)
	firstResult, err := service.ApplyCrdtUpdates(context.Background(), userID, []CrdtUpdateEnvelope{firstUpdate})
	if err != nil {
		testContext.Fatalf("apply first update failed: %v", err)
	}
	firstUpdateID := firstResult.UpdateOutcomes[0].UpdateID()

	secondUpdate := mustCrdtUpdateEnvelope(testContext, userID, noteID, secondUpdateB64, secondSnapshotB64, 0)
	secondResult, err := service.ApplyCrdtUpdates(context.Background(), userID, []CrdtUpdateEnvelope{secondUpdate})
	if err != nil {
		testContext.Fatalf("apply second update failed: %v", err)
	}
	secondUpdateID := secondResult.UpdateOutcomes[0].UpdateID()
	if secondUpdateID <= firstUpdateID {
		testContext.Fatalf("expected update ids to increase")
	}

	cursor := mustCrdtCursor(testContext, noteID, firstUpdateID.Int64())
	updates, err := service.ListCrdtUpdates(context.Background(), userID, []CrdtCursor{cursor})
	if err != nil {
		testContext.Fatalf("list updates failed: %v", err)
	}
	if len(updates) != 1 {
		testContext.Fatalf("expected single update after cursor, got %d", len(updates))
	}
	if updates[0].UpdateID() != secondUpdateID {
		testContext.Fatalf("expected update after cursor to match latest update id")
	}
}

func mustCrdtService(testContext *testing.T) *Service {
	testContext.Helper()
	database, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		testContext.Fatalf("failed to open database: %v", err)
	}
	if err := database.AutoMigrate(&CrdtUpdate{}, &CrdtSnapshot{}); err != nil {
		testContext.Fatalf("failed to migrate schema: %v", err)
	}
	service, err := NewService(ServiceConfig{
		Database: database,
		Clock: func() time.Time {
			return time.Unix(1700000000, 0).UTC()
		},
	})
	if err != nil {
		testContext.Fatalf("failed to create service: %v", err)
	}
	return service
}

func mustCrdtUpdateEnvelope(testContext *testing.T, userID UserID, noteID NoteID, updateB64Value string, snapshotB64Value string, snapshotUpdateIDValue int64) CrdtUpdateEnvelope {
	testContext.Helper()
	updateB64, err := NewCrdtUpdateBase64(updateB64Value)
	if err != nil {
		testContext.Fatalf("invalid update payload: %v", err)
	}
	snapshotB64, err := NewCrdtSnapshotBase64(snapshotB64Value)
	if err != nil {
		testContext.Fatalf("invalid snapshot payload: %v", err)
	}
	snapshotUpdateID, err := NewCrdtUpdateID(snapshotUpdateIDValue)
	if err != nil {
		testContext.Fatalf("invalid snapshot update id: %v", err)
	}
	envelope, err := NewCrdtUpdateEnvelope(CrdtUpdateEnvelopeConfig{
		UserID:           userID,
		NoteID:           noteID,
		UpdateB64:        updateB64,
		SnapshotB64:      snapshotB64,
		SnapshotUpdateID: snapshotUpdateID,
	})
	if err != nil {
		testContext.Fatalf("failed to build update envelope: %v", err)
	}
	return envelope
}

func mustCrdtCursor(testContext *testing.T, noteID NoteID, lastUpdateIDValue int64) CrdtCursor {
	testContext.Helper()
	lastUpdateID, err := NewCrdtUpdateID(lastUpdateIDValue)
	if err != nil {
		testContext.Fatalf("invalid cursor update id: %v", err)
	}
	cursor, err := NewCrdtCursor(CrdtCursorConfig{
		NoteID:       noteID,
		LastUpdateID: lastUpdateID,
	})
	if err != nil {
		testContext.Fatalf("failed to build cursor: %v", err)
	}
	return cursor
}
