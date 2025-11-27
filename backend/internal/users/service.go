package users

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/MarcoPoloResearchLab/gravity/backend/internal/auth"
	"gorm.io/gorm"
)

// ErrInvalidIdentity indicates the claims did not contain a usable identifier.
var ErrInvalidIdentity = errors.New("users: invalid identity")

// ServiceConfig describes the dependencies required for user identity resolution.
type ServiceConfig struct {
	Database *gorm.DB
	Clock    func() time.Time
}

// Service manages canonical user identifiers and provider-specific identities.
type Service struct {
	db    *gorm.DB
	now   func() time.Time
	cache sync.Map
}

// NewService constructs the identity service and ensures the schema is present.
func NewService(cfg ServiceConfig) (*Service, error) {
	if cfg.Database == nil {
		return nil, fmt.Errorf("users: database connection required")
	}
	clock := cfg.Clock
	if clock == nil {
		clock = time.Now
	}
	return &Service{
		db:    cfg.Database,
		now:   clock,
		cache: sync.Map{},
	}, nil
}

// ResolveCanonicalUserID returns the canonical Gravity user id for the provided session claims.
// It creates a new identity mapping when the provider+subject pair has not been seen before.
func (s *Service) ResolveCanonicalUserID(claims auth.SessionClaims) (string, error) {
	provider, subject := deriveProviderSubject(claims)
	if subject == "" {
		return "", ErrInvalidIdentity
	}

	cacheKey := provider + ":" + subject
	if cachedIdentifier, ok := s.cache.Load(cacheKey); ok {
		canonicalIdentifier, ok := cachedIdentifier.(string)
		if ok {
			return canonicalIdentifier, nil
		}
	}

	var identity Identity
	err := s.db.
		Where("provider = ? AND subject = ?", provider, subject).
		First(&identity).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		identity = Identity{
			Provider:    provider,
			Subject:     subject,
			UserID:      subject,
			Email:       normalize(claims.UserEmail),
			DisplayName: normalize(claims.UserDisplayName),
			AvatarURL:   normalize(claims.UserAvatarURL),
			LastSeenAt:  s.now(),
		}
		if identity.UserID == "" {
			return "", ErrInvalidIdentity
		}
		if err := s.db.Create(&identity).Error; err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	} else {
		updates := map[string]interface{}{}
		if email := normalize(claims.UserEmail); email != "" && email != identity.Email {
			updates["user_email"] = email
		}
		if display := normalize(claims.UserDisplayName); display != "" && display != identity.DisplayName {
			updates["user_display_name"] = display
		}
		if avatar := normalize(claims.UserAvatarURL); avatar != "" && avatar != identity.AvatarURL {
			updates["user_avatar_url"] = avatar
		}
		updates["last_seen_at"] = s.now()
		if len(updates) > 0 {
			_ = s.db.Model(&Identity{}).
				Where("provider = ? AND subject = ?", provider, subject).
				Updates(updates).
				Error
		}
	}

	s.cache.Store(cacheKey, identity.UserID)
	return identity.UserID, nil
}

func deriveProviderSubject(claims auth.SessionClaims) (string, string) {
	provider := "default"
	subject := normalize(claims.Subject)

	raw := normalize(claims.UserID)
	if raw != "" {
		if strings.Contains(raw, ":") {
			segments := strings.SplitN(raw, ":", 2)
			if normalize(segments[0]) != "" && normalize(segments[1]) != "" {
				provider = normalize(segments[0])
				subject = normalize(segments[1])
			}
		} else if subject == "" {
			subject = raw
		}
	}

	if subject == "" {
		subject = normalize(claims.UserEmail)
	}

	return provider, subject
}
