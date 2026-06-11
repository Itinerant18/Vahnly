package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/platform/driver-delivery/internal/domain"
)

// ReferralRepo is the persistence slice the referral service needs. The concrete
// postgres rider repository satisfies it.
type ReferralRepo interface {
	GetRiderIDByReferralCode(ctx context.Context, code string) (string, error)
	CreatePendingReferral(ctx context.Context, referrerID, referredID, code string) error
	RewardReferral(ctx context.Context, referredRiderID string) (*domain.ReferralReward, error)
}

// ReferralNotifier pushes referral notifications. *notification.RiderNotifier satisfies it.
type ReferralNotifier interface {
	NotifyRider(ctx context.Context, riderID, notifType, title, body string, data map[string]any) error
}

type ReferralService struct {
	repo     ReferralRepo
	notifier ReferralNotifier
}

func NewReferralService(repo ReferralRepo, notifier ReferralNotifier) *ReferralService {
	return &ReferralService{repo: repo, notifier: notifier}
}

// AttachReferral links a new rider to the referrer who owns referredByCode.
// Best-effort: an empty / invalid / self code is silently ignored so it can never
// block signup. Notifies the referrer that someone joined.
func (s *ReferralService) AttachReferral(ctx context.Context, newRiderID, referredByCode string) {
	code := strings.ToUpper(strings.TrimSpace(referredByCode))
	if code == "" {
		return
	}
	referrerID, err := s.repo.GetRiderIDByReferralCode(ctx, code)
	if err != nil || referrerID == "" || referrerID == newRiderID {
		return
	}
	if err := s.repo.CreatePendingReferral(ctx, referrerID, newRiderID, code); err != nil {
		return
	}
	if s.notifier != nil {
		_ = s.notifier.NotifyRider(ctx, referrerID, "REFERRAL_JOINED",
			"Referral joined!", "Someone joined using your code!",
			map[string]any{"referred_rider_id": newRiderID})
	}
}

// RewardFirstCompletedTrip credits both parties and notifies them. Idempotent:
// the underlying RewardReferral only pays out while the referral is not yet
// REWARDED, so calling this on every completed trip still rewards exactly once.
func (s *ReferralService) RewardFirstCompletedTrip(ctx context.Context, referredRiderID string) error {
	res, err := s.repo.RewardReferral(ctx, referredRiderID)
	if err != nil {
		return err
	}
	if !res.Rewarded {
		return nil
	}
	if s.notifier != nil {
		_ = s.notifier.NotifyRider(ctx, res.ReferrerRiderID, "REFERRAL_REWARDED",
			"Referral bonus!", fmt.Sprintf("You earned ₹%d in referral bonus!", res.ReferrerCreditPaise/100),
			map[string]any{"amount_paise": res.ReferrerCreditPaise})
		_ = s.notifier.NotifyRider(ctx, res.ReferredRiderID, "REFERRAL_REWARDED",
			"Referral bonus!", fmt.Sprintf("You earned ₹%d in referral bonus!", res.ReferredCreditPaise/100),
			map[string]any{"amount_paise": res.ReferredCreditPaise})
	}
	return nil
}
