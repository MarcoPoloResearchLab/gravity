package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MarcoPoloResearchLab/gravity/backend/internal/notes"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

func TestHandleNotesSyncRejectsEmptyNoteID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(userIDContextKey, "user-1")

	body := `{"operations":[{"note_id":"","operation":"upsert","client_edit_seq":1,"client_device":"device","client_time_s":1710000000,"created_at_s":0,"updated_at_s":0,"payload":{"text":"hello"}}]}`
	request := httptest.NewRequest(http.MethodPost, "/notes/sync", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	context.Request = request

	handler := &httpHandler{
		notesService: &notes.Service{},
		logger:       zap.NewNop(),
	}

	handler.handleNotesSync(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected bad request status, got %d", recorder.Code)
	}
	expected := `{"error":"invalid_note_id"}`
	if recorder.Body.String() != expected {
		t.Fatalf("unexpected response body: %s", recorder.Body.String())
	}
}

func TestHandleNotesSyncRejectsNegativeEditSeq(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(userIDContextKey, "user-1")

	body := `{"operations":[{"note_id":"note-1","operation":"upsert","client_edit_seq":-5,"client_device":"device","client_time_s":1710000000,"created_at_s":1710000000,"updated_at_s":1710000000,"payload":{"text":"hello"}}]}`
	request := httptest.NewRequest(http.MethodPost, "/notes/sync", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	context.Request = request

	handler := &httpHandler{
		notesService: &notes.Service{},
		logger:       zap.NewNop(),
	}

	handler.handleNotesSync(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected bad request status, got %d", recorder.Code)
	}
	expected := `{"error":"invalid_change"}`
	if recorder.Body.String() != expected {
		t.Fatalf("unexpected response body: %s", recorder.Body.String())
	}
}

func TestHandleNotesSyncIncludesServiceErrorCode(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(userIDContextKey, "user-1")

	body := `{"operations":[{"note_id":"note-1","operation":"upsert","client_edit_seq":1,"client_device":"device","client_time_s":1710000000,"created_at_s":1710000000,"updated_at_s":1710000000,"payload":{"text":"hello"}}]}`
	request := httptest.NewRequest(http.MethodPost, "/notes/sync", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	context.Request = request

	handler := &httpHandler{
		notesService: &notes.Service{},
		logger:       zap.NewNop(),
	}

	handler.handleNotesSync(context)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("expected internal server error status, got %d", recorder.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if payload["code"] != "notes.apply_changes.missing_database" {
		t.Fatalf("expected service error code, got %v", payload["code"])
	}
}

func TestHandleListNotesIncludesServiceErrorCode(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(userIDContextKey, "user-1")

	request := httptest.NewRequest(http.MethodGet, "/notes", http.NoBody)
	context.Request = request

	handler := &httpHandler{
		notesService: &notes.Service{},
		logger:       zap.NewNop(),
	}

	handler.handleListNotes(context)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("expected internal server error status, got %d", recorder.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if payload["code"] != "notes.list_notes.missing_database" {
		t.Fatalf("expected list notes error code, got %v", payload["code"])
	}
}
