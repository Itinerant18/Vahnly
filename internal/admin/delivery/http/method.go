package http

import (
	"net/http"
	"slices"
)

// methodAllowed writes a 405 and returns false when r.Method is not one of the
// permitted methods. Handlers call it as a guard, e.g.:
//
//	if !methodAllowed(w, r, http.MethodGet) { return }
//
// The gateway ServeMux already routes by method, so this is a defensive layer
// that also makes the handlers unit-testable without a live router.
func methodAllowed(w http.ResponseWriter, r *http.Request, methods ...string) bool {
	if slices.Contains(methods, r.Method) {
		return true
	}
	http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
	return false
}
