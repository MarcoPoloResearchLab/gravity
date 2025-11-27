package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestSessionValidatorValidateToken(t *testing.T) {
	clockNow := time.Date(2024, 9, 1, 12, 0, 0, 0, time.UTC)
	validator, err := NewSessionValidator(SessionValidatorConfig{
		SigningSecret: []byte("secret"),
		Issuer:        "mprlab-auth",
		CookieName:    "app_session",
		Clock: func() time.Time {
			return clockNow
		},
	})
	if err != nil {
		t.Fatalf("failed to construct validator: %v", err)
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, SessionClaims{
		UserID:    "user-123",
		UserEmail: "user@example.com",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "mprlab-auth",
			Subject:   "user-123",
			IssuedAt:  jwt.NewNumericDate(clockNow.Add(-time.Minute)),
			NotBefore: jwt.NewNumericDate(clockNow.Add(-time.Minute)),
			ExpiresAt: jwt.NewNumericDate(clockNow.Add(time.Hour)),
		},
	})
	signed, err := token.SignedString([]byte("secret"))
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	claims, err := validator.ValidateToken(signed)
	if err != nil {
		t.Fatalf("unexpected validation failure: %v", err)
	}
	if claims.UserID != "user-123" {
		t.Fatalf("unexpected user id: %s", claims.UserID)
	}
}

func TestSessionValidatorValidateTokenExpired(t *testing.T) {
	clockNow := time.Date(2024, 9, 1, 12, 0, 0, 0, time.UTC)
	validator, err := NewSessionValidator(SessionValidatorConfig{
		SigningSecret: []byte("secret"),
		Issuer:        "mprlab-auth",
		CookieName:    "app_session",
		Clock: func() time.Time {
			return clockNow
		},
	})
	if err != nil {
		t.Fatalf("failed to construct validator: %v", err)
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, SessionClaims{
		UserID: "user-123",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "mprlab-auth",
			Subject:   "user-123",
			IssuedAt:  jwt.NewNumericDate(clockNow.Add(-2 * time.Hour)),
			ExpiresAt: jwt.NewNumericDate(clockNow.Add(-time.Hour)),
		},
	})
	signed, err := token.SignedString([]byte("secret"))
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	if _, err := validator.ValidateToken(signed); err == nil {
		t.Fatalf("expected expired token error")
	}
}

func TestSessionValidatorValidateRequestUsesCookie(t *testing.T) {
	validator, err := NewSessionValidator(SessionValidatorConfig{
		SigningSecret: []byte("secret"),
		Issuer:        "mprlab-auth",
		CookieName:    "app_session",
	})
	if err != nil {
		t.Fatalf("failed to construct validator: %v", err)
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, SessionClaims{
		UserID: "user-123",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "mprlab-auth",
			Subject:   "user-123",
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-time.Minute)),
			NotBefore: jwt.NewNumericDate(time.Now().Add(-time.Minute)),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	})
	signed, err := token.SignedString([]byte("secret"))
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/notes", http.NoBody)
	request.AddCookie(&http.Cookie{
		Name:  "app_session",
		Value: signed,
	})

	claims, err := validator.ValidateRequest(request)
	if err != nil {
		t.Fatalf("validation failed: %v", err)
	}
	if claims.UserID != "user-123" {
		t.Fatalf("unexpected user id: %s", claims.UserID)
	}
}
