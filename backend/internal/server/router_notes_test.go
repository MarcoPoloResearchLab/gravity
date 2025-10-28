package server

import (
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
		notesService: notes.NewService(notes.ServiceConfig{}),
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
