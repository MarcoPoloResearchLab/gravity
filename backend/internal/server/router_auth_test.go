package server

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MarcoPoloResearchLab/gravity/backend/internal/auth"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

func TestAuthorizeRequestLogsExpiredTokenAtInfoLevel(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	request := httptest.NewRequest(http.MethodGet, "/notes", http.NoBody)
	request.Header.Set("Authorization", "Bearer expired-token")
	ctx.Request = request

	core, logs := observer.New(zapcore.DebugLevel)
	logger := zap.New(core)
	handler := &httpHandler{
		sessions: stubSessionValidator{
			err: auth.ErrExpiredSessionToken,
		},
		logger: logger,
	}

	handler.authorizeRequest(ctx)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unexpected status code: got %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
	entries := logs.All()
	if len(entries) != 1 {
		t.Fatalf("expected exactly one log entry, got %d", len(entries))
	}
	entry := entries[0]
	if entry.Level != zapcore.InfoLevel {
		t.Fatalf("expected info level for expired token, got %s", entry.Level)
	}
	if entry.Message != "session token validation failed" {
		t.Fatalf("unexpected log message: %q", entry.Message)
	}
	hasExpired := false
	for _, field := range entry.Context {
		if field.Type == zapcore.ErrorType && errors.Is(field.Interface.(error), auth.ErrExpiredSessionToken) {
			hasExpired = true
			break
		}
	}
	if !hasExpired {
		t.Fatalf("expected expired token error context, got %v", entry.Context)
	}
}

func TestAuthorizeRequestLogsUnexpectedTokenErrorAtWarnLevel(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	request := httptest.NewRequest(http.MethodGet, "/notes", http.NoBody)
	request.Header.Set("Authorization", "Bearer invalid-token")
	ctx.Request = request

	core, logs := observer.New(zapcore.DebugLevel)
	logger := zap.New(core)
	handler := &httpHandler{
		sessions: stubSessionValidator{
			err: errors.New("signature mismatch"),
		},
		logger: logger,
	}

	handler.authorizeRequest(ctx)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unexpected status code: got %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
	entries := logs.All()
	if len(entries) != 1 {
		t.Fatalf("expected exactly one log entry, got %d", len(entries))
	}
	entry := entries[0]
	if entry.Level != zapcore.WarnLevel {
		t.Fatalf("expected warn level for unexpected error, got %s", entry.Level)
	}
	if entry.Message != "session token validation failed" {
		t.Fatalf("unexpected log message: %q", entry.Message)
	}
}

func TestAuthorizeRequestPrefersCookieToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	request := httptest.NewRequest(http.MethodGet, "/notes", http.NoBody)
	request.AddCookie(&http.Cookie{Name: "app_session", Value: "cookie-token"})
	ctx.Request = request

	handler := &httpHandler{
		sessions: stubSessionValidator{
			expectedToken: "cookie-token",
			claims: auth.SessionClaims{
				UserID: "user-123",
			},
		},
		sessionCookie: "app_session",
		logger:        zap.NewNop(),
	}

	handler.authorizeRequest(ctx)

	if ctx.IsAborted() {
		t.Fatalf("expected middleware to continue, context aborted")
	}
	if value, exists := ctx.Get(userIDContextKey); !exists || value != "user-123" {
		t.Fatalf("expected user id context to be set, got %v", value)
	}
}

type stubSessionValidator struct {
	expectedToken string
	claims        auth.SessionClaims
	err           error
}

func (s stubSessionValidator) ValidateToken(token string) (auth.SessionClaims, error) {
	if s.expectedToken != "" && token != s.expectedToken {
		return auth.SessionClaims{}, errors.New("unexpected token")
	}
	if s.err != nil {
		return auth.SessionClaims{}, s.err
	}
	return s.claims, nil
}
