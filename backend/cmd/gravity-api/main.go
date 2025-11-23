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
	cmd.PersistentFlags().String("database-path", defaults.GetString("database.path"), "SQLite database path")
	cmd.PersistentFlags().String("log-level", defaults.GetString("log.level"), "Log level (debug, info, warn, error)")
	cmd.PersistentFlags().String("tauth-signing-secret", defaults.GetString("tauth.signing_secret"), "Shared HS256 signing secret from TAuth")
	cmd.PersistentFlags().String("tauth-issuer", defaults.GetString("tauth.issuer"), "Expected issuer for TAuth session tokens")
	cmd.PersistentFlags().String("tauth-cookie-name", defaults.GetString("tauth.cookie_name"), "Cookie name carrying the TAuth session token")

	bindFlag(cmd, "http.address", "http-address")
	bindFlag(cmd, "database.path", "database-path")
	bindFlag(cmd, "log.level", "log-level")
	bindFlag(cmd, "tauth.signing_secret", "tauth-signing-secret")
	bindFlag(cmd, "tauth.issuer", "tauth-issuer")
	bindFlag(cmd, "tauth.cookie_name", "tauth-cookie-name")
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

	sessionValidator, err := auth.NewSessionValidator(auth.SessionValidatorConfig{
		SigningSecret: []byte(appConfig.TAuthSigningKey),
		Issuer:        appConfig.TAuthIssuer,
		CookieName:    appConfig.TAuthCookieName,
	})
	if err != nil {
		return err
	}

	notesService, err := notes.NewService(notes.ServiceConfig{
		Database:   db,
		Clock:      time.Now,
		IDProvider: notes.NewUUIDProvider(),
	})
	if err != nil {
		return err
	}

	handler, err := server.NewHTTPHandler(server.Dependencies{
		SessionValidator: sessionValidator,
		SessionCookie:    appConfig.TAuthCookieName,
		NotesService:     notesService,
		Logger:           logger,
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
