package notes

import (
	"context"
	"fmt"
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
	staleSnapshotB64  = "AQIF"
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

func TestApplyCrdtUpdatesSkipsSnapshotOverwriteOnDuplicate(testContext *testing.T) {
	service := mustCrdtService(testContext)
	userID := mustUserID(testContext, "user-crdt-snapshot-equal")
	noteID := mustNoteID(testContext, "note-crdt-snapshot-equal")
	backgroundContext := context.Background()

	initialUpdate := mustCrdtUpdateEnvelope(testContext, userID, noteID, baseUpdateB64, baseSnapshotB64, 0)
	firstResult, firstErr := service.ApplyCrdtUpdates(backgroundContext, userID, []CrdtUpdateEnvelope{initialUpdate})
	if firstErr != nil {
		testContext.Fatalf("apply crdt updates failed: %v", firstErr)
	}
	if len(firstResult.UpdateOutcomes) != 1 {
		testContext.Fatalf("expected single update outcome, got %d", len(firstResult.UpdateOutcomes))
	}
	if firstResult.UpdateOutcomes[0].Duplicate() {
		testContext.Fatalf("expected initial update to be new")
	}
	initialUpdateID := firstResult.UpdateOutcomes[0].UpdateID()

	duplicateUpdate := mustCrdtUpdateEnvelope(testContext, userID, noteID, baseUpdateB64, staleSnapshotB64, 0)
	secondResult, secondErr := service.ApplyCrdtUpdates(backgroundContext, userID, []CrdtUpdateEnvelope{duplicateUpdate})
	if secondErr != nil {
		testContext.Fatalf("apply crdt updates failed: %v", secondErr)
	}
	if len(secondResult.UpdateOutcomes) != 1 {
		testContext.Fatalf("expected single update outcome, got %d", len(secondResult.UpdateOutcomes))
	}
	if !secondResult.UpdateOutcomes[0].Duplicate() {
		testContext.Fatalf("expected duplicate update")
	}
	if secondResult.UpdateOutcomes[0].UpdateID() != initialUpdateID {
		testContext.Fatalf("expected duplicate to reuse update id")
	}

	var storedSnapshot CrdtSnapshot
	if err := service.db.WithContext(backgroundContext).
		Where(queryUserNote, userID.String(), noteID.String()).
		Take(&storedSnapshot).Error; err != nil {
		testContext.Fatalf("failed to load stored snapshot: %v", err)
	}
	if storedSnapshot.SnapshotB64 != baseSnapshotB64 {
		testContext.Fatalf("expected snapshot payload to remain unchanged")
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

func TestListCrdtUpdatesFiltersMultipleNotes(testContext *testing.T) {
	service := mustCrdtService(testContext)
	userID := mustUserID(testContext, "user-crdt-multi")
	noteIDAlpha := mustNoteID(testContext, "note-crdt-multi-alpha")
	noteIDBravo := mustNoteID(testContext, "note-crdt-multi-bravo")
	backgroundContext := context.Background()

	firstAlpha := mustCrdtUpdateEnvelope(testContext, userID, noteIDAlpha, baseUpdateB64, baseSnapshotB64, 0)
	firstAlphaResult, firstAlphaErr := service.ApplyCrdtUpdates(backgroundContext, userID, []CrdtUpdateEnvelope{firstAlpha})
	if firstAlphaErr != nil {
		testContext.Fatalf("apply first alpha update failed: %v", firstAlphaErr)
	}
	firstAlphaUpdateID := firstAlphaResult.UpdateOutcomes[0].UpdateID()

	firstBravo := mustCrdtUpdateEnvelope(testContext, userID, noteIDBravo, baseUpdateB64, baseSnapshotB64, 0)
	firstBravoResult, firstBravoErr := service.ApplyCrdtUpdates(backgroundContext, userID, []CrdtUpdateEnvelope{firstBravo})
	if firstBravoErr != nil {
		testContext.Fatalf("apply first bravo update failed: %v", firstBravoErr)
	}
	firstBravoUpdateID := firstBravoResult.UpdateOutcomes[0].UpdateID()

	secondAlpha := mustCrdtUpdateEnvelope(testContext, userID, noteIDAlpha, secondUpdateB64, secondSnapshotB64, 0)
	secondAlphaResult, secondAlphaErr := service.ApplyCrdtUpdates(backgroundContext, userID, []CrdtUpdateEnvelope{secondAlpha})
	if secondAlphaErr != nil {
		testContext.Fatalf("apply second alpha update failed: %v", secondAlphaErr)
	}
	secondAlphaUpdateID := secondAlphaResult.UpdateOutcomes[0].UpdateID()

	secondBravo := mustCrdtUpdateEnvelope(testContext, userID, noteIDBravo, secondUpdateB64, secondSnapshotB64, 0)
	secondBravoResult, secondBravoErr := service.ApplyCrdtUpdates(backgroundContext, userID, []CrdtUpdateEnvelope{secondBravo})
	if secondBravoErr != nil {
		testContext.Fatalf("apply second bravo update failed: %v", secondBravoErr)
	}
	secondBravoUpdateID := secondBravoResult.UpdateOutcomes[0].UpdateID()

	cursorAlpha := mustCrdtCursor(testContext, noteIDAlpha, firstAlphaUpdateID.Int64())
	cursorBravo := mustCrdtCursor(testContext, noteIDBravo, firstBravoUpdateID.Int64())
	updates, err := service.ListCrdtUpdates(backgroundContext, userID, []CrdtCursor{cursorBravo, cursorAlpha})
	if err != nil {
		testContext.Fatalf("list updates failed: %v", err)
	}
	if len(updates) != 2 {
		testContext.Fatalf("expected two updates after cursors, got %d", len(updates))
	}
	updateByNoteID := make(map[string]CrdtUpdateID, len(updates))
	for _, update := range updates {
		updateByNoteID[update.NoteID().String()] = update.UpdateID()
	}
	updatedAlpha, ok := updateByNoteID[noteIDAlpha.String()]
	if !ok {
		testContext.Fatalf("expected update for alpha note")
	}
	if updatedAlpha != secondAlphaUpdateID {
		testContext.Fatalf("expected alpha update id to match second update")
	}
	updatedBravo, ok := updateByNoteID[noteIDBravo.String()]
	if !ok {
		testContext.Fatalf("expected update for bravo note")
	}
	if updatedBravo != secondBravoUpdateID {
		testContext.Fatalf("expected bravo update id to match second update")
	}
}

func TestListCrdtUpdatesChunksCursorQueries(testContext *testing.T) {
	service := mustCrdtService(testContext)
	userID := mustUserID(testContext, "user-crdt-chunked")
	backgroundContext := context.Background()

	const cursorNoteCount = 520
	const noteIDFormat = "note-crdt-chunk-%03d"

	updates := make([]CrdtUpdateEnvelope, 0, cursorNoteCount)
	cursors := make([]CrdtCursor, 0, cursorNoteCount)
	expectedNoteIDs := make(map[string]struct{}, cursorNoteCount)
	for noteIndex := 0; noteIndex < cursorNoteCount; noteIndex++ {
		noteID := mustNoteID(testContext, fmt.Sprintf(noteIDFormat, noteIndex))
		update := mustCrdtUpdateEnvelope(testContext, userID, noteID, baseUpdateB64, baseSnapshotB64, 0)
		updates = append(updates, update)
		cursors = append(cursors, mustCrdtCursor(testContext, noteID, 0))
		expectedNoteIDs[noteID.String()] = struct{}{}
	}

	if _, err := service.ApplyCrdtUpdates(backgroundContext, userID, updates); err != nil {
		testContext.Fatalf("apply updates failed: %v", err)
	}

	updateRecords, err := service.ListCrdtUpdates(backgroundContext, userID, cursors)
	if err != nil {
		testContext.Fatalf("list updates failed: %v", err)
	}
	if len(updateRecords) != cursorNoteCount {
		testContext.Fatalf("expected %d updates, got %d", cursorNoteCount, len(updateRecords))
	}
	for _, record := range updateRecords {
		delete(expectedNoteIDs, record.NoteID().String())
	}
	if len(expectedNoteIDs) != 0 {
		testContext.Fatalf("expected updates for all notes, missing %d", len(expectedNoteIDs))
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
