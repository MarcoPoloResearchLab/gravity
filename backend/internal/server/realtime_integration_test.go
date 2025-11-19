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

func TestRealtimeStreamEmitsNoteChangeEvents(t *testing.T) {
	db, err := gorm.Open(githubsqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open in-memory database: %v", err)
	}
	if err := db.AutoMigrate(&notes.Note{}, &notes.NoteChange{}); err != nil {
		t.Fatalf("failed to migrate schema: %v", err)
	}

	noteService, err := notes.NewService(notes.ServiceConfig{
		Database:   db,
		IDProvider: notes.NewUUIDProvider(),
	})
	if err != nil {
		t.Fatalf("failed to construct notes service: %v", err)
	}
	sessionValidator, err := auth.NewSessionValidator(auth.SessionValidatorConfig{
		SigningSecret: []byte("test-signing-secret"),
		Issuer:        "mprlab-auth",
		CookieName:    "app_session",
	})
	if err != nil {
		t.Fatalf("failed to construct session validator: %v", err)
	}
	dispatcher := NewRealtimeDispatcher()
	handler, err := NewHTTPHandler(Dependencies{
		SessionValidator: sessionValidator,
		SessionCookie:    "app_session",
		NotesService:     noteService,
		Logger:           zap.NewExample(),
		Realtime:         dispatcher,
	})
	if err != nil {
		t.Fatalf("failed to construct http handler: %v", err)
	}

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	token := mustMintRealtimeToken(t, "test-signing-secret", "mprlab-auth", "user-123", time.Now())
	sessionCookie := &http.Cookie{Name: "app_session", Value: token}

	streamRequest, err := http.NewRequest(http.MethodGet, server.URL+"/notes/stream", http.NoBody)
	if err != nil {
		t.Fatalf("failed to construct stream request: %v", err)
	}
	streamRequest.AddCookie(sessionCookie)
	streamResp, err := http.DefaultClient.Do(streamRequest)
	if err != nil {
		t.Fatalf("failed to open stream: %v", err)
	}
	t.Cleanup(func() {
		_ = streamResp.Body.Close()
	})
	if streamResp.StatusCode != http.StatusOK {
		t.Fatalf("unexpected stream status: %d", streamResp.StatusCode)
	}

	streamReader := bufio.NewReader(streamResp.Body)

	payload := `{"operations":[{"note_id":"note-1","operation":"upsert","client_edit_seq":1,"client_time_s":1700000000,"created_at_s":1700000000,"updated_at_s":1700000000,"payload":{"noteId":"note-1","markdownText":"hello world","createdAtIso":"2023-01-01T00:00:00Z","updatedAtIso":"2023-01-01T00:00:00Z","lastActivityIso":"2023-01-01T00:00:00Z"}}]}`
	syncReq, err := http.NewRequest(http.MethodPost, server.URL+"/notes/sync", bytes.NewBufferString(payload))
	if err != nil {
		t.Fatalf("failed to construct sync request: %v", err)
	}
	syncReq.AddCookie(sessionCookie)
	syncReq.Header.Set("Content-Type", "application/json")
	syncResp, err := http.DefaultClient.Do(syncReq)
	if err != nil {
		t.Fatalf("sync request failed: %v", err)
	}
	if syncResp.StatusCode != http.StatusOK {
		t.Fatalf("unexpected sync status: %d", syncResp.StatusCode)
	}
	var syncPayload struct {
		Results []struct {
			NoteID   string `json:"note_id"`
			Accepted bool   `json:"accepted"`
		} `json:"results"`
	}
	if err := json.NewDecoder(syncResp.Body).Decode(&syncPayload); err != nil {
		t.Fatalf("failed to decode sync response: %v", err)
	}
	_ = syncResp.Body.Close()
	if len(syncPayload.Results) != 1 || !syncPayload.Results[0].Accepted || syncPayload.Results[0].NoteID != "note-1" {
		t.Fatalf("unexpected sync results: %#v", syncPayload)
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
			t.Fatal("timed out waiting for realtime event")
		case res := <-resultCh:
			if res.err != nil {
				t.Fatalf("failed to read stream: %v", res.err)
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
				t.Fatalf("failed to decode event payload: %v", err)
			}
			if len(payload.NoteIDs) == 0 || payload.NoteIDs[0] != "note-1" {
				t.Fatalf("unexpected note identifiers: %#v", payload.NoteIDs)
			}
			return
		}
	}
}

func mustMintRealtimeToken(t *testing.T, signingSecret, issuer, subject string, now time.Time) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, auth.SessionClaims{
		UserID: subject,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   subject,
			IssuedAt:  jwt.NewNumericDate(now.Add(-time.Minute)),
			NotBefore: jwt.NewNumericDate(now.Add(-time.Minute)),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	})
	signed, err := token.SignedString([]byte(signingSecret))
	if err != nil {
		t.Fatalf("failed to sign realtime token: %v", err)
	}
	return signed
}
