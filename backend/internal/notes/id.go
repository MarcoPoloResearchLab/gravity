package notes

import "github.com/google/uuid"

type uuidProvider struct{}

// NewUUIDProvider constructs an IDProvider that issues UUIDv7 identifiers.
func NewUUIDProvider() IDProvider {
	return &uuidProvider{}
}

func (p *uuidProvider) NewID() (string, error) {
	value, err := uuid.NewV7()
	if err != nil {
		return "", err
	}
	return value.String(), nil
}
