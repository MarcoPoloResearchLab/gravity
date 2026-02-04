package notes

import (
	"errors"
	"fmt"
	"strings"
)

const maxIdentifierLength = 190

var (
	// ErrInvalidNoteID indicates that a note identifier is empty or exceeds storage bounds.
	ErrInvalidNoteID = errors.New("notes: invalid note id")
	// ErrInvalidUserID indicates that a user identifier is empty or exceeds storage bounds.
	ErrInvalidUserID = errors.New("notes: invalid user id")
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
