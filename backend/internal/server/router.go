package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/MarcoPoloResearchLab/gravity/backend/internal/auth"
	"github.com/MarcoPoloResearchLab/gravity/backend/internal/notes"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
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
	}

	router.POST("/auth/google", handler.handleGoogleAuth)

	protected := router.Group("/")
	protected.Use(handler.authorizeRequest)
	protected.POST("/notes/sync", handler.handleNotesSync)

	return router, nil
}

type httpHandler struct {
	verifier     GoogleVerifier
	tokens       BackendTokenManager
	notesService *notes.Service
	logger       *zap.Logger
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

func (h *httpHandler) handleNotesSync(c *gin.Context) {
	userID := c.GetString(userIDContextKey)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var request syncRequestPayload
	if err := c.ShouldBindJSON(&request); err != nil || len(request.Operations) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}

	changes := make([]notes.ChangeRequest, 0, len(request.Operations))
	for _, op := range request.Operations {
		opType, err := parseOperation(op.Operation)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_operation"})
			return
		}
		payloadJSON := ""
		if len(op.Payload) > 0 {
			payloadJSON = string(op.Payload)
		}
		changes = append(changes, notes.ChangeRequest{
			UserID:            userID,
			NoteID:            op.NoteID,
			Operation:         opType,
			ClientEditSeq:     op.ClientEditSeq,
			ClientDevice:      op.ClientDevice,
			ClientTimeSeconds: op.ClientTimeSeconds,
			CreatedAtSeconds:  op.CreatedAtSeconds,
			UpdatedAtSeconds:  op.UpdatedAtSeconds,
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
		payload := json.RawMessage(nil)
		if note.PayloadJSON != "" {
			payload = json.RawMessage(note.PayloadJSON)
		}
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

	c.JSON(http.StatusOK, response)
}

func (h *httpHandler) authorizeRequest(c *gin.Context) {
	header := c.GetHeader("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": errInvalidAuthorization.Error()})
		return
	}
	token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	if token == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": errInvalidAuthorization.Error()})
		return
	}
	subject, err := h.tokens.ValidateToken(token)
	if err != nil {
		h.logger.Warn("token validation failed", zap.Error(err))
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
