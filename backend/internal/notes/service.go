package notes

import (
	"errors"
	"fmt"
	"time"

	"go.uber.org/zap"
	"gorm.io/gorm"
)

var (
	errMissingDatabase = errors.New("database handle is required")
	noOpLogger         = zap.NewNop()
)

type ServiceError struct {
	code string
	err  error
}

func (e *ServiceError) Error() string {
	if e.err == nil {
		return e.code
	}
	return fmt.Sprintf("%s: %v", e.code, e.err)
}

func (e *ServiceError) Unwrap() error {
	return e.err
}

func (e *ServiceError) Code() string {
	return e.code
}

const opServiceNew = "notes.service.new"

func newServiceError(operation, reason string, cause error) error {
	code := fmt.Sprintf("%s.%s", operation, reason)
	return &ServiceError{code: code, err: cause}
}

type ServiceConfig struct {
	Database *gorm.DB
	Clock    func() time.Time
	Logger   *zap.Logger
}

type Service struct {
	db     *gorm.DB
	clock  func() time.Time
	logger *zap.Logger
}

func NewService(cfg ServiceConfig) (*Service, error) {
	if cfg.Database == nil {
		return nil, newServiceError(opServiceNew, "missing_database", errMissingDatabase)
	}

	clock := cfg.Clock
	if clock == nil {
		clock = time.Now
	}

	logger := cfg.Logger
	if logger == nil {
		logger = noOpLogger
	}

	return &Service{
		db:     cfg.Database,
		clock:  clock,
		logger: logger,
	}, nil
}

func (s *Service) loggerOrDefault() *zap.Logger {
	if s == nil {
		return noOpLogger
	}
	if s.logger == nil {
		return noOpLogger
	}
	return s.logger
}

func (s *Service) logError(operation, reason string, err error, fields ...zap.Field) {
	attrs := []zap.Field{
		zap.String("operation", operation),
		zap.String("reason", reason),
	}
	if err != nil {
		attrs = append(attrs, zap.Error(err))
	}
	attrs = append(attrs, fields...)
	s.loggerOrDefault().Error("notes service error", attrs...)
}
