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
	sessionSigningSecret   = "integration-secret"
	sessionCookieName      = "app_session"
	sessionIssuer          = "tauth"
	sessionUserID          = "user-abc"
	sessionNoteID          = "note-1"
	jsonContentType        = "application/json"
	crdtProtocolVersion    = "crdt-v1"
	notesSyncPath          = "/notes/sync"
	notesSnapshotPath      = "/notes"
	integrationDatabaseDSN = "file:integration?mode=memory&cache=shared"
	firstPayloadB64        = "AQID"
	secondPayloadB64       = "AQIE"
)

func setupIntegrationServer(testContext *testing.T) (*httptest.Server, *http.Cookie, func()) {
	gin.SetMode(gin.TestMode)

	database, err := gorm.Open(sqlite.Open(integrationDatabaseDSN), &gorm.Config{})
	if err != nil {
		testContext.Fatalf("failed to open sqlite: %v", err)
	}

	if err := database.AutoMigrate(&notes.CrdtUpdate{}, &notes.CrdtSnapshot{}); err != nil {
		testContext.Fatalf("failed to migrate: %v", err)
	}

	notesService, err := notes.NewService(notes.ServiceConfig{
		Database: database,
		Logger:   zap.NewNop(),
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

	sessionToken := mustMintSessionToken(testContext, sessionSigningSecret, sessionUserID, time.Now())
	sessionCookie := &http.Cookie{
		Name:  sessionCookieName,
		Value: sessionToken,
	}

	sqlDatabase, err := database.DB()
	if err != nil {
		testContext.Fatalf("failed to open sql database: %v", err)
	}

	cleanup := func() {
		testServer.Close()
		_ = sqlDatabase.Close()
	}

	return testServer, sessionCookie, cleanup
}

func TestAuthAndSyncFlow(testContext *testing.T) {
	testServer, sessionCookie, cleanup := setupIntegrationServer(testContext)
	defer cleanup()

	syncRequest := map[string]any{
		"protocol": crdtProtocolVersion,
		"updates": []any{
			map[string]any{
				"note_id":            sessionNoteID,
				"update_b64":         firstPayloadB64,
				"snapshot_b64":       firstPayloadB64,
				"snapshot_update_id": 0,
			},
		},
		"cursors": []any{
			map[string]any{
				"note_id":        sessionNoteID,
				"last_update_id": 0,
			},
		},
	}
	syncBody, _ := json.Marshal(syncRequest)
	syncReq, _ := http.NewRequest(http.MethodPost, testServer.URL+notesSyncPath, bytes.NewReader(syncBody))
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

	snapshotReq, _ := http.NewRequest(http.MethodGet, testServer.URL+notesSnapshotPath, nil)
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
	if snapshotPayload.Protocol != crdtProtocolVersion {
		testContext.Fatalf("unexpected protocol: %s", snapshotPayload.Protocol)
	}
	if snapshotPayload.Notes[0].SnapshotB64 == nil || *snapshotPayload.Notes[0].SnapshotB64 == "" {
		testContext.Fatalf("expected snapshot payload")
	}
	if snapshotPayload.Notes[0].SnapshotUpdateID == nil {
		testContext.Fatalf("expected snapshot update id")
	}

	cursorRequest := map[string]any{
		"protocol": crdtProtocolVersion,
		"cursors": []any{
			map[string]any{
				"note_id":        sessionNoteID,
				"last_update_id": 0,
			},
		},
	}
	cursorBody, _ := json.Marshal(cursorRequest)
	cursorReq, _ := http.NewRequest(http.MethodPost, testServer.URL+notesSyncPath, bytes.NewReader(cursorBody))
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

func TestSyncSnapshotCoverageDoesNotSkipRemoteUpdates(testContext *testing.T) {
	testServer, sessionCookie, cleanup := setupIntegrationServer(testContext)
	defer cleanup()

	firstSyncRequest := map[string]any{
		"protocol": crdtProtocolVersion,
		"updates": []any{
			map[string]any{
				"note_id":            sessionNoteID,
				"update_b64":         firstPayloadB64,
				"snapshot_b64":       firstPayloadB64,
				"snapshot_update_id": 0,
			},
		},
		"cursors": []any{
			map[string]any{
				"note_id":        sessionNoteID,
				"last_update_id": 0,
			},
		},
	}
	firstSyncBody, _ := json.Marshal(firstSyncRequest)
	firstSyncReq, _ := http.NewRequest(http.MethodPost, testServer.URL+notesSyncPath, bytes.NewReader(firstSyncBody))
	firstSyncReq.AddCookie(sessionCookie)
	firstSyncReq.Header.Set("Content-Type", jsonContentType)

	firstSyncResp, err := http.DefaultClient.Do(firstSyncReq)
	if err != nil {
		testContext.Fatalf("first sync request failed: %v", err)
	}
	defer firstSyncResp.Body.Close()
	if firstSyncResp.StatusCode != http.StatusOK {
		testContext.Fatalf("unexpected first sync status: %d", firstSyncResp.StatusCode)
	}

	var firstSyncResult struct {
		Results []struct {
			NoteID   string `json:"note_id"`
			Accepted bool   `json:"accepted"`
			UpdateID int64  `json:"update_id"`
		} `json:"results"`
	}
	if err := json.NewDecoder(firstSyncResp.Body).Decode(&firstSyncResult); err != nil {
		testContext.Fatalf("failed to decode first sync response: %v", err)
	}
	if len(firstSyncResult.Results) != 1 || !firstSyncResult.Results[0].Accepted || firstSyncResult.Results[0].UpdateID == 0 {
		testContext.Fatalf("expected accepted first result, got %#v", firstSyncResult.Results)
	}
	firstUpdateID := firstSyncResult.Results[0].UpdateID

	staleSyncRequest := map[string]any{
		"protocol": crdtProtocolVersion,
		"updates": []any{
			map[string]any{
				"note_id":            sessionNoteID,
				"update_b64":         secondPayloadB64,
				"snapshot_b64":       secondPayloadB64,
				"snapshot_update_id": 999,
			},
		},
		"cursors": []any{
			map[string]any{
				"note_id":        sessionNoteID,
				"last_update_id": 0,
			},
		},
	}
	staleSyncBody, _ := json.Marshal(staleSyncRequest)
	staleSyncReq, _ := http.NewRequest(http.MethodPost, testServer.URL+notesSyncPath, bytes.NewReader(staleSyncBody))
	staleSyncReq.AddCookie(sessionCookie)
	staleSyncReq.Header.Set("Content-Type", jsonContentType)

	staleSyncResp, err := http.DefaultClient.Do(staleSyncReq)
	if err != nil {
		testContext.Fatalf("stale sync request failed: %v", err)
	}
	defer staleSyncResp.Body.Close()
	if staleSyncResp.StatusCode != http.StatusOK {
		testContext.Fatalf("unexpected stale sync status: %d", staleSyncResp.StatusCode)
	}

	snapshotReq, _ := http.NewRequest(http.MethodGet, testServer.URL+notesSnapshotPath, nil)
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
		Notes []struct {
			NoteID           string  `json:"note_id"`
			SnapshotUpdateID *int64  `json:"snapshot_update_id"`
			SnapshotB64      *string `json:"snapshot_b64"`
		} `json:"notes"`
	}
	if err := json.NewDecoder(snapshotResp.Body).Decode(&snapshotPayload); err != nil {
		testContext.Fatalf("failed to decode snapshot response: %v", err)
	}
	if len(snapshotPayload.Notes) != 1 {
		testContext.Fatalf("expected single snapshot note, got %d", len(snapshotPayload.Notes))
	}
	if snapshotPayload.Notes[0].NoteID != sessionNoteID {
		testContext.Fatalf("unexpected note id in snapshot: %s", snapshotPayload.Notes[0].NoteID)
	}
	if snapshotPayload.Notes[0].SnapshotUpdateID == nil {
		testContext.Fatalf("expected snapshot update id")
	}
	snapshotUpdateID := *snapshotPayload.Notes[0].SnapshotUpdateID

	cursorRequest := map[string]any{
		"protocol": crdtProtocolVersion,
		"cursors": []any{
			map[string]any{
				"note_id":        sessionNoteID,
				"last_update_id": snapshotUpdateID,
			},
		},
	}
	cursorBody, _ := json.Marshal(cursorRequest)
	cursorReq, _ := http.NewRequest(http.MethodPost, testServer.URL+notesSyncPath, bytes.NewReader(cursorBody))
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
	foundFirstUpdate := false
	for _, updateEntry := range cursorPayload.Updates {
		if updateEntry.NoteID == sessionNoteID && updateEntry.UpdateID == firstUpdateID {
			foundFirstUpdate = true
			break
		}
	}
	if !foundFirstUpdate {
		testContext.Fatalf("expected cursor sync to include first update id %d, got %#v", firstUpdateID, cursorPayload.Updates)
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
