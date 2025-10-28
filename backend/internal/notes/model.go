package notes

import (
	"errors"
	"fmt"
	"strings"
)

// OperationType enumerates supported client operations.
type OperationType string

const (
	// OperationTypeUpsert represents an insert or update payload.
	OperationTypeUpsert OperationType = "upsert"
	// OperationTypeDelete marks a note as deleted.
	OperationTypeDelete OperationType = "delete"
)

const maxIdentifierLength = 190

var (
	// ErrInvalidNoteID indicates that a note identifier is empty or exceeds storage bounds.
	ErrInvalidNoteID = errors.New("notes: invalid note id")
	// ErrInvalidUserID indicates that a user identifier is empty or exceeds storage bounds.
	ErrInvalidUserID = errors.New("notes: invalid user id")
	// ErrInvalidTimestamp indicates that a unix timestamp value is not positive.
	ErrInvalidTimestamp = errors.New("notes: invalid unix timestamp")
)

// NoteID represents a validated note identifier.
type NoteID string

// NewNoteID validates raw input and returns a NoteID.
func NewNoteID(rawInput string) (NoteID, error) {
	trimmed := strings.TrimSpace(rawInput)
	if trimmed == "" {
		return "", fmt.Errorf("%w: empty", ErrInvalidNoteID)
	}
	if len(trimmed) > maxIdentifierLength {
		return "", fmt.Errorf("%w: exceeds %d characters", ErrInvalidNoteID, maxIdentifierLength)
	}
	return NoteID(trimmed), nil
}

// String returns the underlying string identifier.
func (id NoteID) String() string {
	return string(id)
}

// UserID represents a validated user identifier.
type UserID string

// NewUserID validates raw input and returns a UserID.
func NewUserID(rawInput string) (UserID, error) {
	trimmed := strings.TrimSpace(rawInput)
	if trimmed == "" {
		return "", fmt.Errorf("%w: empty", ErrInvalidUserID)
	}
	if len(trimmed) > maxIdentifierLength {
		return "", fmt.Errorf("%w: exceeds %d characters", ErrInvalidUserID, maxIdentifierLength)
	}
	return UserID(trimmed), nil
}

// String returns the underlying string identifier.
func (id UserID) String() string {
	return string(id)
}

// UnixTimestamp represents a validated unix timestamp in seconds.
type UnixTimestamp int64

// NewUnixTimestamp validates the value and returns a UnixTimestamp.
func NewUnixTimestamp(value int64) (UnixTimestamp, error) {
	if value <= 0 {
		return 0, fmt.Errorf("%w: %d", ErrInvalidTimestamp, value)
	}
	return UnixTimestamp(value), nil
}

// Int64 exposes the raw unix seconds value.
func (ts UnixTimestamp) Int64() int64 {
	return int64(ts)
}

// Note models the persisted note payload with conflict resolution metadata.
type Note struct {
	UserID            string `gorm:"column:user_id;primaryKey;size:190;not null;index:idx_notes_user_updated,priority:1"`
	NoteID            string `gorm:"column:note_id;primaryKey;size:190;not null"`
	CreatedAtSeconds  int64  `gorm:"column:created_at_s;not null"`
	UpdatedAtSeconds  int64  `gorm:"column:updated_at_s;not null;index:idx_notes_user_updated,priority:4"`
	PayloadJSON       string `gorm:"column:payload_json;type:text;not null"`
	IsDeleted         bool   `gorm:"column:is_deleted;not null;default:false;index:idx_notes_user_updated,priority:5"`
	Version           int64  `gorm:"column:version;not null;default:1"`
	LastWriterDevice  string `gorm:"column:last_writer_device;size:190;not null;default:''"`
	LastWriterEditSeq int64  `gorm:"column:last_writer_edit_seq;not null;default:0;index:idx_notes_user_updated,priority:2"`
}

// TableName provides the explicit table binding for GORM.
func (Note) TableName() string {
	return "notes"
}

// NoteChange captures an append-only audit trail for note modifications.
type NoteChange struct {
	ChangeID          string        `gorm:"column:change_id;primaryKey;size:190;not null"`
	UserID            string        `gorm:"column:user_id;not null;index:idx_changes_user_time,priority:1"`
	NoteID            string        `gorm:"column:note_id;not null"`
	AppliedAtSeconds  int64         `gorm:"column:applied_at_s;not null;index:idx_changes_user_time,priority:2"`
	ClientDevice      string        `gorm:"column:client_device;size:190;not null"`
	ClientTimeSeconds int64         `gorm:"column:client_time_s;not null"`
	Operation         OperationType `gorm:"column:op;not null"`
	PayloadJSON       string        `gorm:"column:payload_json;type:text;not null"`
	PreviousVersion   *int64        `gorm:"column:prev_version"`
	NewVersion        *int64        `gorm:"column:new_version"`
	ClientEditSeq     int64         `gorm:"column:client_edit_seq;not null;default:0"`
	ServerEditSeqSeen int64         `gorm:"column:server_edit_seq_seen;not null;default:0"`
}

// TableName provides the explicit table binding for GORM.
func (NoteChange) TableName() string {
	return "note_changes"
}

// ChangeRequest describes the input supplied by a client during sync.
type ChangeRequest struct {
	UserID            UserID
	NoteID            NoteID
	CreatedAtSeconds  UnixTimestamp
	UpdatedAtSeconds  UnixTimestamp
	ClientTimeSeconds UnixTimestamp
	ClientEditSeq     int64
	ClientDevice      string
	Operation         OperationType
	PayloadJSON       string
	IsDeleted         bool
}

// ConflictOutcome captures the decision from resolveChange.
type ConflictOutcome struct {
	Accepted    bool
	UpdatedNote *Note
	AuditRecord *NoteChange
}
