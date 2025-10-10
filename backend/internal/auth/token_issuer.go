package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	defaultTokenTTL = 30 * time.Minute
)

var (
	errMissingSigningSecret = errors.New("signing secret must be provided")
	errMissingSubjectClaim  = errors.New("subject claim must be provided")
)

// TokenIssuerConfig configures the backend JWT issuer.
type TokenIssuerConfig struct {
	SigningSecret []byte
	Issuer        string
	Audience      string
	TokenTTL      time.Duration
	Clock         func() time.Time
}

// TokenIssuer issues backend JWTs after Google token verification.
type TokenIssuer struct {
	config TokenIssuerConfig
	clock  func() time.Time
}

// NewTokenIssuer constructs a TokenIssuer with sane defaults.
func NewTokenIssuer(cfg TokenIssuerConfig) *TokenIssuer {
	ttl := cfg.TokenTTL
	if ttl <= 0 {
		ttl = defaultTokenTTL
	}
	clock := cfg.Clock
	if clock == nil {
		clock = time.Now
	}
	return &TokenIssuer{
		config: TokenIssuerConfig{
			SigningSecret: cfg.SigningSecret,
			Issuer:        cfg.Issuer,
			Audience:      cfg.Audience,
			TokenTTL:      ttl,
			Clock:         clock,
		},
		clock: clock,
	}
}

// IssueBackendToken produces a signed JWT and its expiry (seconds) for the validated subject.
func (i *TokenIssuer) IssueBackendToken(_ context.Context, claims GoogleClaims) (string, int64, error) {
	if len(i.config.SigningSecret) == 0 {
		return "", 0, errMissingSigningSecret
	}
	if claims.Subject == "" {
		return "", 0, errMissingSubjectClaim
	}

	now := i.clock().UTC()
	expiresAt := now.Add(i.config.TokenTTL).UTC()

	registered := jwt.RegisteredClaims{
		Subject:   claims.Subject,
		Issuer:    i.config.Issuer,
		Audience:  []string{i.config.Audience},
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(expiresAt),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, registered)
	signed, err := token.SignedString(i.config.SigningSecret)
	if err != nil {
		return "", 0, err
	}

	return signed, int64(expiresAt.Sub(now).Seconds()), nil
}

// ValidateToken ensures the backend JWT is well formed and returns the subject.
func (i *TokenIssuer) ValidateToken(tokenString string) (string, error) {
	if len(i.config.SigningSecret) == 0 {
		return "", errMissingSigningSecret
	}

	claims := &jwt.RegisteredClaims{}
	_, err := jwt.ParseWithClaims(
		tokenString,
		claims,
		func(token *jwt.Token) (interface{}, error) {
			if token.Method.Alg() != jwt.SigningMethodHS256.Alg() {
				return nil, fmt.Errorf("unexpected signing algorithm: %s", token.Method.Alg())
			}
			return i.config.SigningSecret, nil
		},
		jwt.WithAudience(i.config.Audience),
		jwt.WithIssuer(i.config.Issuer),
		jwt.WithTimeFunc(i.clock),
	)
	if err != nil {
		return "", err
	}
	if claims.Subject == "" {
		return "", errMissingSubjectClaim
	}
	return claims.Subject, nil
}
