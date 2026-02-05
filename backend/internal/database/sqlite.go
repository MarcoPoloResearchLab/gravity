package database

import (
	"fmt"

	"github.com/MarcoPoloResearchLab/gravity/backend/internal/notes"
	"github.com/MarcoPoloResearchLab/gravity/backend/internal/users"
	sqlite "github.com/glebarez/sqlite"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// OpenSQLite establishes a SQLite connection and performs schema migrations.
func OpenSQLite(path string, logger *zap.Logger) (*gorm.DB, error) {
	if path == "" {
		return nil, fmt.Errorf("database path is required")
	}

	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	if err != nil {
		return nil, err
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(1)

	if err := db.AutoMigrate(&notes.CrdtUpdate{}, &notes.CrdtSnapshot{}, &users.Identity{}, &migrationRecord{}); err != nil {
		return nil, err
	}

	if err := migrateUserIDs(db); err != nil && logger != nil {
		logger.Warn("user id migration failed", zap.Error(err))
	}

	if err := applyMigrations(db, logger); err != nil {
		return nil, err
	}

	if logger != nil {
		logger.Info("database initialized", zap.String("path", path))
	}

	return db, nil
}

func migrateUserIDs(db *gorm.DB) error {
	const prefix = "google:"
	start := len(prefix) + 1
	updateCrdtUpdates := fmt.Sprintf("UPDATE note_crdt_updates SET user_id = substr(user_id, %d) WHERE user_id LIKE '%s%%';", start, prefix)
	if err := db.Exec(updateCrdtUpdates).Error; err != nil {
		return err
	}
	updateCrdtSnapshots := fmt.Sprintf("UPDATE note_crdt_snapshots SET user_id = substr(user_id, %d) WHERE user_id LIKE '%s%%';", start, prefix)
	return db.Exec(updateCrdtSnapshots).Error
}
