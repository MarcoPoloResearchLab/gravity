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

	if err := db.AutoMigrate(&notes.Note{}, &notes.NoteChange{}, &users.Identity{}); err != nil {
		return nil, err
	}

	if err := migrateUserIDs(db); err != nil && logger != nil {
		logger.Warn("user id migration failed", zap.Error(err))
	}

	if logger != nil {
		logger.Info("database initialized", zap.String("path", path))
	}

	return db, nil
}

func migrateUserIDs(db *gorm.DB) error {
	const prefix = "google:"
	start := len(prefix) + 1
	updateNotes := fmt.Sprintf("UPDATE notes SET user_id = substr(user_id, %d) WHERE user_id LIKE '%s%%';", start, prefix)
	if err := db.Exec(updateNotes).Error; err != nil {
		return err
	}
	updateChanges := fmt.Sprintf("UPDATE note_changes SET user_id = substr(user_id, %d) WHERE user_id LIKE '%s%%';", start, prefix)
	return db.Exec(updateChanges).Error
}
