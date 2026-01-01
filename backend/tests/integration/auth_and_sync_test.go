package integration_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/MarcoPoloResearchLab/gravity/backend/internal/auth"
	"github.com/MarcoPoloResearchLab/gravity/backend/internal/notes"
	"github.com/MarcoPoloResearchLab/gravity/backend/internal/server"
	"github.com/gin-gonic/gin"
	sqlite "github.com/glebarez/sqlite"
	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

func TestAuthAndSyncFlow(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, err := gorm.Open(sqlite.Open("file:integration?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}

	if err := db.AutoMigrate(&notes.Note{}, &notes.NoteChange{}); err != nil {
		t.Fatalf("failed to migrate: %v", err)
	}

	notesService, err := notes.NewService(notes.ServiceConfig{
		Database:   db,
		IDProvider: notes.NewUUIDProvider(),
		Logger:     zap.NewNop(),
	})
	if err != nil {
		t.Fatalf("failed to build notes service: %v", err)
	}
	sessionValidator, err := auth.NewSessionValidator(auth.SessionValidatorConfig{
		SigningSecret: []byte("integration-secret"),
		Issuer:        "mprlab-auth",
		CookieName:    "app_session",
	})
	if err != nil {
		t.Fatalf("failed to construct session validator: %v", err)
	}

	handler, err := server.NewHTTPHandler(server.Dependencies{
		SessionValidator: sessionValidator,
		SessionCookie:    "app_session",
		NotesService:     notesService,
		Logger:           zap.NewNop(),
	})
	if err != nil {
		t.Fatalf("failed to build handler: %v", err)
	}

	testServer := httptest.NewServer(handler)
	defer testServer.Close()

	sessionToken := mustMintSessionToken(t, "integration-secret", "mprlab-auth", "user-abc", time.Now())
	sessionCookie := &http.Cookie{
		Name:  "app_session",
		Value: sessionToken,
	}

	syncRequest := map[string]any{
		"operations": []any{
			map[string]any{
				"note_id":         "note-1",
				"operation":       "upsert",
				"client_edit_seq": 1,
				"client_device":   "web",
				"client_time_s":   1700000000,
				"created_at_s":    1700000000,
				"updated_at_s":    1700000000,
				"payload": map[string]any{
					"noteId":       "note-1",
					"markdownText": "hello",
				},
			},
		},
	}
	syncBody, _ := json.Marshal(syncRequest)
	syncReq, _ := http.NewRequest(http.MethodPost, testServer.URL+"/notes/sync", bytes.NewReader(syncBody))
	syncReq.AddCookie(sessionCookie)
	syncReq.Header.Set("Content-Type", "application/json")

	syncResp, err := http.DefaultClient.Do(syncReq)
	if err != nil {
		t.Fatalf("sync request failed: %v", err)
	}
	defer syncResp.Body.Close()

	if syncResp.StatusCode != http.StatusOK {
		t.Fatalf("unexpected sync status: %d", syncResp.StatusCode)
	}

	var syncResult struct {
		Results []struct {
			NoteID   string `json:"note_id"`
			Accepted bool   `json:"accepted"`
		} `json:"results"`
	}
	if err := json.NewDecoder(syncResp.Body).Decode(&syncResult); err != nil {
		t.Fatalf("failed to decode sync response: %v", err)
	}
	if len(syncResult.Results) != 1 || !syncResult.Results[0].Accepted {
		t.Fatalf("expected accepted result, got %#v", syncResult.Results)
	}

	snapshotReq, _ := http.NewRequest(http.MethodGet, testServer.URL+"/notes", nil)
	snapshotReq.AddCookie(sessionCookie)
	snapshotResp, err := http.DefaultClient.Do(snapshotReq)
	if err != nil {
		t.Fatalf("snapshot request failed: %v", err)
	}
	defer snapshotResp.Body.Close()
	if snapshotResp.StatusCode != http.StatusOK {
		t.Fatalf("unexpected snapshot status: %d", snapshotResp.StatusCode)
	}
	var snapshotPayload struct {
		Notes []struct {
			NoteID    string         `json:"note_id"`
			IsDeleted bool           `json:"is_deleted"`
			Payload   map[string]any `json:"payload"`
		} `json:"notes"`
	}
	if err := json.NewDecoder(snapshotResp.Body).Decode(&snapshotPayload); err != nil {
		t.Fatalf("failed to decode snapshot response: %v", err)
	}
	if len(snapshotPayload.Notes) != 1 {
		t.Fatalf("expected single note in snapshot, got %d", len(snapshotPayload.Notes))
	}
	if snapshotPayload.Notes[0].NoteID != "note-1" {
		t.Fatalf("unexpected note id in snapshot: %s", snapshotPayload.Notes[0].NoteID)
	}
	if snapshotPayload.Notes[0].IsDeleted {
		t.Fatalf("unexpected deleted flag in snapshot")
	}
	if snapshotPayload.Notes[0].Payload["markdownText"] != "hello" {
		t.Fatalf("unexpected payload markdown: %#v", snapshotPayload.Notes[0].Payload)
	}

	staleRequest := map[string]any{
		"operations": []any{
			map[string]any{
				"note_id":         "note-1",
				"operation":       "upsert",
				"client_edit_seq": 0,
				"client_device":   "web",
				"client_time_s":   1700000001,
				"updated_at_s":    1700000001,
				"payload": map[string]any{
					"noteId":       "note-1",
					"markdownText": "stale",
				},
			},
		},
	}
	staleBody, _ := json.Marshal(staleRequest)
	staleReq, _ := http.NewRequest(http.MethodPost, testServer.URL+"/notes/sync", bytes.NewReader(staleBody))
	staleReq.AddCookie(sessionCookie)
	staleReq.Header.Set("Content-Type", "application/json")

	staleResp, err := http.DefaultClient.Do(staleReq)
	if err != nil {
		t.Fatalf("stale sync request failed: %v", err)
	}
	defer staleResp.Body.Close()

	if staleResp.StatusCode != http.StatusOK {
		t.Fatalf("unexpected stale status: %d", staleResp.StatusCode)
	}

	var staleResult struct {
		Results []struct {
			Accepted bool `json:"accepted"`
		} `json:"results"`
	}
	if err := json.NewDecoder(staleResp.Body).Decode(&staleResult); err != nil {
		t.Fatalf("failed to decode stale response: %v", err)
	}
	if len(staleResult.Results) != 1 || staleResult.Results[0].Accepted {
		t.Fatalf("expected rejection for stale change")
	}
}

func mustMintSessionToken(t *testing.T, signingSecret, issuer, userID string, now time.Time) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, auth.SessionClaims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now.Add(-time.Minute)),
			NotBefore: jwt.NewNumericDate(now.Add(-time.Minute)),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	})
	signed, err := token.SignedString([]byte(signingSecret))
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}
	return signed
}
