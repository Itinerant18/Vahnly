package domain

import (
	"time"
)

// DriverOTPSession mirrors the driver_otp_sessions table.
type DriverOTPSession struct {
	ID          string     `json:"id"`
	Phone       string     `json:"phone"`
	OTPHash     string     `json:"-"`
	Purpose     string     `json:"purpose"`
	Attempts    int        `json:"attempts"`
	MaxAttempts int        `json:"max_attempts"`
	ExpiresAt   time.Time  `json:"expires_at"`
	UsedAt      *time.Time `json:"used_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}
