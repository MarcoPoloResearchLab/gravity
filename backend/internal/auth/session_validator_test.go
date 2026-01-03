package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	testSessionSigningSecret = "secret"
	testSessionCookieName    = "app_session"
	testSessionUserID        = "user-123"
	testSessionUserEmail     = "user@example.com"
)

func TestSessionValidatorValidateToken(t *testing.T) {
	clockNow := time.Date(2024, 9, 1, 12, 0, 0, 0, time.UTC)
	validator, err := NewSessionValidator(SessionValidatorConfig{
		SigningSecret: []byte(testSessionSigningSecret),
		CookieName:    testSessionCookieName,
		Clock: func() time.Time {
			return clockNow
		},
	})
	if err != nil {
		t.Fatalf("failed to construct validator: %v", err)
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, SessionClaims{
		UserID:    testSessionUserID,
		UserEmail: testSessionUserEmail,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    defaultSessionIssuer,
			Subject:   testSessionUserID,
			IssuedAt:  jwt.NewNumericDate(clockNow.Add(-time.Minute)),
			NotBefore: jwt.NewNumericDate(clockNow.Add(-time.Minute)),
			ExpiresAt: jwt.NewNumericDate(clockNow.Add(time.Hour)),
		},
	})
	signed, err := token.SignedString([]byte(testSessionSigningSecret))
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	claims, err := validator.ValidateToken(signed)
	if err != nil {
		t.Fatalf("unexpected validation failure: %v", err)
	}
	if claims.UserID != testSessionUserID {
		t.Fatalf("unexpected user id: %s", claims.UserID)
	}
}

func TestSessionValidatorValidateTokenExpired(t *testing.T) {
	clockNow := time.Date(2024, 9, 1, 12, 0, 0, 0, time.UTC)
	validator, err := NewSessionValidator(SessionValidatorConfig{
		SigningSecret: []byte(testSessionSigningSecret),
		CookieName:    testSessionCookieName,
		Clock: func() time.Time {
			return clockNow
		},
	})
	if err != nil {
		t.Fatalf("failed to construct validator: %v", err)
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, SessionClaims{
		UserID: testSessionUserID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    defaultSessionIssuer,
			Subject:   testSessionUserID,
			IssuedAt:  jwt.NewNumericDate(clockNow.Add(-2 * time.Hour)),
			ExpiresAt: jwt.NewNumericDate(clockNow.Add(-time.Hour)),
		},
	})
	signed, err := token.SignedString([]byte(testSessionSigningSecret))
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	if _, err := validator.ValidateToken(signed); err == nil {
		t.Fatalf("expected expired token error")
	}
}

func TestSessionValidatorValidateRequestUsesCookie(t *testing.T) {
	validator, err := NewSessionValidator(SessionValidatorConfig{
		SigningSecret: []byte(testSessionSigningSecret),
		CookieName:    testSessionCookieName,
	})
	if err != nil {
		t.Fatalf("failed to construct validator: %v", err)
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, SessionClaims{
		UserID: testSessionUserID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    defaultSessionIssuer,
			Subject:   testSessionUserID,
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-time.Minute)),
			NotBefore: jwt.NewNumericDate(time.Now().Add(-time.Minute)),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	})
	signed, err := token.SignedString([]byte(testSessionSigningSecret))
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/notes", http.NoBody)
	request.AddCookie(&http.Cookie{
		Name:  testSessionCookieName,
		Value: signed,
	})

	claims, err := validator.ValidateRequest(request)
	if err != nil {
		t.Fatalf("validation failed: %v", err)
	}
	if claims.UserID != testSessionUserID {
		t.Fatalf("unexpected user id: %s", claims.UserID)
	}
}
