package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/MarcoPoloResearchLab/gravity/backend/internal/auth"
	"github.com/MarcoPoloResearchLab/gravity/backend/internal/notes"
	"github.com/gin-contrib/sse"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

const (
	userIDContextKey    = "gravity_user_id"
	crdtProtocolVersion = "crdt-v1"
)

var (
	errMissingSessionValidator = errors.New("session validator dependency required")
	errMissingNotesService     = errors.New("notes service dependency required")
	errInvalidAuthorization    = errors.New("authorization token missing or invalid")
)

type SessionValidator interface {
	ValidateToken(token string) (auth.SessionClaims, error)
}

type IdentityResolver interface {
	ResolveCanonicalUserID(claims auth.SessionClaims) (string, error)
}

type Dependencies struct {
	SessionValidator SessionValidator
	SessionCookie    string
	NotesService     *notes.Service
	Logger           *zap.Logger
	Realtime         *RealtimeDispatcher
	UserIdentities   IdentityResolver
}

func NewHTTPHandler(deps Dependencies) (http.Handler, error) {
	if deps.SessionValidator == nil {
		return nil, errMissingSessionValidator
	}
	if deps.NotesService == nil {
		return nil, errMissingNotesService
	}

	logger := deps.Logger
	if logger == nil {
		logger = zap.NewNop()
	}

	realtime := deps.Realtime
	if realtime == nil {
		realtime = NewRealtimeDispatcher()
	}

	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(corsMiddleware())

	sessionCookie := strings.TrimSpace(deps.SessionCookie)
	if sessionCookie == "" {
		sessionCookie = "app_session"
	}

	handler := &httpHandler{
		sessions:       deps.SessionValidator,
		sessionCookie:  sessionCookie,
		notesService:   deps.NotesService,
		logger:         logger,
		realtime:       realtime,
		userIdentities: deps.UserIdentities,
	}

	protected := router.Group("/")
	protected.Use(handler.authorizeRequest)
	protected.POST("/notes/sync", handler.handleNotesSync)
	protected.GET("/notes", handler.handleListNotes)
	protected.GET("/notes/stream", handler.handleNotesStream)

	return router, nil
}

func corsMiddleware() gin.HandlerFunc {
	const allowMethods = "GET,POST,OPTIONS"
	const allowCredentials = "true"
	const allowHeaders = "Authorization, Content-Type, X-Requested-With, X-Client, X-TAuth-Tenant"
	return func(c *gin.Context) {
		origin := strings.TrimSpace(c.GetHeader("Origin"))
		if origin != "" {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Credentials", allowCredentials)
			c.Header("Access-Control-Allow-Methods", allowMethods)
			c.Header("Access-Control-Allow-Headers", allowHeaders)
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

type httpHandler struct {
	sessions       SessionValidator
	sessionCookie  string
	notesService   *notes.Service
	logger         *zap.Logger
	realtime       *RealtimeDispatcher
	userIdentities IdentityResolver
}

type crdtSyncRequestPayload struct {
	Protocol string                  `json:"protocol"`
	Updates  []crdtSyncUpdatePayload `json:"updates"`
	Cursors  []crdtSyncCursorPayload `json:"cursors"`
}

type crdtSyncUpdatePayload struct {
	NoteID           string `json:"note_id"`
	UpdateB64        string `json:"update_b64"`
	SnapshotB64      string `json:"snapshot_b64"`
	SnapshotUpdateID int64  `json:"snapshot_update_id"`
}

type crdtSyncCursorPayload struct {
	NoteID       string `json:"note_id"`
	LastUpdateID int64  `json:"last_update_id"`
}

type crdtSyncResponsePayload struct {
	Protocol string                          `json:"protocol"`
	Results  []crdtSyncResultPayload         `json:"results"`
	Updates  []crdtSyncUpdateResponsePayload `json:"updates"`
}

type crdtSyncResultPayload struct {
	NoteID    string `json:"note_id"`
	Accepted  bool   `json:"accepted"`
	UpdateID  int64  `json:"update_id"`
	Duplicate bool   `json:"duplicate"`
}

type crdtSyncUpdateResponsePayload struct {
	NoteID    string `json:"note_id"`
	UpdateID  int64  `json:"update_id"`
	UpdateB64 string `json:"update_b64"`
}

type crdtSnapshotResponsePayload struct {
	Protocol string                    `json:"protocol"`
	Notes    []crdtSnapshotNotePayload `json:"notes"`
}

type crdtSnapshotNotePayload struct {
	NoteID           string          `json:"note_id"`
	SnapshotB64      *string         `json:"snapshot_b64,omitempty"`
	SnapshotUpdateID *int64          `json:"snapshot_update_id,omitempty"`
	LegacyPayload    json.RawMessage `json:"legacy_payload,omitempty"`
	LegacyDeleted    bool            `json:"legacy_deleted,omitempty"`
}

func (h *httpHandler) handleNotesSync(c *gin.Context) {
	userIDValue := c.GetString(userIDContextKey)
	if userIDValue == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, err := notes.NewUserID(userIDValue)
	if err != nil {
		h.logger.Error("invalid user identifier in context", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "sync_failed"})
		return
	}

	var request crdtSyncRequestPayload
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	if strings.TrimSpace(request.Protocol) != crdtProtocolVersion {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_protocol"})
		return
	}
	if len(request.Updates) == 0 && len(request.Cursors) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}

	updates := make([]notes.CrdtUpdateEnvelope, 0, len(request.Updates))
	for _, update := range request.Updates {
		noteID, err := notes.NewNoteID(update.NoteID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_note_id"})
			return
		}
		updateB64, err := notes.NewCrdtUpdateBase64(update.UpdateB64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_update"})
			return
		}
		snapshotB64, err := notes.NewCrdtSnapshotBase64(update.SnapshotB64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_snapshot"})
			return
		}
		snapshotUpdateID, err := notes.NewCrdtUpdateID(update.SnapshotUpdateID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_snapshot_update_id"})
			return
		}
		envelope, err := notes.NewCrdtUpdateEnvelope(notes.CrdtUpdateEnvelopeConfig{
			UserID:           userID,
			NoteID:           noteID,
			UpdateB64:        updateB64,
			SnapshotB64:      snapshotB64,
			SnapshotUpdateID: snapshotUpdateID,
		})
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_update"})
			return
		}
		updates = append(updates, envelope)
	}

	cursors := make([]notes.CrdtCursor, 0, len(request.Cursors))
	for _, cursor := range request.Cursors {
		noteID, err := notes.NewNoteID(cursor.NoteID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_note_id"})
			return
		}
		lastUpdateID, err := notes.NewCrdtUpdateID(cursor.LastUpdateID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_cursor"})
			return
		}
		parsedCursor, err := notes.NewCrdtCursor(notes.CrdtCursorConfig{
			NoteID:       noteID,
			LastUpdateID: lastUpdateID,
		})
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_cursor"})
			return
		}
		cursors = append(cursors, parsedCursor)
	}

	result, err := h.notesService.ApplyCrdtUpdates(c.Request.Context(), userID, updates)
	if err != nil {
		var serviceErr *notes.ServiceError
		if errors.As(err, &serviceErr) {
			h.logger.Error("failed to apply CRDT updates", zap.String("error_code", serviceErr.Code()), zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "sync_failed", "code": serviceErr.Code()})
		} else {
			h.logger.Error("failed to apply CRDT updates", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "sync_failed"})
		}
		return
	}

	updatesFromServer, err := h.notesService.ListCrdtUpdates(c.Request.Context(), userID, cursors)
	if err != nil {
		var serviceErr *notes.ServiceError
		if errors.As(err, &serviceErr) {
			h.logger.Error("failed to list CRDT updates", zap.String("error_code", serviceErr.Code()), zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "sync_failed", "code": serviceErr.Code()})
		} else {
			h.logger.Error("failed to list CRDT updates", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "sync_failed"})
		}
		return
	}

	response := crdtSyncResponsePayload{
		Protocol: crdtProtocolVersion,
		Results:  make([]crdtSyncResultPayload, 0, len(result.UpdateOutcomes)),
		Updates:  make([]crdtSyncUpdateResponsePayload, 0, len(updatesFromServer)),
	}
	for _, outcome := range result.UpdateOutcomes {
		response.Results = append(response.Results, crdtSyncResultPayload{
			NoteID:    outcome.NoteID().String(),
			Accepted:  true,
			UpdateID:  outcome.UpdateID().Int64(),
			Duplicate: outcome.Duplicate(),
		})
	}
	for _, update := range updatesFromServer {
		response.Updates = append(response.Updates, crdtSyncUpdateResponsePayload{
			NoteID:    update.NoteID().String(),
			UpdateID:  update.UpdateID().Int64(),
			UpdateB64: update.UpdateB64().String(),
		})
	}

	h.broadcastCrdtNoteChanges(userID.String(), result.UpdateOutcomes)
	c.JSON(http.StatusOK, response)
}

func (h *httpHandler) broadcastCrdtNoteChanges(userID string, outcomes []notes.CrdtUpdateOutcome) {
	if h.realtime == nil {
		return
	}
	if userID == "" {
		return
	}
	adaptedOutcomes := make([]noteChangeOutcome, 0, len(outcomes))
	for _, outcome := range outcomes {
		adaptedOutcomes = append(adaptedOutcomes, crdtOutcomeAdapter{outcome: outcome})
	}
	noteIDs := collectAcceptedNoteIDs(adaptedOutcomes)
	if len(noteIDs) == 0 {
		return
	}
	h.logger.Info("broadcasting realtime note change", zap.String("user_id", userID), zap.Strings("note_ids", noteIDs))
	timestamp := time.Now().UTC()
	h.realtime.Publish(RealtimeMessage{
		UserID:    userID,
		EventType: RealtimeEventNoteChanged,
		NoteIDs:   noteIDs,
		Timestamp: timestamp,
	})
}

func (h *httpHandler) handleListNotes(c *gin.Context) {
	userIDValue := c.GetString(userIDContextKey)
	if userIDValue == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, err := notes.NewUserID(userIDValue)
	if err != nil {
		h.logger.Error("invalid user identifier in context", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "list_failed"})
		return
	}

	snapshots, err := h.notesService.ListCrdtSnapshots(c.Request.Context(), userID)
	if err != nil {
		var serviceErr *notes.ServiceError
		if errors.As(err, &serviceErr) {
			h.logger.Error("failed to list CRDT snapshots", zap.String("error_code", serviceErr.Code()), zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "list_failed", "code": serviceErr.Code()})
		} else {
			h.logger.Error("failed to list CRDT snapshots", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "list_failed"})
		}
		return
	}

	legacyNotes, err := h.notesService.ListNotes(c.Request.Context(), userID.String())
	if err != nil {
		var serviceErr *notes.ServiceError
		if errors.As(err, &serviceErr) {
			h.logger.Error("failed to list legacy notes", zap.String("error_code", serviceErr.Code()), zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "list_failed", "code": serviceErr.Code()})
		} else {
			h.logger.Error("failed to list legacy notes", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "list_failed"})
		}
		return
	}

	response := crdtSnapshotResponsePayload{
		Protocol: crdtProtocolVersion,
		Notes:    make([]crdtSnapshotNotePayload, 0, len(snapshots)+len(legacyNotes)),
	}

	snapshotByNoteID := make(map[string]struct{}, len(snapshots))
	for _, snapshot := range snapshots {
		noteID := snapshot.NoteID().String()
		snapshotValue := snapshot.SnapshotB64().String()
		snapshotUpdateID := snapshot.SnapshotUpdateID().Int64()
		response.Notes = append(response.Notes, crdtSnapshotNotePayload{
			NoteID:           noteID,
			SnapshotB64:      &snapshotValue,
			SnapshotUpdateID: &snapshotUpdateID,
		})
		snapshotByNoteID[noteID] = struct{}{}
	}

	for _, note := range legacyNotes {
		if _, exists := snapshotByNoteID[note.NoteID]; exists {
			continue
		}
		payload, payloadErr := encodeLegacyPayload(note.PayloadJSON)
		if payloadErr != nil {
			h.logger.Error("invalid legacy payload", zap.Error(payloadErr), zap.String("note_id", note.NoteID))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "list_failed"})
			return
		}
		response.Notes = append(response.Notes, crdtSnapshotNotePayload{
			NoteID:        note.NoteID,
			LegacyPayload: payload,
			LegacyDeleted: note.IsDeleted,
		})
	}

	c.JSON(http.StatusOK, response)
}

func (h *httpHandler) handleNotesStream(c *gin.Context) {
	if h.realtime == nil {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "stream_unavailable"})
		return
	}
	userID := c.GetString(userIDContextKey)
	if userID == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	ctx := c.Request.Context()
	stream, dispose := h.realtime.Subscribe(ctx, userID)
	defer dispose()
	h.logger.Info("realtime stream subscribed", zap.String("user_id", userID))

	writer := c.Writer
	writer.Header().Set("Content-Type", "text/event-stream")
	writer.Header().Set("Cache-Control", "no-cache")
	writer.Header().Set("Connection", "keep-alive")
	flusher, _ := writer.(http.Flusher)

	const heartbeatInterval = 25 * time.Second
	heartbeat := time.NewTimer(heartbeatInterval)
	defer heartbeat.Stop()

	resetHeartbeat := func() {
		if !heartbeat.Stop() {
			select {
			case <-heartbeat.C:
			default:
			}
		}
		heartbeat.Reset(heartbeatInterval)
	}

	sendHeartbeat := func() bool {
		c.Render(-1, sse.Event{
			Event: realtimeEventHeartbeat,
			Data: gin.H{
				"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
				"source":    realtimeSourceBackend,
			},
		})
		if flusher != nil {
			flusher.Flush()
		}
		resetHeartbeat()
		return true
	}

	sendMessage := func(message RealtimeMessage) bool {
		timestamp := message.Timestamp
		if timestamp.IsZero() {
			timestamp = time.Now().UTC()
		}
		c.Render(-1, sse.Event{
			Event: message.EventType,
			Data: gin.H{
				"noteIds":   append([]string(nil), message.NoteIDs...),
				"timestamp": timestamp.UTC().Format(time.RFC3339Nano),
				"source":    realtimeSourceBackend,
			},
		})
		if flusher != nil {
			flusher.Flush()
		}
		resetHeartbeat()
		return true
	}

	c.Stream(func(w io.Writer) bool {
		select {
		case <-ctx.Done():
			return false
		default:
		}

		select {
		case message, ok := <-stream:
			if !ok {
				return false
			}
			return sendMessage(message)
		default:
		}

		select {
		case <-ctx.Done():
			return false
		case message, ok := <-stream:
			if !ok {
				return false
			}
			return sendMessage(message)
		case <-heartbeat.C:
			select {
			case message, ok := <-stream:
				if !ok {
					return false
				}
				return sendMessage(message)
			default:
			}
			return sendHeartbeat()
		}
	})
}

func encodeLegacyPayload(raw string) (json.RawMessage, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}
	if !json.Valid([]byte(trimmed)) {
		return nil, errors.New("invalid legacy payload")
	}
	return json.RawMessage(trimmed), nil
}

func (h *httpHandler) authorizeRequest(c *gin.Context) {
	token := h.extractToken(c)
	if token == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": errInvalidAuthorization.Error()})
		return
	}
	claims, err := h.sessions.ValidateToken(token)
	if err != nil {
		if errors.Is(err, auth.ErrExpiredSessionToken) {
			h.logger.Info("session token validation failed", zap.Error(err))
		} else {
			h.logger.Warn("session token validation failed", zap.Error(err))
		}
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID := strings.TrimSpace(claims.UserID)
	if h.userIdentities != nil {
		resolved, resolveErr := h.userIdentities.ResolveCanonicalUserID(claims)
		if resolveErr != nil {
			h.logger.Warn("user identity resolution failed", zap.Error(resolveErr))
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		userID = resolved
	}
	if userID == "" {
		h.logger.Warn("resolved user id empty")
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	c.Set(userIDContextKey, userID)
	c.Next()
}

func (h *httpHandler) extractToken(c *gin.Context) string {
	if c.Request != nil {
		if cookie, err := c.Request.Cookie(h.sessionCookie); err == nil && cookie != nil {
			token := strings.TrimSpace(cookie.Value)
			if token != "" {
				return token
			}
		}
	}
	header := c.GetHeader("Authorization")
	if strings.HasPrefix(header, "Bearer ") {
		token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
		if token != "" {
			return token
		}
	}
	queryToken := strings.TrimSpace(c.Query("access_token"))
	if queryToken != "" {
		return queryToken
	}
	return ""
}

type noteChangeOutcome interface {
	NoteID() string
	Duplicate() bool
}

type crdtOutcomeAdapter struct {
	outcome notes.CrdtUpdateOutcome
}

func (adapter crdtOutcomeAdapter) NoteID() string {
	return adapter.outcome.NoteID().String()
}

func (adapter crdtOutcomeAdapter) Duplicate() bool {
	return adapter.outcome.Duplicate()
}

func collectAcceptedNoteIDs(outcomes []noteChangeOutcome) []string {
	if len(outcomes) == 0 {
		return nil
	}
	unique := make(map[string]struct{}, len(outcomes))
	for _, outcome := range outcomes {
		if outcome.Duplicate() {
			continue
		}
		noteID := strings.TrimSpace(outcome.NoteID())
		if noteID == "" {
			continue
		}
		unique[noteID] = struct{}{}
	}
	if len(unique) == 0 {
		return nil
	}
	identifiers := make([]string, 0, len(unique))
	for id := range unique {
		identifiers = append(identifiers, id)
	}
	sort.Strings(identifiers)
	return identifiers
}
