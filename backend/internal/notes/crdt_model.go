package notes

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

var (
	// ErrInvalidCrdtUpdate indicates that a CRDT update payload is invalid.
	ErrInvalidCrdtUpdate = errors.New("notes: invalid crdt update")
	// ErrInvalidCrdtSnapshot indicates that a CRDT snapshot payload is invalid.
	ErrInvalidCrdtSnapshot = errors.New("notes: invalid crdt snapshot")
	// ErrInvalidCrdtUpdateID indicates that a CRDT update identifier is invalid.
	ErrInvalidCrdtUpdateID = errors.New("notes: invalid crdt update id")
	// ErrInvalidCrdtCursor indicates that a CRDT cursor payload is invalid.
	ErrInvalidCrdtCursor = errors.New("notes: invalid crdt cursor")
)

const (
	errFormatEmpty         = "%w: empty"
	errFormatInvalidBase64 = "%w: invalid base64"
)

// CrdtUpdateBase64 stores a validated base64-encoded CRDT update payload.
type CrdtUpdateBase64 string

// NewCrdtUpdateBase64 validates raw input and returns a CrdtUpdateBase64.
func NewCrdtUpdateBase64(rawInput string) (CrdtUpdateBase64, error) {
	trimmed := strings.TrimSpace(rawInput)
	if trimmed == "" {
		return "", fmt.Errorf(errFormatEmpty, ErrInvalidCrdtUpdate)
	}
	if _, err := base64.StdEncoding.DecodeString(trimmed); err != nil {
		return "", fmt.Errorf(errFormatInvalidBase64, ErrInvalidCrdtUpdate)
	}
	return CrdtUpdateBase64(trimmed), nil
}

// String returns the update payload as a string.
func (payload CrdtUpdateBase64) String() string {
	return string(payload)
}

// CrdtSnapshotBase64 stores a validated base64-encoded CRDT snapshot payload.
type CrdtSnapshotBase64 string

// NewCrdtSnapshotBase64 validates raw input and returns a CrdtSnapshotBase64.
func NewCrdtSnapshotBase64(rawInput string) (CrdtSnapshotBase64, error) {
	trimmed := strings.TrimSpace(rawInput)
	if trimmed == "" {
		return "", fmt.Errorf(errFormatEmpty, ErrInvalidCrdtSnapshot)
	}
	if _, err := base64.StdEncoding.DecodeString(trimmed); err != nil {
		return "", fmt.Errorf(errFormatInvalidBase64, ErrInvalidCrdtSnapshot)
	}
	return CrdtSnapshotBase64(trimmed), nil
}

// String returns the snapshot payload as a string.
func (payload CrdtSnapshotBase64) String() string {
	return string(payload)
}

// CrdtUpdateID represents a validated CRDT update identifier.
type CrdtUpdateID int64

// NewCrdtUpdateID validates the value and returns a CrdtUpdateID.
func NewCrdtUpdateID(value int64) (CrdtUpdateID, error) {
	if value < 0 {
		return 0, fmt.Errorf("%w: %d", ErrInvalidCrdtUpdateID, value)
	}
	return CrdtUpdateID(value), nil
}

// Int64 returns the update identifier as an int64.
func (id CrdtUpdateID) Int64() int64 {
	return int64(id)
}

// CrdtUpdateEnvelope captures a validated CRDT update request.
type CrdtUpdateEnvelope struct {
	userID           UserID
	noteID           NoteID
	updateB64        CrdtUpdateBase64
	snapshotB64      CrdtSnapshotBase64
	snapshotUpdateID CrdtUpdateID
}

// CrdtUpdateEnvelopeConfig describes the inputs required to build a CrdtUpdateEnvelope.
type CrdtUpdateEnvelopeConfig struct {
	UserID           UserID
	NoteID           NoteID
	UpdateB64        CrdtUpdateBase64
	SnapshotB64      CrdtSnapshotBase64
	SnapshotUpdateID CrdtUpdateID
}

// NewCrdtUpdateEnvelope validates the provided configuration and returns a CrdtUpdateEnvelope.
func NewCrdtUpdateEnvelope(cfg CrdtUpdateEnvelopeConfig) (CrdtUpdateEnvelope, error) {
	if cfg.UserID == "" {
		return CrdtUpdateEnvelope{}, fmt.Errorf("%w: empty user id", ErrInvalidCrdtUpdate)
	}
	if cfg.NoteID == "" {
		return CrdtUpdateEnvelope{}, fmt.Errorf("%w: empty note id", ErrInvalidCrdtUpdate)
	}
	if cfg.UpdateB64 == "" {
		return CrdtUpdateEnvelope{}, fmt.Errorf("%w: empty update", ErrInvalidCrdtUpdate)
	}
	if cfg.SnapshotB64 == "" {
		return CrdtUpdateEnvelope{}, fmt.Errorf("%w: empty snapshot", ErrInvalidCrdtSnapshot)
	}
	if cfg.SnapshotUpdateID < 0 {
		return CrdtUpdateEnvelope{}, fmt.Errorf("%w: negative snapshot update id", ErrInvalidCrdtUpdateID)
	}
	return CrdtUpdateEnvelope{
		userID:           cfg.UserID,
		noteID:           cfg.NoteID,
		updateB64:        cfg.UpdateB64,
		snapshotB64:      cfg.SnapshotB64,
		snapshotUpdateID: cfg.SnapshotUpdateID,
	}, nil
}

// UserID returns the envelope's user identifier.
func (envelope CrdtUpdateEnvelope) UserID() UserID {
	return envelope.userID
}

// NoteID returns the envelope's note identifier.
func (envelope CrdtUpdateEnvelope) NoteID() NoteID {
	return envelope.noteID
}

// UpdateB64 returns the CRDT update payload.
func (envelope CrdtUpdateEnvelope) UpdateB64() CrdtUpdateBase64 {
	return envelope.updateB64
}

// SnapshotB64 returns the CRDT snapshot payload.
func (envelope CrdtUpdateEnvelope) SnapshotB64() CrdtSnapshotBase64 {
	return envelope.snapshotB64
}

// SnapshotUpdateID returns the update id recorded alongside the snapshot.
func (envelope CrdtUpdateEnvelope) SnapshotUpdateID() CrdtUpdateID {
	return envelope.snapshotUpdateID
}

// CrdtCursor captures the last update id seen for a note.
type CrdtCursor struct {
	noteID       NoteID
	lastUpdateID CrdtUpdateID
}

// CrdtCursorConfig describes the inputs required to build a CrdtCursor.
type CrdtCursorConfig struct {
	NoteID       NoteID
	LastUpdateID CrdtUpdateID
}

// NewCrdtCursor validates the provided configuration and returns a CrdtCursor.
func NewCrdtCursor(cfg CrdtCursorConfig) (CrdtCursor, error) {
	if cfg.NoteID == "" {
		return CrdtCursor{}, fmt.Errorf("%w: empty note id", ErrInvalidCrdtCursor)
	}
	if cfg.LastUpdateID < 0 {
		return CrdtCursor{}, fmt.Errorf("%w: negative update id", ErrInvalidCrdtCursor)
	}
	return CrdtCursor{
		noteID:       cfg.NoteID,
		lastUpdateID: cfg.LastUpdateID,
	}, nil
}

// NoteID returns the cursor's note identifier.
func (cursor CrdtCursor) NoteID() NoteID {
	return cursor.noteID
}

// LastUpdateID returns the last seen update identifier.
func (cursor CrdtCursor) LastUpdateID() CrdtUpdateID {
	return cursor.lastUpdateID
}
