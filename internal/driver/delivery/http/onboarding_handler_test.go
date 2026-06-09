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

func TestMissingRequiredField(t *testing.T) {
	cases := []struct {
		name        string
		step        int
		data        map[string]interface{}
		wantMissing string
	}{
		{"step1 complete", 1, map[string]interface{}{"fullName": "A", "dob": "2000-01-01", "gender": "M"}, ""},
		{"step1 blank name", 1, map[string]interface{}{"fullName": "  ", "dob": "x", "gender": "M"}, "fullName"},
		{"step1 missing gender", 1, map[string]interface{}{"fullName": "A", "dob": "x"}, "gender"},
		{"step5 complete", 5, map[string]interface{}{"accountNo": "123", "ifscCode": "IFSC", "holderName": "A"}, ""},
		{"step5 missing account", 5, map[string]interface{}{"ifscCode": "IFSC", "holderName": "A"}, "accountNo"},
		{"step4 has years", 4, map[string]interface{}{"yearsOfExperience": float64(0)}, ""},
		{"step4 missing years", 4, map[string]interface{}{}, "yearsOfExperience"},
		{"step7 agreed", 7, map[string]interface{}{"signatureName": "A", "agreedToTerms": true}, ""},
		{"step7 not agreed", 7, map[string]interface{}{"signatureName": "A", "agreedToTerms": false}, "agreedToTerms"},
		{"step7 missing signature", 7, map[string]interface{}{"agreedToTerms": true}, "signatureName"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := missingRequiredField(tc.step, tc.data); got != tc.wantMissing {
				t.Errorf("missingRequiredField(%d) = %q, want %q", tc.step, got, tc.wantMissing)
			}
		})
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
