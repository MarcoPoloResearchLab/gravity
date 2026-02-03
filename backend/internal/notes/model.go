package notes

import (
	"encoding/json"
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

const (
	maxIdentifierLength    = 190
	payloadNoteIDKey       = "noteId"
	payloadMarkdownTextKey = "markdownText"
)

var (
	// ErrInvalidNoteID indicates that a note identifier is empty or exceeds storage bounds.
	ErrInvalidNoteID = errors.New("notes: invalid note id")
	// ErrInvalidUserID indicates that a user identifier is empty or exceeds storage bounds.
	ErrInvalidUserID = errors.New("notes: invalid user id")
	// ErrInvalidTimestamp indicates that a unix timestamp value is not positive.
	ErrInvalidTimestamp = errors.New("notes: invalid unix timestamp")
	// ErrInvalidVersion indicates that a version value is invalid.
	ErrInvalidVersion = errors.New("notes: invalid version")
	// ErrInvalidChange indicates that a change violates domain invariants.
	ErrInvalidChange = errors.New("notes: invalid change")
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

// NoteVersion represents a validated note version.
type NoteVersion int64

// NewNoteVersion validates the value and returns a NoteVersion.
func NewNoteVersion(value int64) (NoteVersion, error) {
	if value < 0 {
		return 0, fmt.Errorf("%w: %d", ErrInvalidVersion, value)
	}
	return NoteVersion(value), nil
}

// Int64 exposes the raw version value.
func (version NoteVersion) Int64() int64 {
	return int64(version)
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

// ChangeEnvelope captures a validated change request ready for conflict resolution.
type ChangeEnvelope struct {
	userID          UserID
	noteID          NoteID
	createdAt       UnixTimestamp
	updatedAt       UnixTimestamp
	clientTimestamp UnixTimestamp
	baseVersion     NoteVersion
	clientEditSeq   int64
	clientDevice    string
	operation       OperationType
	payloadJSON     string
	isDeleted       bool
}

// ChangeEnvelopeConfig describes the validated inputs required to construct a ChangeEnvelope.
type ChangeEnvelopeConfig struct {
	UserID          UserID
	NoteID          NoteID
	CreatedAt       UnixTimestamp
	UpdatedAt       UnixTimestamp
	ClientTimestamp UnixTimestamp
	BaseVersion     NoteVersion
	ClientEditSeq   int64
	ClientDevice    string
	Operation       OperationType
	PayloadJSON     string
	IsDeleted       bool
}

// NewChangeEnvelope validates the provided configuration and returns a ChangeEnvelope.
func NewChangeEnvelope(cfg ChangeEnvelopeConfig) (ChangeEnvelope, error) {
	if cfg.UserID == "" {
		return ChangeEnvelope{}, fmt.Errorf("%w: empty user id", ErrInvalidChange)
	}
	if cfg.NoteID == "" {
		return ChangeEnvelope{}, fmt.Errorf("%w: empty note id", ErrInvalidChange)
	}
	if cfg.Operation != OperationTypeUpsert && cfg.Operation != OperationTypeDelete {
		return ChangeEnvelope{}, fmt.Errorf("%w: unsupported operation %s", ErrInvalidChange, cfg.Operation)
	}
	if cfg.ClientEditSeq < 0 {
		return ChangeEnvelope{}, fmt.Errorf("%w: negative client edit seq", ErrInvalidChange)
	}
	if cfg.BaseVersion < 0 {
		return ChangeEnvelope{}, fmt.Errorf("%w: negative base version", ErrInvalidChange)
	}

	trimmedDevice := strings.TrimSpace(cfg.ClientDevice)
	payloadTrimmed := strings.TrimSpace(cfg.PayloadJSON)
	switch cfg.Operation {
	case OperationTypeUpsert:
		if payloadTrimmed == "" {
			return ChangeEnvelope{}, fmt.Errorf("%w: empty payload", ErrInvalidChange)
		}
		if err := validatePayloadJSON(payloadTrimmed, cfg.NoteID); err != nil {
			return ChangeEnvelope{}, err
		}
	case OperationTypeDelete:
		if payloadTrimmed != "" {
			if err := validatePayloadJSON(payloadTrimmed, cfg.NoteID); err != nil {
				return ChangeEnvelope{}, err
			}
		}
	}

	return ChangeEnvelope{
		userID:          cfg.UserID,
		noteID:          cfg.NoteID,
		createdAt:       cfg.CreatedAt,
		updatedAt:       cfg.UpdatedAt,
		clientTimestamp: cfg.ClientTimestamp,
		baseVersion:     cfg.BaseVersion,
		clientEditSeq:   cfg.ClientEditSeq,
		clientDevice:    trimmedDevice,
		operation:       cfg.Operation,
		payloadJSON:     payloadTrimmed,
		isDeleted:       cfg.IsDeleted,
	}, nil
}

// UserID returns the envelope's user identifier.
func (c ChangeEnvelope) UserID() UserID {
	return c.userID
}

// NoteID returns the envelope's note identifier.
func (c ChangeEnvelope) NoteID() NoteID {
	return c.noteID
}

// CreatedAt returns the creation timestamp.
func (c ChangeEnvelope) CreatedAt() UnixTimestamp {
	return c.createdAt
}

// UpdatedAt returns the update timestamp.
func (c ChangeEnvelope) UpdatedAt() UnixTimestamp {
	return c.updatedAt
}

// ClientTimestamp returns the client supplied timestamp.
func (c ChangeEnvelope) ClientTimestamp() UnixTimestamp {
	return c.clientTimestamp
}

// BaseVersion returns the note version the client based this change on.
func (c ChangeEnvelope) BaseVersion() NoteVersion {
	return c.baseVersion
}

// ClientEditSeq returns the client edit sequence number.
func (c ChangeEnvelope) ClientEditSeq() int64 {
	return c.clientEditSeq
}

// ClientDevice returns the trimmed client device label.
func (c ChangeEnvelope) ClientDevice() string {
	return c.clientDevice
}

// Operation returns the envelope operation type.
func (c ChangeEnvelope) Operation() OperationType {
	return c.operation
}

// Payload returns the JSON payload for the change.
func (c ChangeEnvelope) Payload() string {
	return c.payloadJSON
}

// IsDeleted indicates whether the change represents a deletion.
func (c ChangeEnvelope) IsDeleted() bool {
	return c.isDeleted
}

// ConflictOutcome captures the decision from resolveChange.
type ConflictOutcome struct {
	Accepted    bool
	UpdatedNote *Note
	AuditRecord *NoteChange
}

type notePayloadFields struct {
	NoteID       string `json:"noteId"`
	MarkdownText string `json:"markdownText"`
}

func validatePayloadJSON(payloadJSON string, expectedNoteID NoteID) error {
	var parsedPayload notePayloadFields
	if err := json.Unmarshal([]byte(payloadJSON), &parsedPayload); err != nil {
		return fmt.Errorf("%w: invalid payload json", ErrInvalidChange)
	}
	payloadNoteID := strings.TrimSpace(parsedPayload.NoteID)
	if payloadNoteID == "" {
		return fmt.Errorf("%w: missing %s", ErrInvalidChange, payloadNoteIDKey)
	}
	if payloadNoteID != expectedNoteID.String() {
		return fmt.Errorf("%w: payload note id mismatch", ErrInvalidChange)
	}
	payloadMarkdownText := strings.TrimSpace(parsedPayload.MarkdownText)
	if payloadMarkdownText == "" {
		return fmt.Errorf("%w: missing %s", ErrInvalidChange, payloadMarkdownTextKey)
	}
	return nil
}
