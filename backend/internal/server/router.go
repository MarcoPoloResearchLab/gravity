package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/MarcoPoloResearchLab/gravity/backend/internal/auth"
	"github.com/MarcoPoloResearchLab/gravity/backend/internal/notes"
	"github.com/gin-contrib/cors"
	"github.com/gin-contrib/sse"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
)

const userIDContextKey = "gravity_user_id"

var (
	errMissingGoogleVerifier = errors.New("google verifier dependency required")
	errMissingTokenManager   = errors.New("token manager dependency required")
	errMissingNotesService   = errors.New("notes service dependency required")
	errInvalidAuthorization  = errors.New("authorization header missing or invalid")
)

type GoogleVerifier interface {
	Verify(ctx context.Context, token string) (auth.GoogleClaims, error)
}

type BackendTokenManager interface {
	IssueBackendToken(ctx context.Context, claims auth.GoogleClaims) (string, int64, error)
	ValidateToken(token string) (string, error)
}

type Dependencies struct {
	GoogleVerifier GoogleVerifier
	TokenManager   BackendTokenManager
	NotesService   *notes.Service
	Logger         *zap.Logger
	Realtime       *RealtimeDispatcher
}

func NewHTTPHandler(deps Dependencies) (http.Handler, error) {
	if deps.GoogleVerifier == nil {
		return nil, errMissingGoogleVerifier
	}
	if deps.TokenManager == nil {
		return nil, errMissingTokenManager
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
	router.Use(cors.New(cors.Config{
		AllowOrigins: []string{"*"},
		AllowMethods: []string{http.MethodGet, http.MethodPost, http.MethodOptions},
		AllowHeaders: []string{"Authorization", "Content-Type"},
		MaxAge:       12 * time.Hour,
	}))

	handler := &httpHandler{
		verifier:     deps.GoogleVerifier,
		tokens:       deps.TokenManager,
		notesService: deps.NotesService,
		logger:       logger,
		realtime:     realtime,
	}

	router.POST("/auth/google", handler.handleGoogleAuth)

	protected := router.Group("/")
	protected.Use(handler.authorizeRequest)
	protected.POST("/notes/sync", handler.handleNotesSync)
	protected.GET("/notes", handler.handleListNotes)
	protected.GET("/notes/stream", handler.handleNotesStream)

	return router, nil
}

type httpHandler struct {
	verifier     GoogleVerifier
	tokens       BackendTokenManager
	notesService *notes.Service
	logger       *zap.Logger
	realtime     *RealtimeDispatcher
}

type authRequestPayload struct {
	IDToken string `json:"id_token"`
}

type authResponsePayload struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int64  `json:"expires_in"`
	TokenType   string `json:"token_type"`
}

func (h *httpHandler) handleGoogleAuth(c *gin.Context) {
	var request authRequestPayload
	if err := c.ShouldBindJSON(&request); err != nil || strings.TrimSpace(request.IDToken) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}

	claims, err := h.verifier.Verify(c.Request.Context(), request.IDToken)
	if err != nil {
		h.logger.Warn("google token verification failed", zap.Error(err))
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	token, expiresIn, err := h.tokens.IssueBackendToken(c.Request.Context(), claims)
	if err != nil {
		h.logger.Error("failed to issue backend token", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token_issue_failed"})
		return
	}

	response := authResponsePayload{
		AccessToken: token,
		ExpiresIn:   expiresIn,
		TokenType:   "Bearer",
	}
	c.JSON(http.StatusOK, response)
}

type syncRequestPayload struct {
	Operations []syncOperationPayload `json:"operations"`
}

type syncOperationPayload struct {
	NoteID            string          `json:"note_id"`
	Operation         string          `json:"operation"`
	ClientEditSeq     int64           `json:"client_edit_seq"`
	ClientDevice      string          `json:"client_device"`
	ClientTimeSeconds int64           `json:"client_time_s"`
	CreatedAtSeconds  int64           `json:"created_at_s"`
	UpdatedAtSeconds  int64           `json:"updated_at_s"`
	Payload           json.RawMessage `json:"payload"`
}

type syncResponsePayload struct {
	Results []syncResultPayload `json:"results"`
}

type syncResultPayload struct {
	NoteID            string          `json:"note_id"`
	Accepted          bool            `json:"accepted"`
	Version           int64           `json:"version"`
	UpdatedAtSeconds  int64           `json:"updated_at_s"`
	LastWriterEditSeq int64           `json:"last_writer_edit_seq"`
	IsDeleted         bool            `json:"is_deleted"`
	Payload           json.RawMessage `json:"payload"`
}

type snapshotResponsePayload struct {
	Notes []snapshotResultPayload `json:"notes"`
}

type snapshotResultPayload struct {
	NoteID            string          `json:"note_id"`
	Version           int64           `json:"version"`
	LastWriterEditSeq int64           `json:"last_writer_edit_seq"`
	IsDeleted         bool            `json:"is_deleted"`
	CreatedAtSeconds  int64           `json:"created_at_s"`
	UpdatedAtSeconds  int64           `json:"updated_at_s"`
	Payload           json.RawMessage `json:"payload"`
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

	var request syncRequestPayload
	if err := c.ShouldBindJSON(&request); err != nil || len(request.Operations) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}

	changes := make([]notes.ChangeRequest, 0, len(request.Operations))
	now := time.Now().UTC()
	for _, op := range request.Operations {
		opType, err := parseOperation(op.Operation)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_operation"})
			return
		}

		noteID, err := notes.NewNoteID(op.NoteID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_note_id"})
			return
		}

		clientSeconds, createdSeconds, updatedSeconds := normalizeOperationTimestamps(op, now)

		clientTimestamp, err := notes.NewUnixTimestamp(clientSeconds)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_client_time"})
			return
		}

		createdTimestamp, err := notes.NewUnixTimestamp(createdSeconds)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_created_time"})
			return
		}

		updatedTimestamp, err := notes.NewUnixTimestamp(updatedSeconds)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_updated_time"})
			return
		}

		payloadJSON := ""
		if len(op.Payload) > 0 {
			payloadJSON = string(op.Payload)
		}
		changes = append(changes, notes.ChangeRequest{
			UserID:            userID,
			NoteID:            noteID,
			Operation:         opType,
			ClientEditSeq:     op.ClientEditSeq,
			ClientDevice:      op.ClientDevice,
			ClientTimeSeconds: clientTimestamp,
			CreatedAtSeconds:  createdTimestamp,
			UpdatedAtSeconds:  updatedTimestamp,
			PayloadJSON:       payloadJSON,
		})
	}

	result, err := h.notesService.ApplyChanges(c.Request.Context(), userID, changes)
	if err != nil {
		h.logger.Error("failed to apply note changes", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "sync_failed"})
		return
	}

	response := syncResponsePayload{Results: make([]syncResultPayload, 0, len(result.ChangeOutcomes))}
	for _, outcome := range result.ChangeOutcomes {
		note := outcome.Outcome.UpdatedNote
		payload := encodePayload(note.PayloadJSON)
		response.Results = append(response.Results, syncResultPayload{
			NoteID:            note.NoteID,
			Accepted:          outcome.Outcome.Accepted,
			Version:           note.Version,
			UpdatedAtSeconds:  note.UpdatedAtSeconds,
			LastWriterEditSeq: note.LastWriterEditSeq,
			IsDeleted:         note.IsDeleted,
			Payload:           payload,
		})
	}

	h.broadcastNoteChanges(userID.String(), result)
	c.JSON(http.StatusOK, response)
}

func normalizeOperationTimestamps(op syncOperationPayload, now time.Time) (clientSeconds int64, createdSeconds int64, updatedSeconds int64) {
	clientSeconds = op.ClientTimeSeconds
	if clientSeconds <= 0 {
		clientSeconds = now.Unix()
	}

	createdSeconds = op.CreatedAtSeconds
	if createdSeconds <= 0 {
		switch {
		case op.ClientTimeSeconds > 0:
			createdSeconds = op.ClientTimeSeconds
		case op.UpdatedAtSeconds > 0:
			createdSeconds = op.UpdatedAtSeconds
		default:
			createdSeconds = clientSeconds
		}
	}

	updatedSeconds = op.UpdatedAtSeconds
	if updatedSeconds <= 0 {
		switch {
		case op.ClientTimeSeconds > 0:
			updatedSeconds = op.ClientTimeSeconds
		case createdSeconds > 0:
			updatedSeconds = createdSeconds
		default:
			updatedSeconds = clientSeconds
		}
	}

	return clientSeconds, createdSeconds, updatedSeconds
}

func (h *httpHandler) broadcastNoteChanges(userID string, result notes.SyncResult) {
	if h.realtime == nil {
		return
	}
	if userID == "" {
		return
	}
	noteIDs := collectAcceptedNoteIDs(result.ChangeOutcomes)
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
	userID := c.GetString(userIDContextKey)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	notes, err := h.notesService.ListNotes(c.Request.Context(), userID)
	if err != nil {
		h.logger.Error("failed to list notes", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "list_failed"})
		return
	}

	response := snapshotResponsePayload{
		Notes: make([]snapshotResultPayload, 0, len(notes)),
	}
	for _, note := range notes {
		response.Notes = append(response.Notes, snapshotResultPayload{
			NoteID:            note.NoteID,
			Version:           note.Version,
			LastWriterEditSeq: note.LastWriterEditSeq,
			IsDeleted:         note.IsDeleted,
			CreatedAtSeconds:  note.CreatedAtSeconds,
			UpdatedAtSeconds:  note.UpdatedAtSeconds,
			Payload:           encodePayload(note.PayloadJSON),
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

func encodePayload(raw string) json.RawMessage {
	if strings.TrimSpace(raw) == "" {
		return json.RawMessage("null")
	}
	return json.RawMessage(raw)
}

func (h *httpHandler) authorizeRequest(c *gin.Context) {
	header := c.GetHeader("Authorization")
	token := ""
	if strings.HasPrefix(header, "Bearer ") {
		token = strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	}
	if token == "" {
		token = strings.TrimSpace(c.Query("access_token"))
	}
	if token == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": errInvalidAuthorization.Error()})
		return
	}
	subject, err := h.tokens.ValidateToken(token)
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			h.logger.Info("token validation failed", zap.Error(err))
		} else {
			h.logger.Warn("token validation failed", zap.Error(err))
		}
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	c.Set(userIDContextKey, subject)
	c.Next()
}

func parseOperation(value string) (notes.OperationType, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case string(notes.OperationTypeUpsert):
		return notes.OperationTypeUpsert, nil
	case string(notes.OperationTypeDelete):
		return notes.OperationTypeDelete, nil
	default:
		return "", errors.New("unknown operation")
	}
}

func collectAcceptedNoteIDs(outcomes []notes.ChangeOutcome) []string {
	if len(outcomes) == 0 {
		return nil
	}
	unique := make(map[string]struct{}, len(outcomes))
	for _, outcome := range outcomes {
		if !outcome.Outcome.Accepted {
			continue
		}
		note := outcome.Outcome.UpdatedNote
		if note == nil {
			continue
		}
		noteID := strings.TrimSpace(note.NoteID)
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
