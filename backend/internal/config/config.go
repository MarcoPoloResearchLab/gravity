package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

const (
	envPrefix             = "GRAVITY"
	defaultHTTPAddress    = "0.0.0.0:8080"
	defaultGoogleJWKSURL  = "https://www.googleapis.com/oauth2/v3/certs"
	defaultDatabasePath   = "gravity.db"
	defaultLogLevel       = "info"
	defaultTokenTTLMinute = 30
)

// AppConfig captures runtime configuration for the API server.
type AppConfig struct {
	HTTPAddress    string
	GoogleClientID string
	GoogleJWKSURL  string
	SigningSecret  string
	DatabasePath   string
	TokenTTL       time.Duration
	LogLevel       string
}

// NewViper returns a viper instance with defaults and env bindings configured.
func NewViper() *viper.Viper {
	v := viper.New()
	ApplyDefaults(v)
	return v
}

// ApplyDefaults configures defaults and env bindings on the provided viper instance.
func ApplyDefaults(v *viper.Viper) {
	v.SetEnvPrefix(envPrefix)
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	v.SetDefault("http.address", defaultHTTPAddress)
	v.SetDefault("google.jwks_url", defaultGoogleJWKSURL)
	v.SetDefault("database.path", defaultDatabasePath)
	v.SetDefault("log.level", defaultLogLevel)
	v.SetDefault("token.ttl_minutes", defaultTokenTTLMinute)
}

// Load parses runtime configuration from viper.
func Load(v *viper.Viper) (AppConfig, error) {
	cfg := AppConfig{
		HTTPAddress:    v.GetString("http.address"),
		GoogleClientID: v.GetString("google.client_id"),
		GoogleJWKSURL:  v.GetString("google.jwks_url"),
		SigningSecret:  v.GetString("auth.signing_secret"),
		DatabasePath:   v.GetString("database.path"),
		LogLevel:       v.GetString("log.level"),
	}

	ttlMinutes := v.GetInt("token.ttl_minutes")
	if ttlMinutes <= 0 {
		ttlMinutes = defaultTokenTTLMinute
	}
	cfg.TokenTTL = time.Duration(ttlMinutes) * time.Minute

	if err := cfg.validate(); err != nil {
		return AppConfig{}, err
	}

	return cfg, nil
}

func (c AppConfig) validate() error {
	if strings.TrimSpace(c.GoogleClientID) == "" {
		return fmt.Errorf("google.client_id is required")
	}
	if strings.TrimSpace(c.SigningSecret) == "" {
		return fmt.Errorf("auth.signing_secret is required")
	}
	if strings.TrimSpace(c.DatabasePath) == "" {
		return fmt.Errorf("database.path is required")
	}
	if c.TokenTTL <= 0 {
		return fmt.Errorf("token.ttl_minutes must be positive")
	}
	return nil
}
