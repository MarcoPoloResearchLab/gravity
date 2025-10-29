package auth

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
)

const (
	defaultJWKSCacheTTL = 10 * time.Minute
	defaultIssuerGoogle = "https://accounts.google.com"
	defaultIssuerAlt    = "accounts.google.com"
)

var (
	errMissingToken          = errors.New("id token must not be empty")
	errMissingKeyIdentifier  = errors.New("token missing key identifier")
	errKeyNotFound           = errors.New("signing key not found in JWKS")
	errUntrustedIssuer       = errors.New("token issuer not allowed")
	errMissingSubject        = errors.New("token missing subject claim")
	errMissingAudienceClaim  = errors.New("token missing audience claim")
	errMissingAudienceConfig = errors.New("audience configuration required")
	errMissingJWKSURL        = errors.New("jwks url configuration required")
	errNoAllowedIssuers      = errors.New("no allowed issuers configured")
	ErrInvalidVerifierConfig = errors.New("auth: invalid google verifier config")
)

// GoogleVerifierConfig bundles configuration required to instantiate a GoogleVerifier.
type GoogleVerifierConfig struct {
	Audience       string
	JWKSURL        string
	AllowedIssuers []string
	HTTPClient     *http.Client
	CacheTTL       time.Duration
	Logger         *zap.Logger
	Clock          func() time.Time
}

// GoogleClaims exposes validated claim data required by downstream services.
type GoogleClaims struct {
	Audience string
	Subject  string
	Issuer   string
	Expiry   time.Time
	IssuedAt time.Time
	TokenID  string
}

// GoogleVerifier verifies Google ID tokens offline using cached JWKS.
type GoogleVerifier struct {
	config     GoogleVerifierConfig
	logger     *zap.Logger
	httpClient *http.Client
	clock      func() time.Time
	cache      *jwksCache
	issuers    map[string]struct{}
}

// NewGoogleVerifier constructs a verifier with validated configuration.
func NewGoogleVerifier(cfg GoogleVerifierConfig) (*GoogleVerifier, error) {
	audience := strings.TrimSpace(cfg.Audience)
	if audience == "" {
		return nil, fmt.Errorf("%w: %v", ErrInvalidVerifierConfig, errMissingAudienceConfig)
	}

	jwksURL := strings.TrimSpace(cfg.JWKSURL)
	if jwksURL == "" {
		return nil, fmt.Errorf("%w: %v", ErrInvalidVerifierConfig, errMissingJWKSURL)
	}

	cacheTTL := cfg.CacheTTL
	if cacheTTL <= 0 {
		cacheTTL = defaultJWKSCacheTTL
	}

	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}

	logger := cfg.Logger
	if logger == nil {
		logger = zap.NewNop()
	}

	clock := cfg.Clock
	if clock == nil {
		clock = time.Now
	}

	issuers := make(map[string]struct{})
	if len(cfg.AllowedIssuers) == 0 {
		issuers[defaultIssuerGoogle] = struct{}{}
		issuers[defaultIssuerAlt] = struct{}{}
	} else {
		for _, issuer := range cfg.AllowedIssuers {
			normalized := strings.TrimSpace(issuer)
			if normalized == "" {
				continue
			}
			issuers[normalized] = struct{}{}
		}
		if len(issuers) == 0 {
			return nil, fmt.Errorf("%w: %v", ErrInvalidVerifierConfig, errNoAllowedIssuers)
		}
	}

	return &GoogleVerifier{
		config: GoogleVerifierConfig{
			Audience:       audience,
			JWKSURL:        jwksURL,
			AllowedIssuers: cfg.AllowedIssuers,
			HTTPClient:     httpClient,
			CacheTTL:       cacheTTL,
			Logger:         logger,
			Clock:          clock,
		},
		logger:     logger,
		httpClient: httpClient,
		clock:      clock,
		cache:      &jwksCache{ttl: cacheTTL},
		issuers:    issuers,
	}, nil
}

// Verify validates the provided ID token and returns essential claims.
func (v *GoogleVerifier) Verify(ctx context.Context, rawToken string) (GoogleClaims, error) {
	if v.config.Audience == "" {
		return GoogleClaims{}, errMissingAudienceConfig
	}
	if v.config.JWKSURL == "" {
		return GoogleClaims{}, errMissingJWKSURL
	}
	if rawToken == "" {
		return GoogleClaims{}, errMissingToken
	}

	claims := &jwt.RegisteredClaims{}
	token, err := jwt.ParseWithClaims(
		rawToken,
		claims,
		func(token *jwt.Token) (interface{}, error) {
			if token.Method.Alg() != jwt.SigningMethodRS256.Alg() {
				return nil, fmt.Errorf("unexpected signing algorithm: %s", token.Method.Alg())
			}
			keyID, _ := token.Header["kid"].(string)
			if keyID == "" {
				return nil, errMissingKeyIdentifier
			}
			key, keyErr := v.lookupKey(ctx, keyID)
			if keyErr != nil {
				return nil, keyErr
			}
			return key, nil
		},
		jwt.WithAudience(v.config.Audience),
		jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg()}),
		jwt.WithTimeFunc(v.clock),
	)
	if err != nil {
		return GoogleClaims{}, err
	}

	if !token.Valid {
		return GoogleClaims{}, errors.New("token signature invalid")
	}

	if _, allowed := v.issuers[claims.Issuer]; !allowed {
		return GoogleClaims{}, errUntrustedIssuer
	}
	if claims.Subject == "" {
		return GoogleClaims{}, errMissingSubject
	}
	if len(claims.Audience) == 0 {
		return GoogleClaims{}, errMissingAudienceClaim
	}

	expiry := time.Time{}
	if claims.ExpiresAt != nil {
		expiry = claims.ExpiresAt.Time
	}
	issuedAt := time.Time{}
	if claims.IssuedAt != nil {
		issuedAt = claims.IssuedAt.Time
	}

	return GoogleClaims{
		Audience: claims.Audience[0],
		Subject:  claims.Subject,
		Issuer:   claims.Issuer,
		Expiry:   expiry,
		IssuedAt: issuedAt,
		TokenID:  claims.ID,
	}, nil
}

func (v *GoogleVerifier) lookupKey(ctx context.Context, keyID string) (*rsa.PublicKey, error) {
	now := v.clock()
	if key := v.cache.get(keyID, now); key != nil {
		return key, nil
	}

	if err := v.refreshKeys(ctx, now); err != nil {
		return nil, err
	}

	if key := v.cache.get(keyID, now); key != nil {
		return key, nil
	}

	return nil, errKeyNotFound
}

func (v *GoogleVerifier) refreshKeys(ctx context.Context, fetchedAt time.Time) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.config.JWKSURL, nil)
	if err != nil {
		return err
	}

	response, err := v.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("jwks request returned status %d", response.StatusCode)
	}

	var document jwksDocument
	if err := json.NewDecoder(response.Body).Decode(&document); err != nil {
		return err
	}

	keyMap := make(map[string]*rsa.PublicKey, len(document.Keys))
	for _, key := range document.Keys {
		if key.KeyType != "RSA" || key.Use != "sig" {
			continue
		}
		publicKey, err := key.toRSAPublicKey()
		if err != nil {
			v.logger.Debug("skipping jwk", zap.String("kid", key.KeyID), zap.Error(err))
			continue
		}
		keyMap[key.KeyID] = publicKey
	}

	if len(keyMap) == 0 {
		return errors.New("jwks document contained no usable keys")
	}

	v.cache.store(keyMap, fetchedAt)
	return nil
}

type jwksCache struct {
	mu        sync.RWMutex
	keys      map[string]*rsa.PublicKey
	expiresAt time.Time
	ttl       time.Duration
}

func (c *jwksCache) get(keyID string, now time.Time) *rsa.PublicKey {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.keys == nil || now.After(c.expiresAt) {
		return nil
	}
	return c.keys[keyID]
}

func (c *jwksCache) store(keys map[string]*rsa.PublicKey, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.keys = keys
	c.expiresAt = now.Add(c.ttl)
}

type jwksDocument struct {
	Keys []jwk `json:"keys"`
}

type jwk struct {
	KeyType string `json:"kty"`
	Alg     string `json:"alg"`
	KeyID   string `json:"kid"`
	Use     string `json:"use"`
	Modulus string `json:"n"`
	Exp     string `json:"e"`
}

func (k jwk) toRSAPublicKey() (*rsa.PublicKey, error) {
	modulusBytes, err := base64.RawURLEncoding.DecodeString(k.Modulus)
	if err != nil {
		return nil, fmt.Errorf("invalid modulus encoding: %w", err)
	}
	exponentBytes, err := base64.RawURLEncoding.DecodeString(k.Exp)
	if err != nil {
		return nil, fmt.Errorf("invalid exponent encoding: %w", err)
	}

	if len(exponentBytes) == 0 {
		return nil, errors.New("missing exponent bytes")
	}

	exponent := 0
	for _, b := range exponentBytes {
		exponent = exponent<<8 + int(b)
	}
	if exponent == 0 {
		return nil, errors.New("invalid exponent value")
	}

	publicKey := &rsa.PublicKey{
		N: new(big.Int).SetBytes(modulusBytes),
		E: exponent,
	}

	return publicKey, nil
}
