package server

import "testing"

type testOutcome struct {
	noteID    string
	duplicate bool
}

func (outcome testOutcome) NoteID() string {
	return outcome.noteID
}

func (outcome testOutcome) Duplicate() bool {
	return outcome.duplicate
}

func TestCollectAcceptedNoteIDs(t *testing.T) {
	outcomes := []noteChangeOutcome{
		testOutcome{
			noteID: "note-2",
		},
		testOutcome{
			noteID:    "note-3",
			duplicate: true,
		},
		testOutcome{
			noteID: "note-1",
		},
		testOutcome{
			noteID: "",
		},
	}

	ids := collectAcceptedNoteIDs(outcomes)
	expected := []string{"note-1", "note-2"}
	if len(ids) != len(expected) {
		t.Fatalf("expected %d identifiers, got %d", len(expected), len(ids))
	}
	for index, expectedID := range expected {
		if ids[index] != expectedID {
			t.Fatalf("expected identifier %s at index %d, got %s", expectedID, index, ids[index])
		}
	}
}

func TestCollectAcceptedNoteIDsEmpty(t *testing.T) {
	ids := collectAcceptedNoteIDs(nil)
	if ids != nil {
		t.Fatalf("expected nil identifiers, got %v", ids)
	}
}
