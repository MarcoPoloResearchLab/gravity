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

const (
	validUpdateB64   = "AQID"
	validSnapshotB64 = "AQID"
)

func TestHandleNotesSyncRejectsEmptyNoteID(testContext *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(userIDContextKey, "user-1")

	body := `{"protocol":"crdt-v1","updates":[{"note_id":"","update_b64":"` + validUpdateB64 + `","snapshot_b64":"` + validSnapshotB64 + `","snapshot_update_id":0}]}`
	request := httptest.NewRequest(http.MethodPost, "/notes/sync", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	context.Request = request

	handler := &httpHandler{
		notesService: &notes.Service{},
		logger:       zap.NewNop(),
	}

	handler.handleNotesSync(context)

	if recorder.Code != http.StatusBadRequest {
		testContext.Fatalf("expected bad request status, got %d", recorder.Code)
	}
	expected := `{"error":"invalid_note_id"}`
	if recorder.Body.String() != expected {
		testContext.Fatalf("unexpected response body: %s", recorder.Body.String())
	}
}

func TestHandleNotesSyncRejectsInvalidProtocol(testContext *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(userIDContextKey, "user-1")

	body := `{"protocol":"lww-v1","updates":[{"note_id":"note-1","update_b64":"` + validUpdateB64 + `","snapshot_b64":"` + validSnapshotB64 + `","snapshot_update_id":0}]}`
	request := httptest.NewRequest(http.MethodPost, "/notes/sync", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	context.Request = request

	handler := &httpHandler{
		notesService: &notes.Service{},
		logger:       zap.NewNop(),
	}

	handler.handleNotesSync(context)

	if recorder.Code != http.StatusBadRequest {
		testContext.Fatalf("expected bad request status, got %d", recorder.Code)
	}
	expected := `{"error":"invalid_protocol"}`
	if recorder.Body.String() != expected {
		testContext.Fatalf("unexpected response body: %s", recorder.Body.String())
	}
}

func TestHandleNotesSyncIncludesServiceErrorCode(testContext *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(userIDContextKey, "user-1")

	body := `{"protocol":"crdt-v1","updates":[{"note_id":"note-1","update_b64":"` + validUpdateB64 + `","snapshot_b64":"` + validSnapshotB64 + `","snapshot_update_id":0}]}`
	request := httptest.NewRequest(http.MethodPost, "/notes/sync", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	context.Request = request

	handler := &httpHandler{
		notesService: &notes.Service{},
		logger:       zap.NewNop(),
	}

	handler.handleNotesSync(context)

	if recorder.Code != http.StatusInternalServerError {
		testContext.Fatalf("expected internal server error status, got %d", recorder.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		testContext.Fatalf("failed to decode response: %v", err)
	}
	if payload["code"] != "notes.apply_crdt_updates.missing_database" {
		testContext.Fatalf("expected service error code, got %v", payload["code"])
	}
}

func TestHandleListNotesIncludesServiceErrorCode(testContext *testing.T) {
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
		testContext.Fatalf("expected internal server error status, got %d", recorder.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		testContext.Fatalf("failed to decode response: %v", err)
	}
	if payload["code"] != "notes.list_crdt_snapshots.missing_database" {
		testContext.Fatalf("expected list notes error code, got %v", payload["code"])
	}
}

func TestHandleNotesSyncValidationFailures(testContext *testing.T) {
	gin.SetMode(gin.TestMode)
	testCases := []struct {
		name       string
		body       string
		wantError  string
		wantStatus int
	}{
		{
			name:       "invalid-request",
			body:       `{"protocol":"crdt-v1"}`,
			wantError:  "invalid_request",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid-update-b64",
			body:       `{"protocol":"crdt-v1","updates":[{"note_id":"note-1","update_b64":"not-base64","snapshot_b64":"` + validSnapshotB64 + `","snapshot_update_id":0}]}`,
			wantError:  "invalid_update",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid-snapshot-b64",
			body:       `{"protocol":"crdt-v1","updates":[{"note_id":"note-1","update_b64":"` + validUpdateB64 + `","snapshot_b64":"not-base64","snapshot_update_id":0}]}`,
			wantError:  "invalid_snapshot",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid-snapshot-update-id",
			body:       `{"protocol":"crdt-v1","updates":[{"note_id":"note-1","update_b64":"` + validUpdateB64 + `","snapshot_b64":"` + validSnapshotB64 + `","snapshot_update_id":-1}]}`,
			wantError:  "invalid_snapshot_update_id",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid-cursor",
			body:       `{"protocol":"crdt-v1","cursors":[{"note_id":"note-1","last_update_id":-5}]}`,
			wantError:  "invalid_cursor",
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, testCase := range testCases {
		testContext.Run(testCase.name, func(testContext *testing.T) {
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.Set(userIDContextKey, "user-1")

			request := httptest.NewRequest(http.MethodPost, "/notes/sync", strings.NewReader(testCase.body))
			request.Header.Set("Content-Type", "application/json")
			context.Request = request

			handler := &httpHandler{
				notesService: &notes.Service{},
				logger:       zap.NewNop(),
			}

			handler.handleNotesSync(context)

			if recorder.Code != testCase.wantStatus {
				testContext.Fatalf("unexpected status: got %d want %d", recorder.Code, testCase.wantStatus)
			}

			var payload map[string]any
			if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
				testContext.Fatalf("failed to decode payload: %v", err)
			}
			if payload["error"] != testCase.wantError {
				testContext.Fatalf("expected error %s, got %v", testCase.wantError, payload["error"])
			}
		})
	}
}
