package http

import (
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/platform/driver-delivery/internal/rider/repository"
	"github.com/platform/driver-delivery/internal/rider/service"
)

// BookingHandler serves the rider fare-estimate + booking lifecycle API.
type BookingHandler struct {
	booking *service.BookingService
	logger  *log.Logger
}

func NewBookingHandler(booking *service.BookingService, logger *log.Logger) *BookingHandler {
	return &BookingHandler{booking: booking, logger: logger}
}

func (h *BookingHandler) writeBookingError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrInvalidBooking), errors.Is(err, service.ErrCarNotFound):
		writeError(w, http.StatusBadRequest, err.Error(), "ERR_VALIDATION")
	case errors.Is(err, service.ErrActiveOrderExists), errors.Is(err, service.ErrOrderNotCancellable),
		errors.Is(err, service.ErrAlreadyRated), errors.Is(err, service.ErrTripNotActive),
		errors.Is(err, service.ErrTooManyStops):
		writeError(w, http.StatusConflict, err.Error(), "ERR_CONFLICT")
	case errors.Is(err, service.ErrNoActiveOrder), errors.Is(err, repository.ErrOrderNotFound), errors.Is(err, service.ErrTripShareExpired):
		writeError(w, http.StatusNotFound, err.Error(), "ERR_NOT_FOUND")
	default:
		if h.logger != nil {
			h.logger.Printf("[RIDER_BOOKING] internal error: %v", err)
		}
		writeError(w, http.StatusInternalServerError, "internal server error", "ERR_INTERNAL")
	}
}

func (h *BookingHandler) riderID(w http.ResponseWriter, r *http.Request) (string, bool) {
	rider, ok := GetRiderFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing authenticated rider", "ERR_UNAUTHENTICATED")
		return "", false
	}
	return rider.ID, true
}

func (h *BookingHandler) HandleFareEstimate(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.riderID(w, r); !ok {
		return
	}
	var req service.FareEstimateRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}
	est, err := h.booking.EstimateFare(r.Context(), req)
	if err != nil {
		h.writeBookingError(w, err)
		return
	}
	writeData(w, http.StatusOK, est)
}

func (h *BookingHandler) HandleCreateOrder(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	var req service.CreateOrderRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}
	res, err := h.booking.CreateOrder(r.Context(), id, req)
	if err != nil {
		h.writeBookingError(w, err)
		return
	}
	writeData(w, http.StatusCreated, res)
}

func (h *BookingHandler) HandleGetActiveOrder(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	res, err := h.booking.GetActiveOrder(r.Context(), id)
	if err != nil {
		h.writeBookingError(w, err)
		return
	}
	writeData(w, http.StatusOK, res)
}

func (h *BookingHandler) HandleCancelOrder(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	// Body is optional for a cancel; ignore decode errors on an empty body.
	_ = decodeJSON(r, &req)

	res, err := h.booking.CancelOrder(r.Context(), id, r.PathValue("orderId"), req.Reason)
	if err != nil {
		h.writeBookingError(w, err)
		return
	}
	writeData(w, http.StatusOK, res)
}

func (h *BookingHandler) HandleOrderHistory(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	limit, offset := parsePagination(r)
	f := repository.OrderFilter{
		Status:   q.Get("status"),
		Limit:    limit,
		Offset:   offset,
		FromDate: parseDateParam(q.Get("from_date")),
		ToDate:   parseDateParam(q.Get("to_date")),
	}
	orders, total, err := h.booking.ListHistory(r.Context(), id, f)
	if err != nil {
		h.writeBookingError(w, err)
		return
	}
	writeData(w, http.StatusOK, map[string]any{
		"orders": orders,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *BookingHandler) HandleRateDriver(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	var req service.RateRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}
	if err := h.booking.RateDriver(r.Context(), id, r.PathValue("orderId"), req); err != nil {
		h.writeBookingError(w, err)
		return
	}
	writeData(w, http.StatusOK, map[string]any{"message": "rating recorded"})
}

func (h *BookingHandler) HandleSOS(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	res, err := h.booking.TriggerSOS(r.Context(), id, r.PathValue("orderId"))
	if err != nil {
		h.writeBookingError(w, err)
		return
	}
	writeData(w, http.StatusOK, res)
}

func (h *BookingHandler) HandleAddStop(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	var req service.StopDTO
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}
	order, err := h.booking.AddStop(r.Context(), id, r.PathValue("orderId"), req)
	if err != nil {
		h.writeBookingError(w, err)
		return
	}
	writeData(w, http.StatusOK, order)
}

func (h *BookingHandler) HandleExtend(w http.ResponseWriter, r *http.Request) {
	id, ok := h.riderID(w, r)
	if !ok {
		return
	}
	var req struct {
		ExtendHours int `json:"extend_hours"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", "ERR_BAD_REQUEST")
		return
	}
	order, err := h.booking.ExtendDuration(r.Context(), id, r.PathValue("orderId"), req.ExtendHours)
	if err != nil {
		h.writeBookingError(w, err)
		return
	}
	writeData(w, http.StatusOK, order)
}

// HandleTripShare is public (no auth) and returns a sanitized trip view.
func (h *BookingHandler) HandleTripShare(w http.ResponseWriter, r *http.Request) {
	view, err := h.booking.GetTripShare(r.Context(), r.PathValue("shareToken"))
	if err != nil {
		h.writeBookingError(w, err)
		return
	}
	writeData(w, http.StatusOK, view)
}

// parseDateParam accepts RFC3339 or a plain YYYY-MM-DD date; returns nil if empty/invalid.
func parseDateParam(s string) *time.Time {
	if s == "" {
		return nil
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return &t
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return &t
	}
	return nil
}
