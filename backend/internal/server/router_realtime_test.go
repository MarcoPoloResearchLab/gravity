package server

import (
	"testing"

	"github.com/MarcoPoloResearchLab/gravity/backend/internal/notes"
)

func TestCollectAcceptedNoteIDs(t *testing.T) {
	outcomes := []notes.ChangeOutcome{
		{
			Outcome: notes.ConflictOutcome{
				Accepted: true,
				UpdatedNote: &notes.Note{
					NoteID: "note-2",
				},
			},
		},
		{
			Outcome: notes.ConflictOutcome{
				Accepted: false,
				UpdatedNote: &notes.Note{
					NoteID: "note-3",
				},
			},
		},
		{
			Outcome: notes.ConflictOutcome{
				Accepted: true,
				UpdatedNote: &notes.Note{
					NoteID: "note-1",
				},
			},
		},
		{
			Outcome: notes.ConflictOutcome{
				Accepted: true,
				UpdatedNote: &notes.Note{
					NoteID: "",
				},
			},
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
