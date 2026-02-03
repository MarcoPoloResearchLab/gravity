package notes

// CrdtUpdate stores an append-only CRDT update payload.
type CrdtUpdate struct {
	UpdateID         int64  `gorm:"column:update_id;primaryKey;autoIncrement"`
	UserID           string `gorm:"column:user_id;size:190;not null;index:idx_crdt_updates_user_note,priority:1;uniqueIndex:idx_crdt_update_dedupe,priority:1"`
	NoteID           string `gorm:"column:note_id;size:190;not null;index:idx_crdt_updates_user_note,priority:2;uniqueIndex:idx_crdt_update_dedupe,priority:2"`
	UpdateB64        string `gorm:"column:update_b64;type:text;not null"`
	UpdateHash       string `gorm:"column:update_hash;size:64;not null;uniqueIndex:idx_crdt_update_dedupe,priority:3"`
	AppliedAtSeconds int64  `gorm:"column:applied_at_s;not null"`
}

// TableName provides the explicit table binding for GORM.
func (CrdtUpdate) TableName() string {
	return "note_crdt_updates"
}

// CrdtSnapshot stores a compacted CRDT snapshot per note.
type CrdtSnapshot struct {
	UserID           string `gorm:"column:user_id;primaryKey;size:190;not null"`
	NoteID           string `gorm:"column:note_id;primaryKey;size:190;not null"`
	SnapshotB64      string `gorm:"column:snapshot_b64;type:text;not null"`
	SnapshotUpdateID int64  `gorm:"column:snapshot_update_id;not null;default:0"`
}

// TableName provides the explicit table binding for GORM.
func (CrdtSnapshot) TableName() string {
	return "note_crdt_snapshots"
}
