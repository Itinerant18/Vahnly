package service

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/platform/driver-delivery/internal/domain"
)

// Validation sentinels for onboarding. Handlers translate these to 400/409.
var (
	ErrMaxEmergencyContacts = errors.New("maximum of 3 emergency contacts reached")
	ErrInvalidName          = errors.New("name must be 2-100 characters")
	ErrInvalidEmail         = errors.New("invalid email address")
	ErrUnderage             = errors.New("rider must be at least 18 years old")
	ErrInvalidDOB           = errors.New("invalid date of birth (expected YYYY-MM-DD)")
	ErrLocationOutOfBounds  = errors.New("location is outside the supported service area")
	ErrMissingCarField      = errors.New("missing required car field")
	ErrInvalidGender        = errors.New("invalid gender")
)

const maxEmergencyContacts = 3

// India bounding box used to sanity-check saved-place coordinates.
const (
	indiaMinLat = 6.0
	indiaMaxLat = 37.0
	indiaMinLng = 68.0
	indiaMaxLng = 98.0
)

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

var validGenders = map[string]bool{"MALE": true, "FEMALE": true, "OTHER": true, "PREFER_NOT": true}

// OnboardingRepository is the slice of RiderRepository onboarding needs. The
// concrete postgres repository satisfies it structurally.
type OnboardingRepository interface {
	GetRiderByID(ctx context.Context, id string) (*domain.Rider, error)
	UpdateRider(ctx context.Context, rider *domain.Rider) (*domain.Rider, error)
	UpsertGarageCar(ctx context.Context, car *domain.RiderGarageCar) (*domain.RiderGarageCar, error)
	UpsertSavedPlace(ctx context.Context, place *domain.RiderSavedPlace) (*domain.RiderSavedPlace, error)
	DeleteSavedPlaceByLabel(ctx context.Context, riderID, label string) error
	GetEmergencyContacts(ctx context.Context, riderID string) ([]*domain.RiderEmergencyContact, error)
	UpsertEmergencyContact(ctx context.Context, contact *domain.RiderEmergencyContact) error
}

type OnboardingService struct {
	repo OnboardingRepository
}

func NewOnboardingService(repo OnboardingRepository) *OnboardingService {
	return &OnboardingService{repo: repo}
}

// ---- request DTOs ----

type UpdateProfileRequest struct {
	Name              *string `json:"name"`
	Email             *string `json:"email"`
	Gender            *string `json:"gender"`
	DateOfBirth       *string `json:"date_of_birth"` // YYYY-MM-DD
	ProfilePhotoURL   *string `json:"profile_photo_url"`
	PreferredLanguage *string `json:"preferred_language"`
}

type GarageCarRequest struct {
	ID                string  `json:"id"`
	Make              string  `json:"make"`
	Model             string  `json:"model"`
	Year              int     `json:"year"`
	CarType           string  `json:"car_type"`
	Transmission      string  `json:"transmission"`
	FuelType          *string `json:"fuel_type"`
	RegistrationPlate string  `json:"registration_plate"`
	Color             *string `json:"color"`
	IsDefault         bool    `json:"is_default"`
}

type SavePlaceRequest struct {
	ID          string  `json:"id"`
	Label       string  `json:"label"`
	DisplayName string  `json:"display_name"`
	AddressText string  `json:"address_text"`
	Lat         float64 `json:"lat"`
	Lng         float64 `json:"lng"`
}

type EmergencyContactRequest struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Phone         string `json:"phone"`
	Relationship  string `json:"relationship"`
	AutoShareTrip bool   `json:"auto_share_trip"`
	DisplayOrder  int    `json:"display_order"`
}

// UpdateProfile validates and applies a partial profile update. Only fields
// present in the request are changed.
func (s *OnboardingService) UpdateProfile(ctx context.Context, riderID string, req UpdateProfileRequest) (*domain.Rider, error) {
	rider, err := s.repo.GetRiderByID(ctx, riderID)
	if err != nil {
		return nil, err
	}

	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if len(name) < 2 || len(name) > 100 {
			return nil, ErrInvalidName
		}
		rider.Name = &name
	}
	if req.Email != nil {
		email := strings.TrimSpace(*req.Email)
		if email != "" {
			if !emailRe.MatchString(email) {
				return nil, ErrInvalidEmail
			}
			rider.Email = &email
		}
	}
	if req.Gender != nil {
		g := strings.ToUpper(strings.TrimSpace(*req.Gender))
		if !validGenders[g] {
			return nil, ErrInvalidGender
		}
		rider.Gender = &g
	}
	if req.DateOfBirth != nil && *req.DateOfBirth != "" {
		dob, err := time.Parse("2006-01-02", *req.DateOfBirth)
		if err != nil {
			return nil, ErrInvalidDOB
		}
		if ageYears(dob) < 18 {
			return nil, ErrUnderage
		}
		rider.DateOfBirth = &dob
	}
	if req.ProfilePhotoURL != nil {
		rider.ProfilePhotoURL = req.ProfilePhotoURL
	}
	if req.PreferredLanguage != nil && *req.PreferredLanguage != "" {
		rider.PreferredLanguage = *req.PreferredLanguage
	}

	return s.repo.UpdateRider(ctx, rider)
}

// ageYears returns the rider's full years of age as of now.
func ageYears(dob time.Time) int {
	now := time.Now()
	years := now.Year() - dob.Year()
	if now.YearDay() < dob.YearDay() {
		years--
	}
	return years
}

// AddGarageCar validates required fields and upserts a car. When IsDefault is
// set the repository atomically clears the previous default.
func (s *OnboardingService) AddGarageCar(ctx context.Context, riderID string, req GarageCarRequest) (*domain.RiderGarageCar, error) {
	if strings.TrimSpace(req.Make) == "" || strings.TrimSpace(req.Model) == "" ||
		strings.TrimSpace(req.RegistrationPlate) == "" || req.Year == 0 ||
		strings.TrimSpace(req.CarType) == "" || strings.TrimSpace(req.Transmission) == "" {
		return nil, ErrMissingCarField
	}

	car := &domain.RiderGarageCar{
		ID:                req.ID,
		RiderID:           riderID,
		Make:              req.Make,
		Model:             req.Model,
		Year:              req.Year,
		CarType:           strings.ToUpper(req.CarType),
		Transmission:      strings.ToUpper(req.Transmission),
		FuelType:          normalizeFuelType(req.FuelType),
		RegistrationPlate: strings.ToUpper(strings.TrimSpace(req.RegistrationPlate)),
		Color:             req.Color,
		IsDefault:         req.IsDefault,
	}
	return s.repo.UpsertGarageCar(ctx, car)
}

// normalizeFuelType coerces free-text fuel input to the rider_garage CHECK enum
// (PETROL/DIESEL/CNG/ELECTRIC/HYBRID). Anything unrecognised or empty becomes NULL,
// which the constraint permits — so a stray "Petrol" or blank never 500s the insert.
func normalizeFuelType(in *string) *string {
	if in == nil {
		return nil
	}
	v := strings.ToUpper(strings.TrimSpace(*in))
	switch v {
	case "PETROL", "DIESEL", "CNG", "ELECTRIC", "HYBRID":
		return &v
	case "GAS", "GASOLINE":
		p := "PETROL"
		return &p
	case "EV":
		e := "ELECTRIC"
		return &e
	}
	return nil
}

// SavePlace validates the coordinates against the India bounding box and saves
// the place. HOME/WORK labels are singletons — the prior entry is replaced.
func (s *OnboardingService) SavePlace(ctx context.Context, riderID string, req SavePlaceRequest) (*domain.RiderSavedPlace, error) {
	if req.Lat < indiaMinLat || req.Lat > indiaMaxLat || req.Lng < indiaMinLng || req.Lng > indiaMaxLng {
		return nil, ErrLocationOutOfBounds
	}
	label := strings.ToUpper(strings.TrimSpace(req.Label))
	if label != "HOME" && label != "WORK" && label != "CUSTOM" {
		return nil, errors.New("label must be HOME, WORK or CUSTOM")
	}
	if strings.TrimSpace(req.DisplayName) == "" || strings.TrimSpace(req.AddressText) == "" {
		return nil, errors.New("display_name and address_text are required")
	}

	// HOME and WORK are singletons; drop any existing same-label entry first.
	if label == "HOME" || label == "WORK" {
		if err := s.repo.DeleteSavedPlaceByLabel(ctx, riderID, label); err != nil {
			return nil, err
		}
	}

	place := &domain.RiderSavedPlace{
		ID:          req.ID,
		RiderID:     riderID,
		Label:       label,
		DisplayName: req.DisplayName,
		AddressText: req.AddressText,
		Lat:         req.Lat,
		Lng:         req.Lng,
	}
	return s.repo.UpsertSavedPlace(ctx, place)
}

// AddEmergencyContact enforces the 3-contact cap in the service layer (the DB
// trigger is the backstop) and validates the contact phone.
func (s *OnboardingService) AddEmergencyContact(ctx context.Context, riderID string, req EmergencyContactRequest) error {
	existing, err := s.repo.GetEmergencyContacts(ctx, riderID)
	if err != nil {
		return err
	}
	// Only enforce the cap on inserts (no ID); an update replaces in place.
	if req.ID == "" && len(existing) >= maxEmergencyContacts {
		return ErrMaxEmergencyContacts
	}

	phone := normalizePhone(req.Phone)
	if !indiaPhoneRe.MatchString(phone) {
		return ErrInvalidPhone
	}
	if strings.TrimSpace(req.Name) == "" {
		return errors.New("name is required")
	}

	var relationship *string
	if strings.TrimSpace(req.Relationship) != "" {
		relationship = &req.Relationship
	}
	contact := &domain.RiderEmergencyContact{
		ID:            req.ID,
		RiderID:       riderID,
		Name:          req.Name,
		Phone:         phone,
		Relationship:  relationship,
		AutoShareTrip: req.AutoShareTrip,
		DisplayOrder:  req.DisplayOrder,
	}
	return s.repo.UpsertEmergencyContact(ctx, contact)
}
