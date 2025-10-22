package server

import (
	"context"
	"sync"
	"time"
)

const (
	RealtimeEventNoteChanged = "note-change"
	realtimeEventHeartbeat   = "heartbeat"
	realtimeSourceBackend    = "gravity-backend"
)

type RealtimeMessage struct {
	UserID    string
	EventType string
	NoteIDs   []string
	Timestamp time.Time
}

type RealtimeDispatcher struct {
	mu          sync.RWMutex
	subscribers map[string]map[int64]*realtimeSubscriber
	nextID      int64
	bufferSize  int
}

type realtimeSubscriber struct {
	id     int64
	stream chan RealtimeMessage
}

func NewRealtimeDispatcher() *RealtimeDispatcher {
	return &RealtimeDispatcher{
		subscribers: make(map[string]map[int64]*realtimeSubscriber),
		bufferSize:  16,
	}
}

func (d *RealtimeDispatcher) Subscribe(ctx context.Context, userID string) (<-chan RealtimeMessage, func()) {
	if userID == "" {
		ch := make(chan RealtimeMessage)
		close(ch)
		return ch, func() {}
	}
	subscriber := &realtimeSubscriber{
		id:     d.nextSequence(),
		stream: make(chan RealtimeMessage, d.bufferSize),
	}
	d.registerSubscriber(userID, subscriber)
	cleanup := func() {
		d.unregisterSubscriber(userID, subscriber.id)
	}
	go func() {
		<-ctx.Done()
		cleanup()
	}()
	return subscriber.stream, cleanup
}

func (d *RealtimeDispatcher) Publish(message RealtimeMessage) {
	if message.UserID == "" || message.EventType == "" {
		return
	}
	d.mu.RLock()
	subscribers := d.subscribers[message.UserID]
	if len(subscribers) == 0 {
		d.mu.RUnlock()
		return
	}
	copies := make([]*realtimeSubscriber, 0, len(subscribers))
	for _, subscriber := range subscribers {
		copies = append(copies, subscriber)
	}
	d.mu.RUnlock()
	for _, subscriber := range copies {
		select {
		case subscriber.stream <- message:
		default:
		}
	}
}

func (d *RealtimeDispatcher) nextSequence() int64 {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.nextID++
	return d.nextID
}

func (d *RealtimeDispatcher) registerSubscriber(userID string, subscriber *realtimeSubscriber) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, ok := d.subscribers[userID]; !ok {
		d.subscribers[userID] = make(map[int64]*realtimeSubscriber)
	}
	d.subscribers[userID][subscriber.id] = subscriber
}

func (d *RealtimeDispatcher) unregisterSubscriber(userID string, subscriberID int64) {
	d.mu.Lock()
	subscribers := d.subscribers[userID]
	if subscribers != nil {
		delete(subscribers, subscriberID)
		if len(subscribers) == 0 {
			delete(d.subscribers, userID)
		}
	}
	d.mu.Unlock()
}
