package database

import (
	"errors"
	"time"

	"github.com/MarcoPoloResearchLab/gravity/backend/internal/notes"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

const migrationRepairCrdtSnapshotCoverage = "2026-02-03_repair_crdt_snapshot_coverage"

type migrationRecord struct {
	Name             string `gorm:"column:name;primaryKey;size:190;not null"`
	AppliedAtSeconds int64  `gorm:"column:applied_at_s;not null"`
}

func (migrationRecord) TableName() string {
	return "db_migrations"
}

type migrationDefinition struct {
	name  string
	apply func(*gorm.DB) error
}

func applyMigrations(db *gorm.DB, logger *zap.Logger) error {
	migrations := []migrationDefinition{
		{name: migrationRepairCrdtSnapshotCoverage, apply: repairCrdtSnapshotCoverage},
	}

	for _, migration := range migrations {
		var record migrationRecord
		err := db.Where("name = ?", migration.name).Take(&record).Error
		if err == nil {
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := migration.apply(db); err != nil {
			return err
		}
		appliedAt := time.Now().UTC().Unix()
		if err := db.Create(&migrationRecord{Name: migration.name, AppliedAtSeconds: appliedAt}).Error; err != nil {
			return err
		}
		if logger != nil {
			logger.Info("database migration applied", zap.String("migration", migration.name))
		}
	}
	return nil
}

func repairCrdtSnapshotCoverage(db *gorm.DB) error {
	return db.Model(&notes.CrdtSnapshot{}).
		Where("snapshot_update_id <> 0").
		Update("snapshot_update_id", 0).Error
}
