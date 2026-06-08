package positioning

import (
	"encoding/json"
	"net/http"
)

// NudgeRequest is the payload for POST /api/internal/surge/nudge. The inference
// engine or simulator targets a supply-starved H3 cell and names the source cell
// whose idle drivers should be steered toward it.
type NudgeRequest struct {
	TargetH3Cell string  `json:"target_h3_cell"`
	SourceH3Cell string  `json:"source_h3_cell"`
	Message      string  `json:"message,omitempty"`
	BonusVector  float64 `json:"bonus_vector,omitempty"`
	MaxDrivers   int64   `json:"max_drivers,omitempty"`
}

type NudgeResponse struct {
	DriversNudged int    `json:"drivers_nudged"`
	TargetH3Cell  string `json:"target_h3_cell"`
	SourceH3Cell  string `json:"source_h3_cell"`
}

// NudgeHTTPHandler exposes the rebalancer's incentive broadcast as an internal
// HTTP endpoint so the predictive inference engine (or the dispatch simulator
// seeding demand spikes) can drive positioning incentives on demand.
type NudgeHTTPHandler struct {
	rebalancer *FleetRebalancer
}

func NewNudgeHTTPHandler(r *FleetRebalancer) *NudgeHTTPHandler {
	return &NudgeHTTPHandler{rebalancer: r}
}

func (h *NudgeHTTPHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return
	}

	var req NudgeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid_request_body", http.StatusBadRequest)
		return
	}
	if req.TargetH3Cell == "" {
		http.Error(w, "missing_target_h3_cell", http.StatusBadRequest)
		return
	}
	if req.SourceH3Cell == "" {
		http.Error(w, "missing_source_h3_cell", http.StatusBadRequest)
		return
	}

	n, err := h.rebalancer.NudgeDrivers(r.Context(), req.TargetH3Cell, req.SourceH3Cell, req.Message, req.BonusVector, req.MaxDrivers)
	if err != nil {
		http.Error(w, "nudge_broadcast_failed", http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(NudgeResponse{
		DriversNudged: n,
		TargetH3Cell:  req.TargetH3Cell,
		SourceH3Cell:  req.SourceH3Cell,
	})
}
