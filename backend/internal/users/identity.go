package users

import (
	"strings"
	"time"
)

// Identity captures the mapping between a canonical Gravity user id and a provider-specific login.
type Identity struct {
	Provider    string    `gorm:"column:provider;primaryKey;size:32;not null"`
	Subject     string    `gorm:"column:subject;primaryKey;size:190;not null"`
	UserID      string    `gorm:"column:user_id;size:190;not null;index"`
	Email       string    `gorm:"column:user_email;size:320"`
	DisplayName string    `gorm:"column:user_display_name;size:320"`
	AvatarURL   string    `gorm:"column:user_avatar_url;size:512"`
	LastSeenAt  time.Time `gorm:"column:last_seen_at;autoUpdateTime"`
	CreatedAt   time.Time `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt   time.Time `gorm:"column:updated_at;autoUpdateTime"`
}

// TableName exposes the table backing user identities.
func (Identity) TableName() string {
	return "user_identities"
}

// normalize value helper used across service implementation.
func normalize(value string) string {
	return strings.TrimSpace(value)
}
