package domain

import (
	"time"

	"github.com/google/uuid"
)

type TermsAudit struct {
	DriverID   uuid.UUID `json:"driver_id"`
	Version    string    `json:"version"`
	AcceptedAt time.Time `json:"accepted_at"`
	IPAddress  string    `json:"ip_address"`
	UserAgent  string    `json:"user_agent"`
}
