package logging

import (
	"strings"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// NewLogger returns a zap logger configured for structured production logging.
func NewLogger(level string) (*zap.Logger, error) {
	cfg := zap.NewProductionConfig()

	switch strings.ToLower(strings.TrimSpace(level)) {
	case "debug":
		cfg.Level = zap.NewAtomicLevelAt(zapcore.DebugLevel)
	case "info", "":
		cfg.Level = zap.NewAtomicLevelAt(zapcore.InfoLevel)
	case "warn", "warning":
		cfg.Level = zap.NewAtomicLevelAt(zapcore.WarnLevel)
	case "error":
		cfg.Level = zap.NewAtomicLevelAt(zapcore.ErrorLevel)
	default:
		cfg.Level = zap.NewAtomicLevelAt(zapcore.InfoLevel)
	}

	return cfg.Build()
}
