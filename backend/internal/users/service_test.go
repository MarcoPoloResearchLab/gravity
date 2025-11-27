package users

import (
	"testing"
	"time"

	"github.com/MarcoPoloResearchLab/gravity/backend/internal/auth"
	sqlite "github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestResolveCanonicalUserIDStripsProviderPrefix(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&Identity{}); err != nil {
		t.Fatalf("failed to migrate identity schema: %v", err)
	}
	service, err := NewService(ServiceConfig{
		Database: db,
		Clock: func() time.Time {
			return time.Unix(1, 0)
		},
	})
	if err != nil {
		t.Fatalf("failed to create service: %v", err)
	}

	claims := auth.SessionClaims{
		UserID:          "google:12345",
		UserEmail:       "user@example.com",
		UserDisplayName: "Example User",
		UserAvatarURL:   "https://example.com/avatar.png",
	}
	userID, err := service.ResolveCanonicalUserID(claims)
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	if userID != "12345" {
		t.Fatalf("expected canonical user id without provider prefix, got %q", userID)
	}

	// second call should hit cache and not create a duplicate record.
	userID, err = service.ResolveCanonicalUserID(claims)
	if err != nil {
		t.Fatalf("second resolve failed: %v", err)
	}
	if userID != "12345" {
		t.Fatalf("expected canonical user id to remain stable, got %q", userID)
	}
}
