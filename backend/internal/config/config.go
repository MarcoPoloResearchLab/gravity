package config

import (
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

const (
	envPrefix           = "GRAVITY"
	defaultHTTPAddress  = "0.0.0.0:8080"
	defaultDatabasePath = "gravity.db"
	defaultLogLevel     = "info"
	defaultCookieName   = "app_session"
	defaultIssuer       = "mprlab-auth"
)

// AppConfig captures runtime configuration for the API server.
type AppConfig struct {
	HTTPAddress     string
	TAuthSigningKey string
	TAuthIssuer     string
	TAuthCookieName string
	DatabasePath    string
	LogLevel        string
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
	v.SetDefault("database.path", defaultDatabasePath)
	v.SetDefault("log.level", defaultLogLevel)
	v.SetDefault("tauth.cookie_name", defaultCookieName)
	v.SetDefault("tauth.issuer", defaultIssuer)
}

// Load parses runtime configuration from viper.
func Load(v *viper.Viper) (AppConfig, error) {
	cfg := AppConfig{
		HTTPAddress:     v.GetString("http.address"),
		TAuthSigningKey: v.GetString("tauth.signing_secret"),
		TAuthIssuer:     v.GetString("tauth.issuer"),
		TAuthCookieName: v.GetString("tauth.cookie_name"),
		DatabasePath:    v.GetString("database.path"),
		LogLevel:        v.GetString("log.level"),
	}

	if err := cfg.validate(); err != nil {
		return AppConfig{}, err
	}

	return cfg, nil
}

func (c AppConfig) validate() error {
	if strings.TrimSpace(c.TAuthSigningKey) == "" {
		return fmt.Errorf("tauth.signing_secret is required")
	}
	if strings.TrimSpace(c.DatabasePath) == "" {
		return fmt.Errorf("database.path is required")
	}
	if strings.TrimSpace(c.TAuthIssuer) == "" {
		return fmt.Errorf("tauth.issuer is required")
	}
	if strings.TrimSpace(c.TAuthCookieName) == "" {
		return fmt.Errorf("tauth.cookie_name is required")
	}
	return nil
}
