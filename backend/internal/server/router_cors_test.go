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
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)

	request := httptest.NewRequest(http.MethodOptions, "/notes", nil)
	request.Header.Set("Origin", "http://example.com")
	context.Request = request

	corsMiddleware()(context)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected preflight to short-circuit with 204, got %d", recorder.Code)
	}
	headers := recorder.Header()
	if headers.Get("Access-Control-Allow-Origin") != "http://example.com" {
		t.Fatalf("expected origin reflection, got %s", headers.Get("Access-Control-Allow-Origin"))
	}
	allowed := headers.Get("Access-Control-Allow-Headers")
	if !strings.Contains(strings.ToLower(allowed), strings.ToLower("X-TAuth-Tenant")) {
		t.Fatalf("expected Access-Control-Allow-Headers to include X-TAuth-Tenant, got %s", allowed)
	}
}
