package auth

import (
	"context"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestTokenIssuerIssuesBackendTokens(t *testing.T) {
	issuer, err := NewTokenIssuer(TokenIssuerConfig{
		SigningSecret: []byte("super-secret"),
		Issuer:        "gravity-auth",
		Audience:      "gravity-api",
		TokenTTL:      30 * time.Minute,
	})
	if err != nil {
		t.Fatalf("unexpected constructor error: %v", err)
	}

	tokenString, expiresIn, err := issuer.IssueBackendToken(context.Background(), GoogleClaims{
		Subject: "user-123",
	})
	if err != nil {
		t.Fatalf("expected successful issuance: %v", err)
	}

	if expiresIn <= 0 {
		t.Fatalf("expected positive expiry seconds, got %d", expiresIn)
	}

	parser := jwt.Parser{}
	claims := &jwt.RegisteredClaims{}

	_, err = parser.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		return []byte("super-secret"), nil
	})
	if err != nil {
		t.Fatalf("failed to parse generated token: %v", err)
	}

	if claims.Subject != "user-123" {
		t.Fatalf("unexpected subject %s", claims.Subject)
	}
	if claims.Issuer != "gravity-auth" {
		t.Fatalf("unexpected issuer %s", claims.Issuer)
	}
	if len(claims.Audience) == 0 || claims.Audience[0] != "gravity-api" {
		t.Fatalf("unexpected audience %#v", claims.Audience)
	}
}

func TestTokenIssuerRejectsMissingSecret(t *testing.T) {
	_, err := NewTokenIssuer(TokenIssuerConfig{
		SigningSecret: nil,
		Issuer:        "gravity-auth",
		Audience:      "gravity-api",
		TokenTTL:      30 * time.Minute,
	})
	if err == nil {
		t.Fatalf("expected constructor error for missing secret")
	}
}

func TestTokenIssuerValidatesIssuedTokens(t *testing.T) {
	issuer, err := NewTokenIssuer(TokenIssuerConfig{
		SigningSecret: []byte("another-secret"),
		Issuer:        "gravity-auth",
		Audience:      "gravity-api",
		TokenTTL:      15 * time.Minute,
	})
	if err != nil {
		t.Fatalf("unexpected constructor error: %v", err)
	}

	tokenString, _, err := issuer.IssueBackendToken(context.Background(), GoogleClaims{Subject: "user-321"})
	if err != nil {
		t.Fatalf("unexpected error issuing token: %v", err)
	}

	subject, err := issuer.ValidateToken(tokenString)
	if err != nil {
		t.Fatalf("expected validation success: %v", err)
	}
	if subject != "user-321" {
		t.Fatalf("unexpected subject %s", subject)
	}

	_, err = issuer.ValidateToken("invalid.token")
	if err == nil {
		t.Fatalf("expected validation to fail for malformed token")
	}
}

func TestNewTokenIssuerRequiresIssuerAndAudience(t *testing.T) {
	_, err := NewTokenIssuer(TokenIssuerConfig{
		SigningSecret: []byte("secret"),
		Issuer:        "",
		Audience:      "gravity-api",
		TokenTTL:      5 * time.Minute,
	})
	if err == nil {
		t.Fatalf("expected error for missing issuer")
	}

	_, err = NewTokenIssuer(TokenIssuerConfig{
		SigningSecret: []byte("secret"),
		Issuer:        "gravity-auth",
		Audience:      " ",
		TokenTTL:      5 * time.Minute,
	})
	if err == nil {
		t.Fatalf("expected error for missing audience")
	}
}

func TestNewTokenIssuerRequiresPositiveTTL(t *testing.T) {
	_, err := NewTokenIssuer(TokenIssuerConfig{
		SigningSecret: []byte("secret"),
		Issuer:        "gravity-auth",
		Audience:      "gravity-api",
		TokenTTL:      0,
	})
	if err == nil {
		t.Fatalf("expected error for non-positive ttl")
	}
}
