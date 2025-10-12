package notes

import "github.com/google/uuid"

type uuidProvider struct{}

func newUUIDProvider() IDProvider {
	return &uuidProvider{}
}

func (p *uuidProvider) NewID() (string, error) {
	value, err := uuid.NewV7()
	if err != nil {
		return "", err
	}
	return value.String(), nil
}
