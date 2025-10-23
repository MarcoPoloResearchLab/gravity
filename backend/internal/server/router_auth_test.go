package server

import (
	contextpkg "context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MarcoPoloResearchLab/gravity/backend/internal/auth"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
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
		tokens: stubBackendTokenManager{
			validateErr: jwt.ErrTokenExpired,
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
	if entry.Message != "token validation failed" {
		t.Fatalf("unexpected log message: %q", entry.Message)
	}
	hasExpired := false
	for _, field := range entry.Context {
		if field.Type == zapcore.ErrorType && errors.Is(field.Interface.(error), jwt.ErrTokenExpired) {
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
		tokens: stubBackendTokenManager{
			validateErr: errors.New("signature mismatch"),
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
	if entry.Message != "token validation failed" {
		t.Fatalf("unexpected log message: %q", entry.Message)
	}
}

type stubBackendTokenManager struct {
	validateErr error
}

func (s stubBackendTokenManager) IssueBackendToken(contextpkg.Context, auth.GoogleClaims) (string, int64, error) {
	return "", 0, errors.New("not implemented")
}

func (s stubBackendTokenManager) ValidateToken(string) (string, error) {
	return "", s.validateErr
}
