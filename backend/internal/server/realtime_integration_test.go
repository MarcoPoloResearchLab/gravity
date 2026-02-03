package server

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MarcoPoloResearchLab/gravity/backend/internal/auth"
	"github.com/MarcoPoloResearchLab/gravity/backend/internal/notes"
	githubsqlite "github.com/glebarez/sqlite"
	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

const (
	sessionSigningSecret = "test-signing-secret"
	sessionCookieName    = "app_session"
	sessionIssuer        = "tauth"
	sessionUserID        = "user-123"
	sessionNoteID        = "note-1"
	jsonContentType      = "application/json"
)

func TestRealtimeStreamEmitsNoteChangeEvents(testContext *testing.T) {
	db, err := gorm.Open(githubsqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		testContext.Fatalf("failed to open in-memory database: %v", err)
	}
	if err := db.AutoMigrate(&notes.Note{}, &notes.NoteChange{}, &notes.CrdtUpdate{}, &notes.CrdtSnapshot{}); err != nil {
		testContext.Fatalf("failed to migrate schema: %v", err)
	}

	noteService, err := notes.NewService(notes.ServiceConfig{
		Database:   db,
		IDProvider: notes.NewUUIDProvider(),
		Logger:     zap.NewNop(),
	})
	if err != nil {
		testContext.Fatalf("failed to construct notes service: %v", err)
	}
	sessionValidator, err := auth.NewSessionValidator(auth.SessionValidatorConfig{
		SigningSecret: []byte(sessionSigningSecret),
		CookieName:    sessionCookieName,
	})
	if err != nil {
		testContext.Fatalf("failed to construct session validator: %v", err)
	}

	dispatcher := NewRealtimeDispatcher()
	handler, err := NewHTTPHandler(Dependencies{
		SessionValidator: sessionValidator,
		SessionCookie:    sessionCookieName,
		NotesService:     noteService,
		Logger:           zap.NewExample(),
		Realtime:         dispatcher,
	})
	if err != nil {
		testContext.Fatalf("failed to construct http handler: %v", err)
	}

	server := httptest.NewServer(handler)
	testContext.Cleanup(server.Close)

	sessionToken := mustMintSessionToken(testContext, sessionSigningSecret, sessionUserID, time.Now())

	streamRequest, err := http.NewRequest(http.MethodGet, server.URL+"/notes/stream?access_token="+sessionToken, http.NoBody)
	if err != nil {
		testContext.Fatalf("failed to construct stream request: %v", err)
	}
	streamResp, err := http.DefaultClient.Do(streamRequest)
	if err != nil {
		testContext.Fatalf("failed to open stream: %v", err)
	}
	testContext.Cleanup(func() {
		_ = streamResp.Body.Close()
	})
	if streamResp.StatusCode != http.StatusOK {
		testContext.Fatalf("unexpected stream status: %d", streamResp.StatusCode)
	}

	streamReader := bufio.NewReader(streamResp.Body)

	payload := `{"protocol":"crdt-v1","updates":[{"note_id":"` + sessionNoteID + `","update_b64":"AQID","snapshot_b64":"AQID","snapshot_update_id":0}]}`
	syncReq, err := http.NewRequest(http.MethodPost, server.URL+"/notes/sync", bytes.NewBufferString(payload))
	if err != nil {
		testContext.Fatalf("failed to construct sync request: %v", err)
	}
	syncReq.AddCookie(&http.Cookie{Name: sessionCookieName, Value: sessionToken})
	syncReq.Header.Set("Content-Type", jsonContentType)
	syncResp, err := http.DefaultClient.Do(syncReq)
	if err != nil {
		testContext.Fatalf("sync request failed: %v", err)
	}
	if syncResp.StatusCode != http.StatusOK {
		testContext.Fatalf("unexpected sync status: %d", syncResp.StatusCode)
	}
	var syncPayload struct {
		Results []struct {
			NoteID   string `json:"note_id"`
			Accepted bool   `json:"accepted"`
			UpdateID int64  `json:"update_id"`
		} `json:"results"`
	}
	if err := json.NewDecoder(syncResp.Body).Decode(&syncPayload); err != nil {
		testContext.Fatalf("failed to decode sync response: %v", err)
	}
	_ = syncResp.Body.Close()
	if len(syncPayload.Results) != 1 || !syncPayload.Results[0].Accepted || syncPayload.Results[0].NoteID != sessionNoteID || syncPayload.Results[0].UpdateID == 0 {
		testContext.Fatalf("unexpected sync results: %#v", syncPayload)
	}

	type eventPayload struct {
		NoteIDs []string `json:"noteIds"`
	}

	currentEventType := ""
	deadline := time.After(5 * time.Second)
	type readResult struct {
		line string
		err  error
	}
	for {
		resultCh := make(chan readResult, 1)
		go func() {
			line, err := streamReader.ReadString('\n')
			resultCh <- readResult{line: line, err: err}
		}()
		select {
		case <-deadline:
			testContext.Fatal("timed out waiting for realtime event")
		case res := <-resultCh:
			if res.err != nil {
				testContext.Fatalf("failed to read stream: %v", res.err)
			}
			line := strings.TrimSpace(res.line)
			if line == "" {
				continue
			}
			if strings.HasPrefix(line, "event:") {
				currentEventType = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
				continue
			}
			if !strings.HasPrefix(line, "data:") {
				continue
			}
			if currentEventType != RealtimeEventNoteChanged {
				continue
			}
			dataJSON := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			var payload eventPayload
			if err := json.Unmarshal([]byte(dataJSON), &payload); err != nil {
				testContext.Fatalf("failed to decode event payload: %v", err)
			}
			if len(payload.NoteIDs) == 0 || payload.NoteIDs[0] != sessionNoteID {
				testContext.Fatalf("unexpected note identifiers: %#v", payload.NoteIDs)
			}
			return
		}
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
		testContext.Fatalf("failed to sign session token: %v", err)
	}
	return signed
}
