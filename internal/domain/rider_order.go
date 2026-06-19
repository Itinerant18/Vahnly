package domain

import (
	"encoding/json"
	"time"
)

// RiderOrder is a rider-facing projection of the orders table (rider columns
// added in migrations 000083 + 000087). Monetary values are paise (integers).
type RiderOrder struct {
	ID               string  `json:"id"`
	Status           string  `json:"status"`
	CityPrefix       string  `json:"city_prefix"`
	RiderID          *string `json:"rider_id,omitempty"`
	AssignedDriverID *string `json:"assigned_driver_id,omitempty"`

	PickupLat      float64  `json:"pickup_lat"`
	PickupLng      float64  `json:"pickup_lng"`
	PickupAddress  *string  `json:"pickup_address,omitempty"`
	DropoffLat     *float64 `json:"dropoff_lat,omitempty"`
	DropoffLng     *float64 `json:"dropoff_lng,omitempty"`
	DropoffAddress *string  `json:"dropoff_address,omitempty"`
	PickupH3Cell   string   `json:"pickup_h3_cell"`

	GarageCarID            *string `json:"garage_car_id,omitempty"`
	OneTimeCarMake         *string `json:"one_time_car_make,omitempty"`
	OneTimeCarModel        *string `json:"one_time_car_model,omitempty"`
	OneTimeCarType         *string `json:"one_time_car_type,omitempty"`
	OneTimeCarTransmission *string `json:"one_time_car_transmission,omitempty"`

	BaseFarePaise      int64   `json:"base_fare_paise"`
	SurgeMultiplier    float64 `json:"surge_multiplier"`
	PromoCode          *string `json:"promo_code,omitempty"`
	PromoDiscountPaise int64   `json:"promo_discount_paise"`
	D4MCareOpted       bool    `json:"d4m_care_opted"`
	PaymentMethod      *string `json:"payment_method,omitempty"`

	PersonsCount *int            `json:"persons_count,omitempty"`
	RiderStops   json.RawMessage `json:"stops,omitempty"`
	ScheduledAt  *time.Time      `json:"scheduled_at,omitempty"`
	TripType     *string         `json:"trip_type,omitempty"`

	TripShareToken     *string    `json:"trip_share_token,omitempty"`
	TripShareExpiresAt *time.Time `json:"trip_share_expires_at,omitempty"`

	RiderRatingForDriver *int     `json:"rider_rating_for_driver,omitempty"`
	RiderTipPaise        int64    `json:"rider_tip_paise"`
	RiderReviewTags      []string `json:"rider_review_tags,omitempty"`
	RiderReviewComment   *string  `json:"rider_review_comment,omitempty"`

	DriverRatingForRider *int     `json:"driver_rating_for_rider,omitempty"`
	DriverReviewTags     []string `json:"driver_review_tags,omitempty"`
	DriverReviewComment  *string  `json:"driver_review_comment,omitempty"`

	CancelledBy        *string `json:"cancelled_by,omitempty"`
	CancellationReason *string `json:"cancellation_reason,omitempty"`

	AssignedAt  *time.Time `json:"assigned_at,omitempty"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}
