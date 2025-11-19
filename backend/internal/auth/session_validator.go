package auth

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var (
	ErrMissingSessionSigningKey = errors.New("session validator: signing key required")
	ErrMissingSessionIssuer     = errors.New("session validator: issuer required")
	ErrMissingSessionCookieName = errors.New("session validator: cookie name required")
	ErrMissingSessionToken      = errors.New("session validator: token required")
	ErrInvalidSessionToken      = errors.New("session validator: invalid token")
	ErrExpiredSessionToken      = errors.New("session validator: token expired")
	ErrMissingSessionSubject    = errors.New("session validator: subject required")
)

// SessionClaims mirrors the JWT payload emitted by TAuth.
type SessionClaims struct {
	UserID          string   `json:"user_id"`
	UserEmail       string   `json:"user_email"`
	UserDisplayName string   `json:"user_display_name"`
	UserAvatarURL   string   `json:"user_avatar_url"`
	UserRoles       []string `json:"user_roles"`
	jwt.RegisteredClaims
}

// SessionValidatorConfig describes how to validate TAuth-issued JWTs.
type SessionValidatorConfig struct {
	SigningSecret []byte
	Issuer        string
	CookieName    string
	Clock         func() time.Time
}

// SessionValidator validates HS256 JWTs issued by TAuth.
type SessionValidator struct {
	signingSecret []byte
	issuer        string
	cookieName    string
	clock         func() time.Time
}

// NewSessionValidator constructs a validator with the provided configuration.
func NewSessionValidator(cfg SessionValidatorConfig) (*SessionValidator, error) {
	if len(cfg.SigningSecret) == 0 {
		return nil, ErrMissingSessionSigningKey
	}
	issuer := strings.TrimSpace(cfg.Issuer)
	if issuer == "" {
		return nil, ErrMissingSessionIssuer
	}
	cookieName := strings.TrimSpace(cfg.CookieName)
	if cookieName == "" {
		return nil, ErrMissingSessionCookieName
	}
	clock := cfg.Clock
	if clock == nil {
		clock = time.Now
	}
	return &SessionValidator{
		signingSecret: append([]byte(nil), cfg.SigningSecret...),
		issuer:        issuer,
		cookieName:    cookieName,
		clock:         clock,
	}, nil
}

// CookieName returns the cookie name configured for session lookups.
func (v *SessionValidator) CookieName() string {
	return v.cookieName
}

// ValidateToken validates the supplied JWT string and returns the parsed claims.
func (v *SessionValidator) ValidateToken(tokenString string) (SessionClaims, error) {
	token := strings.TrimSpace(tokenString)
	if token == "" {
		return SessionClaims{}, ErrMissingSessionToken
	}

	claims := &SessionClaims{}
	parsed, err := jwt.ParseWithClaims(
		token,
		claims,
		func(t *jwt.Token) (interface{}, error) {
			if t.Method.Alg() != jwt.SigningMethodHS256.Alg() {
				return nil, fmt.Errorf("%w: unexpected signing algorithm %s", ErrInvalidSessionToken, t.Method.Alg())
			}
			return v.signingSecret, nil
		},
		jwt.WithTimeFunc(v.clock),
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
	)
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return SessionClaims{}, ErrExpiredSessionToken
		}
		return SessionClaims{}, fmt.Errorf("%w: %v", ErrInvalidSessionToken, err)
	}
	if parsed == nil || !parsed.Valid {
		return SessionClaims{}, ErrInvalidSessionToken
	}
	if claims.Issuer != v.issuer {
		return SessionClaims{}, ErrInvalidSessionToken
	}
	if strings.TrimSpace(claims.Subject) == "" || strings.TrimSpace(claims.UserID) == "" {
		return SessionClaims{}, ErrMissingSessionSubject
	}
	return *claims, nil
}

// ValidateRequest extracts the configured cookie from the request and validates it.
func (v *SessionValidator) ValidateRequest(r *http.Request) (SessionClaims, error) {
	if r == nil {
		return SessionClaims{}, ErrMissingSessionToken
	}
	cookie, err := r.Cookie(v.cookieName)
	if err != nil || cookie == nil {
		return SessionClaims{}, ErrMissingSessionToken
	}
	return v.ValidateToken(cookie.Value)
}
