package server

import (
	"context"
	"testing"
	"time"
)

func TestRealtimeDispatcherPublishesToSubscriber(t *testing.T) {
	dispatcher := NewRealtimeDispatcher()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stream, cleanup := dispatcher.Subscribe(ctx, "user-1")
	defer cleanup()

	message := RealtimeMessage{
		UserID:    "user-1",
		EventType: RealtimeEventNoteChanged,
		NoteIDs:   []string{"note-a", "note-b"},
		Timestamp: time.Now().UTC(),
	}
	dispatcher.Publish(message)

	select {
	case received := <-stream:
		if received.EventType != RealtimeEventNoteChanged {
			t.Fatalf("expected event type %s, got %s", RealtimeEventNoteChanged, received.EventType)
		}
		if len(received.NoteIDs) != 2 {
			t.Fatalf("expected 2 note ids, got %d", len(received.NoteIDs))
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("expected realtime message within deadline")
	}
}

func TestRealtimeDispatcherIsolatedByUser(t *testing.T) {
	dispatcher := NewRealtimeDispatcher()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	otherCtx, otherCancel := context.WithCancel(context.Background())
	defer otherCancel()

	userStream, cleanup := dispatcher.Subscribe(ctx, "user-2")
	defer cleanup()

	otherStream, otherCleanup := dispatcher.Subscribe(otherCtx, "user-3")
	defer otherCleanup()

	dispatcher.Publish(RealtimeMessage{
		UserID:    "user-3",
		EventType: RealtimeEventNoteChanged,
		NoteIDs:   []string{"note-c"},
		Timestamp: time.Now().UTC(),
	})

	select {
	case <-userStream:
		t.Fatal("did not expect realtime message for unrelated user")
	case <-time.After(200 * time.Millisecond):
	}

	select {
	case msg := <-otherStream:
		if msg.UserID != "user-3" {
			t.Fatalf("expected user-3, received %s", msg.UserID)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("expected realtime message for subscribed user")
	}
}
