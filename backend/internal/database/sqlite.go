package database

import (
	"fmt"

	"github.com/MarcoPoloResearchLab/gravity/backend/internal/notes"
	"go.uber.org/zap"
	"gorm.io/driver/sqlite"
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

	if err := db.AutoMigrate(&notes.Note{}, &notes.NoteChange{}); err != nil {
		return nil, err
	}

	if logger != nil {
		logger.Info("database initialized", zap.String("path", path))
	}

	return db, nil
}
