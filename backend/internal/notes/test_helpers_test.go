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

func mustTimestamp(t *testing.T, value int64) UnixTimestamp {
	t.Helper()
	ts, err := NewUnixTimestamp(value)
	if err != nil {
		t.Fatalf("unexpected timestamp error: %v", err)
	}
	return ts
}

func mustNoteVersion(t *testing.T, value int64) NoteVersion {
	t.Helper()
	version, err := NewNoteVersion(value)
	if err != nil {
		t.Fatalf("unexpected note version error: %v", err)
	}
	return version
}

func mustEnvelope(t *testing.T, cfg ChangeEnvelopeConfig) ChangeEnvelope {
	t.Helper()
	envelope, err := NewChangeEnvelope(cfg)
	if err != nil {
		t.Fatalf("unexpected envelope error: %v", err)
	}
	return envelope
}
