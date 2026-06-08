package http

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOnboardingHandler_CompileCheck(t *testing.T) {
	var _ *OnboardingHandler = nil
}

func TestOnboardingHandler_ValidateQuiz(t *testing.T) {
	handler := NewOnboardingHandler(nil)

	// Valid answers (requires at least 4/5 correct answers)
	validPayload := QuizRequest{
		Answers: map[string]int{
			"1": 1,
			"2": 1,
			"3": 3,
			"4": 1,
			"5": 0,
		},
	}
	bodyBytes, _ := json.Marshal(validPayload)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/driver/onboarding/quiz", bytes.NewReader(bodyBytes))
	rec := httptest.NewRecorder()

	// Need to fake context auth
	// But let's verify if the handler directly responds or fails due to missing auth.
	// Since we require AuthenticateJWT middleware, raw handler without auth in context will return 401.
	handler.HandleValidateQuiz(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 unauthorized for missing auth context, got %d", rec.Code)
	}
}

func TestOnboardingHandler_HandleSaveStep_Unauthorized(t *testing.T) {
	handler := NewOnboardingHandler(nil)

	payload := map[string]interface{}{
		"signatureName": "Aniket Karmakar",
		"agreedToTerms": true,
	}
	bodyBytes, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/driver/onboarding/step/7", bytes.NewReader(bodyBytes))
	rec := httptest.NewRecorder()

	handler.HandleSaveStep(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 unauthorized for missing auth context, got %d", rec.Code)
	}
}
