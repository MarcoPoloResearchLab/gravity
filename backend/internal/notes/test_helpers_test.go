package notes

import "testing"

func mustUserID(t *testing.T, value string) UserID {
	t.Helper()
	id, err := NewUserID(value)
	if err != nil {
		t.Fatalf("unexpected user id error: %v", err)
	}
	return id
}

func mustNoteID(t *testing.T, value string) NoteID {
	t.Helper()
	id, err := NewNoteID(value)
	if err != nil {
		t.Fatalf("unexpected note id error: %v", err)
	}
	return id
}
