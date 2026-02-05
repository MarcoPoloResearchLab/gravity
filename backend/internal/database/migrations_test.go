package database

import (
	"path/filepath"
	"testing"

	"github.com/MarcoPoloResearchLab/gravity/backend/internal/notes"
	sqlite "github.com/glebarez/sqlite"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

func TestApplyMigrationsRepairsSnapshotCoverage(testContext *testing.T) {
	tempDir := testContext.TempDir()
	databasePath := filepath.Join(tempDir, "migration.db")

	database, err := gorm.Open(sqlite.Open(databasePath), &gorm.Config{})
	if err != nil {
		testContext.Fatalf("failed to open sqlite: %v", err)
	}

	if err := database.AutoMigrate(&notes.CrdtUpdate{}, &notes.CrdtSnapshot{}, &migrationRecord{}); err != nil {
		testContext.Fatalf("failed to migrate schema: %v", err)
	}

	snapshot := notes.CrdtSnapshot{
		UserID:           "user-1",
		NoteID:           "note-1",
		SnapshotB64:      "AQID",
		SnapshotUpdateID: 7,
	}
	if err := database.Create(&snapshot).Error; err != nil {
		testContext.Fatalf("failed to insert snapshot: %v", err)
	}

	if err := applyMigrations(database, zap.NewNop()); err != nil {
		testContext.Fatalf("failed to apply migrations: %v", err)
	}

	var stored notes.CrdtSnapshot
	if err := database.Where("user_id = ? AND note_id = ?", snapshot.UserID, snapshot.NoteID).Take(&stored).Error; err != nil {
		testContext.Fatalf("failed to reload snapshot: %v", err)
	}
	if stored.SnapshotUpdateID != 0 {
		testContext.Fatalf("expected snapshot update id to be reset, got %d", stored.SnapshotUpdateID)
	}

	var record migrationRecord
	if err := database.Where("name = ?", migrationRepairCrdtSnapshotCoverage).Take(&record).Error; err != nil {
		testContext.Fatalf("expected migration record to be created: %v", err)
	}
	if record.AppliedAtSeconds == 0 {
		testContext.Fatalf("expected migration timestamp to be set")
	}
}
