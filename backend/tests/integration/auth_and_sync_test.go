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

const (
	sessionSigningSecret = "integration-secret"
	sessionCookieName    = "app_session"
	sessionIssuer        = "tauth"
	sessionUserID        = "user-abc"
	sessionNoteID        = "note-1"
	jsonContentType      = "application/json"
)

func TestAuthAndSyncFlow(testContext *testing.T) {
	gin.SetMode(gin.TestMode)

	db, err := gorm.Open(sqlite.Open("file:integration?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		testContext.Fatalf("failed to open sqlite: %v", err)
	}

	if err := db.AutoMigrate(&notes.Note{}, &notes.NoteChange{}, &notes.CrdtUpdate{}, &notes.CrdtSnapshot{}); err != nil {
		testContext.Fatalf("failed to migrate: %v", err)
	}

	notesService, err := notes.NewService(notes.ServiceConfig{
		Database:   db,
		IDProvider: notes.NewUUIDProvider(),
		Logger:     zap.NewNop(),
	})
	if err != nil {
		testContext.Fatalf("failed to build notes service: %v", err)
	}
	sessionValidator, err := auth.NewSessionValidator(auth.SessionValidatorConfig{
		SigningSecret: []byte(sessionSigningSecret),
		CookieName:    sessionCookieName,
	})
	if err != nil {
		testContext.Fatalf("failed to construct session validator: %v", err)
	}

	handler, err := server.NewHTTPHandler(server.Dependencies{
		SessionValidator: sessionValidator,
		SessionCookie:    sessionCookieName,
		NotesService:     notesService,
		Logger:           zap.NewNop(),
	})
	if err != nil {
		testContext.Fatalf("failed to build handler: %v", err)
	}

	testServer := httptest.NewServer(handler)
	defer testServer.Close()

	sessionToken := mustMintSessionToken(testContext, sessionSigningSecret, sessionUserID, time.Now())
	sessionCookie := &http.Cookie{
		Name:  sessionCookieName,
		Value: sessionToken,
	}

	syncRequest := map[string]any{
		"protocol": "crdt-v1",
		"updates": []any{
			map[string]any{
				"note_id":            sessionNoteID,
				"update_b64":         "AQID",
				"snapshot_b64":       "AQID",
				"snapshot_update_id": 0,
			},
		},
	}
	syncBody, _ := json.Marshal(syncRequest)
	syncReq, _ := http.NewRequest(http.MethodPost, testServer.URL+"/notes/sync", bytes.NewReader(syncBody))
	syncReq.AddCookie(sessionCookie)
	syncReq.Header.Set("Content-Type", jsonContentType)

	syncResp, err := http.DefaultClient.Do(syncReq)
	if err != nil {
		testContext.Fatalf("sync request failed: %v", err)
	}
	defer syncResp.Body.Close()

	if syncResp.StatusCode != http.StatusOK {
		testContext.Fatalf("unexpected sync status: %d", syncResp.StatusCode)
	}

	var syncResult struct {
		Results []struct {
			NoteID   string `json:"note_id"`
			Accepted bool   `json:"accepted"`
			UpdateID int64  `json:"update_id"`
		} `json:"results"`
	}
	if err := json.NewDecoder(syncResp.Body).Decode(&syncResult); err != nil {
		testContext.Fatalf("failed to decode sync response: %v", err)
	}
	if len(syncResult.Results) != 1 || !syncResult.Results[0].Accepted || syncResult.Results[0].UpdateID == 0 {
		testContext.Fatalf("expected accepted result, got %#v", syncResult.Results)
	}

	snapshotReq, _ := http.NewRequest(http.MethodGet, testServer.URL+"/notes", nil)
	snapshotReq.AddCookie(sessionCookie)
	snapshotResp, err := http.DefaultClient.Do(snapshotReq)
	if err != nil {
		testContext.Fatalf("snapshot request failed: %v", err)
	}
	defer snapshotResp.Body.Close()
	if snapshotResp.StatusCode != http.StatusOK {
		testContext.Fatalf("unexpected snapshot status: %d", snapshotResp.StatusCode)
	}
	var snapshotPayload struct {
		Protocol string `json:"protocol"`
		Notes    []struct {
			NoteID           string  `json:"note_id"`
			SnapshotB64      *string `json:"snapshot_b64"`
			SnapshotUpdateID *int64  `json:"snapshot_update_id"`
		} `json:"notes"`
	}
	if err := json.NewDecoder(snapshotResp.Body).Decode(&snapshotPayload); err != nil {
		testContext.Fatalf("failed to decode snapshot response: %v", err)
	}
	if len(snapshotPayload.Notes) != 1 {
		testContext.Fatalf("expected single note in snapshot, got %d", len(snapshotPayload.Notes))
	}
	if snapshotPayload.Notes[0].NoteID != sessionNoteID {
		testContext.Fatalf("unexpected note id in snapshot: %s", snapshotPayload.Notes[0].NoteID)
	}
	if snapshotPayload.Protocol != "crdt-v1" {
		testContext.Fatalf("unexpected protocol: %s", snapshotPayload.Protocol)
	}
	if snapshotPayload.Notes[0].SnapshotB64 == nil || *snapshotPayload.Notes[0].SnapshotB64 == "" {
		testContext.Fatalf("expected snapshot payload")
	}
	if snapshotPayload.Notes[0].SnapshotUpdateID == nil {
		testContext.Fatalf("expected snapshot update id")
	}

	cursorRequest := map[string]any{
		"protocol": "crdt-v1",
		"cursors": []any{
			map[string]any{
				"note_id":        sessionNoteID,
				"last_update_id": 0,
			},
		},
	}
	cursorBody, _ := json.Marshal(cursorRequest)
	cursorReq, _ := http.NewRequest(http.MethodPost, testServer.URL+"/notes/sync", bytes.NewReader(cursorBody))
	cursorReq.AddCookie(sessionCookie)
	cursorReq.Header.Set("Content-Type", jsonContentType)

	cursorResp, err := http.DefaultClient.Do(cursorReq)
	if err != nil {
		testContext.Fatalf("cursor sync request failed: %v", err)
	}
	defer cursorResp.Body.Close()
	if cursorResp.StatusCode != http.StatusOK {
		testContext.Fatalf("unexpected cursor status: %d", cursorResp.StatusCode)
	}
	var cursorPayload struct {
		Updates []struct {
			NoteID   string `json:"note_id"`
			UpdateID int64  `json:"update_id"`
		} `json:"updates"`
	}
	if err := json.NewDecoder(cursorResp.Body).Decode(&cursorPayload); err != nil {
		testContext.Fatalf("failed to decode cursor response: %v", err)
	}
	if len(cursorPayload.Updates) != 1 || cursorPayload.Updates[0].NoteID != sessionNoteID || cursorPayload.Updates[0].UpdateID == 0 {
		testContext.Fatalf("expected update replay, got %#v", cursorPayload.Updates)
	}
}

func mustMintSessionToken(testContext *testing.T, signingSecret, userID string, now time.Time) string {
	testContext.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, auth.SessionClaims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    sessionIssuer,
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now.Add(-time.Minute)),
			NotBefore: jwt.NewNumericDate(now.Add(-time.Minute)),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	})
	signed, err := token.SignedString([]byte(signingSecret))
	if err != nil {
		testContext.Fatalf("failed to sign token: %v", err)
	}
	return signed
}
