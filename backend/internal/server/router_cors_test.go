package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCORSMiddlewareAllowsTenantHeader(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(corsMiddleware())
	router.OPTIONS("/notes", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	request := httptest.NewRequest(http.MethodOptions, "/notes", http.NoBody)
	request.Header.Set("Origin", "https://app.example.com")
	request.Header.Set("Access-Control-Request-Headers", "X-TAuth-Tenant")

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected status %d, got %d", http.StatusNoContent, recorder.Code)
	}

	allowHeaders := recorder.Header().Get("Access-Control-Allow-Headers")
	if !strings.Contains(strings.ToLower(allowHeaders), strings.ToLower("X-TAuth-Tenant")) {
		t.Fatalf("expected Access-Control-Allow-Headers to include X-TAuth-Tenant, got %q", allowHeaders)
	}

	if recorder.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("expected credentials to be enabled")
	}
}
