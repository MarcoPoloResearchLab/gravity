package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/MarcoPoloResearchLab/gravity/backend/internal/auth"
	"github.com/MarcoPoloResearchLab/gravity/backend/internal/config"
	"github.com/MarcoPoloResearchLab/gravity/backend/internal/database"
	"github.com/MarcoPoloResearchLab/gravity/backend/internal/logging"
	"github.com/MarcoPoloResearchLab/gravity/backend/internal/notes"
	"github.com/MarcoPoloResearchLab/gravity/backend/internal/server"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"go.uber.org/zap"
)

var (
	cfgFile string
)

func main() {
	rootCmd := &cobra.Command{
		Use:   "gravity-api",
		Short: "Gravity Notes backend service",
		PreRunE: func(cmd *cobra.Command, args []string) error {
			return initConfig()
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			return runServer(cmd.Context())
		},
	}

	setupFlags(rootCmd)

	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func setupFlags(cmd *cobra.Command) {
	config.ApplyDefaults(viper.GetViper())
	defaults := config.NewViper()
	cmd.PersistentFlags().StringVar(&cfgFile, "config", "", "Path to configuration file")
	cmd.PersistentFlags().String("http-address", defaults.GetString("http.address"), "HTTP listen address")
	cmd.PersistentFlags().String("google-client-id", defaults.GetString("google.client_id"), "Google OAuth client ID")
	cmd.PersistentFlags().String("google-jwks-url", defaults.GetString("google.jwks_url"), "Google JWKS URL")
	cmd.PersistentFlags().String("database-path", defaults.GetString("database.path"), "SQLite database path")
	cmd.PersistentFlags().Int("token-ttl-minutes", defaults.GetInt("token.ttl_minutes"), "Backend token TTL in minutes")
	cmd.PersistentFlags().String("log-level", defaults.GetString("log.level"), "Log level (debug, info, warn, error)")
	cmd.PersistentFlags().String("signing-secret", "", "Backend signing secret (overrides env)")

	bindFlag(cmd, "http.address", "http-address")
	bindFlag(cmd, "google.client_id", "google-client-id")
	bindFlag(cmd, "google.jwks_url", "google-jwks-url")
	bindFlag(cmd, "database.path", "database-path")
	bindFlag(cmd, "token.ttl_minutes", "token-ttl-minutes")
	bindFlag(cmd, "log.level", "log-level")
	bindFlag(cmd, "auth.signing_secret", "signing-secret")
}

func bindFlag(cmd *cobra.Command, key, flag string) {
	if err := viper.BindPFlag(key, cmd.PersistentFlags().Lookup(flag)); err != nil {
		panic(err)
	}
}

func initConfig() error {
	if cfgFile != "" {
		viper.SetConfigFile(cfgFile)
	}

	if err := viper.ReadInConfig(); err != nil {
		var configNotFound viper.ConfigFileNotFoundError
		if cfgFile != "" && errors.As(err, &configNotFound) {
			return err
		}
	}

	return nil
}

func runServer(ctx context.Context) error {
	appConfig, err := config.Load(viper.GetViper())
	if err != nil {
		return err
	}

	logger, err := logging.NewLogger(appConfig.LogLevel)
	if err != nil {
		return err
	}
	defer logger.Sync() //nolint:errcheck

	db, err := database.OpenSQLite(appConfig.DatabasePath, logger)
	if err != nil {
		return err
	}
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	defer sqlDB.Close()

	tokenManager := auth.NewTokenIssuer(auth.TokenIssuerConfig{
		SigningSecret: []byte(appConfig.SigningSecret),
		Issuer:        "gravity-auth",
		Audience:      "gravity-api",
		TokenTTL:      appConfig.TokenTTL,
	})

	googleVerifier := auth.NewGoogleVerifier(auth.GoogleVerifierConfig{
		Audience:       appConfig.GoogleClientID,
		JWKSURL:        appConfig.GoogleJWKSURL,
		AllowedIssuers: []string{"https://accounts.google.com", "accounts.google.com"},
	})

	notesService, err := notes.NewService(notes.ServiceConfig{
		Database:   db,
		Clock:      time.Now,
		IDProvider: notes.NewUUIDProvider(),
	})
	if err != nil {
		return err
	}

	handler, err := server.NewHTTPHandler(server.Dependencies{
		GoogleVerifier: googleVerifier,
		TokenManager:   tokenManager,
		NotesService:   notesService,
		Logger:         logger,
	})
	if err != nil {
		return err
	}

	httpServer := &http.Server{
		Addr:    appConfig.HTTPAddress,
		Handler: handler,
	}

	signalCtx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		logger.Info("server starting", zap.String("address", appConfig.HTTPAddress))
		err := httpServer.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case <-signalCtx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return httpServer.Shutdown(shutdownCtx)
	case err := <-errCh:
		return err
	}
}
