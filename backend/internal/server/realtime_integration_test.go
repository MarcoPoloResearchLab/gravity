package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MarcoPoloResearchLab/gravity/backend/internal/auth"
	"github.com/MarcoPoloResearchLab/gravity/backend/internal/notes"
	githubsqlite "github.com/glebarez/sqlite"
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

	noteService := notes.NewService(notes.ServiceConfig{Database: db})
	tokenIssuer := auth.NewTokenIssuer(auth.TokenIssuerConfig{
		SigningSecret: []byte("test-signing-secret"),
		Issuer:        "gravity-auth",
		Audience:      "gravity-api",
		TokenTTL:      time.Minute,
	})

	dispatcher := NewRealtimeDispatcher()
	handler, err := NewHTTPHandler(Dependencies{
		GoogleVerifier: stubVerifier{},
		TokenManager:   tokenIssuer,
		NotesService:   noteService,
		Logger:         zap.NewExample(),
		Realtime:       dispatcher,
	})
	if err != nil {
		t.Fatalf("failed to construct http handler: %v", err)
	}

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	token, _, err := tokenIssuer.IssueBackendToken(context.Background(), auth.GoogleClaims{Subject: "user-123"})
	if err != nil {
		t.Fatalf("failed to issue backend token: %v", err)
	}

	streamRequest, err := http.NewRequest(http.MethodGet, server.URL+"/notes/stream?access_token="+token, http.NoBody)
	if err != nil {
		t.Fatalf("failed to construct stream request: %v", err)
	}
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
	syncReq.Header.Set("Authorization", "Bearer "+token)
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

type stubVerifier struct{}

func (stubVerifier) Verify(_ context.Context, _ string) (auth.GoogleClaims, error) {
	return auth.GoogleClaims{Subject: "user-123"}, nil
}
