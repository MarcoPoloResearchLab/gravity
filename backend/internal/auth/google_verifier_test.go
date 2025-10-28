package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestGoogleVerifierValidatesTokenUsingJWKS(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}

	publicKey := privateKey.PublicKey
	jwk := map[string]string{
		"kty": "RSA",
		"alg": "RS256",
		"kid": "test-key",
		"use": "sig",
		"n":   encodeBigInt(publicKey.N),
		"e":   encodeBigInt(publicKey.E),
	}

	jwksResponse := map[string]any{
		"keys": []any{jwk},
	}

	jwksServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/oauth2/v3/certs" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(jwksResponse)
	}))
	defer jwksServer.Close()

	now := time.Now().UTC()
	claims := jwt.MapClaims{
		"aud": "test-client",
		"iss": "https://accounts.google.com",
		"sub": "user-123",
		"exp": now.Add(5 * time.Minute).Unix(),
		"iat": now.Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = "test-key"
	signedToken, err := token.SignedString(privateKey)
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	verifier, err := NewGoogleVerifier(GoogleVerifierConfig{
		Audience:       "test-client",
		JWKSURL:        jwksServer.URL + "/oauth2/v3/certs",
		AllowedIssuers: []string{"https://accounts.google.com", "accounts.google.com"},
		HTTPClient:     jwksServer.Client(),
	})
	if err != nil {
		t.Fatalf("unexpected constructor error: %v", err)
	}

	verified, err := verifier.Verify(context.Background(), signedToken)
	if err != nil {
		t.Fatalf("expected verification to succeed: %v", err)
	}

	if verified.Subject != "user-123" {
		t.Fatalf("unexpected subject %s", verified.Subject)
	}
	if verified.Audience != "test-client" {
		t.Fatalf("unexpected audience %s", verified.Audience)
	}
}

func TestGoogleVerifierRejectsInvalidAudience(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}

	publicKey := privateKey.PublicKey
	jwk := map[string]string{
		"kty": "RSA",
		"alg": "RS256",
		"kid": "test-key",
		"use": "sig",
		"n":   encodeBigInt(publicKey.N),
		"e":   encodeBigInt(publicKey.E),
	}
	jwksResponse := map[string]any{
		"keys": []any{jwk},
	}

	jwksServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(jwksResponse)
	}))
	defer jwksServer.Close()

	now := time.Now().UTC()
	claims := jwt.MapClaims{
		"aud": "unexpected-client",
		"iss": "https://accounts.google.com",
		"sub": "user-123",
		"exp": now.Add(5 * time.Minute).Unix(),
		"iat": now.Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = "test-key"
	signedToken, err := token.SignedString(privateKey)
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	verifier, err := NewGoogleVerifier(GoogleVerifierConfig{
		Audience:       "test-client",
		JWKSURL:        jwksServer.URL,
		AllowedIssuers: []string{"https://accounts.google.com"},
		HTTPClient:     jwksServer.Client(),
	})
	if err != nil {
		t.Fatalf("unexpected constructor error: %v", err)
	}

	_, err = verifier.Verify(context.Background(), signedToken)
	if err == nil {
		t.Fatalf("expected verification to fail for mismatched audience")
	}
}

func TestNewGoogleVerifierRequiresAudienceAndJWKS(t *testing.T) {
	_, err := NewGoogleVerifier(GoogleVerifierConfig{
		Audience:       "",
		JWKSURL:        "https://example.com/jwks",
		AllowedIssuers: []string{"https://accounts.google.com"},
	})
	if !errors.Is(err, ErrInvalidVerifierConfig) {
		t.Fatalf("expected invalid verifier config error, got %v", err)
	}
	if !strings.Contains(err.Error(), errMissingAudienceConfig.Error()) {
		t.Fatalf("expected audience validation error to be reported, got %v", err)
	}

	_, err = NewGoogleVerifier(GoogleVerifierConfig{
		Audience:       "test-client",
		JWKSURL:        " ",
		AllowedIssuers: []string{"https://accounts.google.com"},
	})
	if !errors.Is(err, ErrInvalidVerifierConfig) {
		t.Fatalf("expected invalid verifier config error, got %v", err)
	}
	if !strings.Contains(err.Error(), errMissingJWKSURL.Error()) {
		t.Fatalf("expected jwks validation error to be reported, got %v", err)
	}
}

func TestNewGoogleVerifierRejectsEmptyIssuerList(t *testing.T) {
	_, err := NewGoogleVerifier(GoogleVerifierConfig{
		Audience:       "test-client",
		JWKSURL:        "https://example.com/jwks",
		AllowedIssuers: []string{"", "   "},
	})
	if !errors.Is(err, ErrInvalidVerifierConfig) {
		t.Fatalf("expected invalid verifier config error, got %v", err)
	}
	if !strings.Contains(err.Error(), errNoAllowedIssuers.Error()) {
		t.Fatalf("expected allowed issuers validation error to be reported, got %v", err)
	}
}

func encodeBigInt(value interface{}) string {
	switch v := value.(type) {
	case *big.Int:
		return base64.RawURLEncoding.EncodeToString(v.Bytes())
	case int:
		return encodeBigInt(int64(v))
	case int64:
		return base64.RawURLEncoding.EncodeToString(big.NewInt(v).Bytes())
	case uint64:
		return base64.RawURLEncoding.EncodeToString(new(big.Int).SetUint64(v).Bytes())
	default:
		return ""
	}
}
