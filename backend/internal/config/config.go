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
)

// AppConfig captures runtime configuration for the API server.
type AppConfig struct {
	HTTPAddress     string
	TAuthSigningKey string
	TAuthCookieName string
	DatabasePath    string
	LogLevel        string
}

// NewViper returns a viper instance with defaults and env bindings configured.
func NewViper() *viper.Viper {
	configViper := viper.New()
	ApplyDefaults(configViper)
	return configViper
}

// ApplyDefaults configures defaults and env bindings on the provided viper instance.
func ApplyDefaults(configViper *viper.Viper) {
	configViper.SetEnvPrefix(envPrefix)
	configViper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	configViper.AutomaticEnv()

	configViper.SetDefault("http.address", defaultHTTPAddress)
	configViper.SetDefault("database.path", defaultDatabasePath)
	configViper.SetDefault("log.level", defaultLogLevel)
	configViper.SetDefault("tauth.cookie_name", defaultCookieName)
}

// Load parses runtime configuration from viper.
func Load(configViper *viper.Viper) (AppConfig, error) {
	cfg := AppConfig{
		HTTPAddress:     configViper.GetString("http.address"),
		TAuthSigningKey: configViper.GetString("tauth.signing_secret"),
		TAuthCookieName: configViper.GetString("tauth.cookie_name"),
		DatabasePath:    configViper.GetString("database.path"),
		LogLevel:        configViper.GetString("log.level"),
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
	if strings.TrimSpace(c.TAuthCookieName) == "" {
		return fmt.Errorf("tauth.cookie_name is required")
	}
	return nil
}
