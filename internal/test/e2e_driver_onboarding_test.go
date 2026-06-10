package test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	driverHttp "github.com/platform/driver-delivery/internal/driver/delivery/http"
)

// TestOnboardingStepSave verifies that submitting step data produces a 200 OK with the correct step echoed back.
func TestOnboardingStepSave(t *testing.T) {
	dbPool := getTestDBPool(t)
	handler := driverHttp.NewOnboardingHandler(dbPool)

	// Ensure a test driver exists
	driverID := ensureTestDriver(t, dbPool)

	for stepID := 1; stepID <= 7; stepID++ {
		t.Run(fmt.Sprintf("Step_%d", stepID), func(t *testing.T) {
			payload := buildStepPayload(stepID)
			body, _ := json.Marshal(payload)

			url := fmt.Sprintf("/api/v1/driver/onboarding/step/%d", stepID)
			req := httptest.NewRequest(http.MethodPost, url, bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req.SetPathValue("step_id", fmt.Sprintf("%d", stepID))
			req = injectDriverContext(req, driverID)

			rr := httptest.NewRecorder()
			handler.HandleSaveStep(rr, req)

			if rr.Code != http.StatusOK {
				t.Fatalf("Step %d: expected 200, got %d: %s", stepID, rr.Code, rr.Body.String())
			}

			var resp map[string]interface{}
			if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
				t.Fatalf("Step %d: failed to decode response: %v", stepID, err)
			}

			if resp["success"] != true {
				t.Fatalf("Step %d: expected success=true, got %v", stepID, resp["success"])
			}

			// The echoed step should match the submitted step
			if int(resp["onboarding_step"].(float64)) != stepID {
				t.Fatalf("Step %d: expected onboarding_step=%d, got %v", stepID, stepID, resp["onboarding_step"])
			}
		})
	}
}

// TestOnboardingQuizPass verifies that submitting correct quiz answers passes with score >= 4/5.
func TestOnboardingQuizPass(t *testing.T) {
	dbPool := getTestDBPool(t)
	handler := driverHttp.NewOnboardingHandler(dbPool)
	driverID := ensureTestDriver(t, dbPool)

	quizPayload := map[string]interface{}{
		"answers": map[string]int{
			"1": 1,
			"2": 1,
			"3": 3,
			"4": 1,
			"5": 0,
		},
	}

	body, _ := json.Marshal(quizPayload)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/driver/onboarding/quiz", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = injectDriverContext(req, driverID)

	rr := httptest.NewRecorder()
	handler.HandleValidateQuiz(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("Quiz pass: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("Quiz: failed to decode response: %v", err)
	}

	if resp["passed"] != true {
		t.Fatalf("Quiz: expected passed=true, got %v (score=%v)", resp["passed"], resp["score"])
	}

	if int(resp["score"].(float64)) < 4 {
		t.Fatalf("Quiz: expected score >= 4, got %v", resp["score"])
	}
}

// TestOnboardingQuizFail verifies that submitting incorrect answers fails the quiz.
func TestOnboardingQuizFail(t *testing.T) {
	dbPool := getTestDBPool(t)
	handler := driverHttp.NewOnboardingHandler(dbPool)
	driverID := ensureTestDriver(t, dbPool)

	quizPayload := map[string]interface{}{
		"answers": map[string]int{
			"1": 0, // wrong
			"2": 0, // wrong
			"3": 0, // wrong
			"4": 0, // wrong
			"5": 1, // wrong
		},
	}

	body, _ := json.Marshal(quizPayload)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/driver/onboarding/quiz", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = injectDriverContext(req, driverID)

	rr := httptest.NewRecorder()
	handler.HandleValidateQuiz(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("Quiz fail: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("Quiz: failed to decode response: %v", err)
	}

	if resp["passed"] != false {
		t.Fatalf("Quiz: expected passed=false, got %v (score=%v)", resp["passed"], resp["score"])
	}
}

// TestOnboardingInvalidStep verifies that out-of-range step IDs are rejected with 400.
func TestOnboardingInvalidStep(t *testing.T) {
	dbPool := getTestDBPool(t)
	handler := driverHttp.NewOnboardingHandler(dbPool)
	driverID := ensureTestDriver(t, dbPool)

	invalidSteps := []string{"0", "9", "-1", "abc"}
	for _, stepStr := range invalidSteps {
		t.Run("InvalidStep_"+stepStr, func(t *testing.T) {
			body, _ := json.Marshal(map[string]string{"test": "data"})
			req := httptest.NewRequest(http.MethodPost, "/api/v1/driver/onboarding/step/"+stepStr, bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req.SetPathValue("step_id", stepStr)
			req = injectDriverContext(req, driverID)

			rr := httptest.NewRecorder()
			handler.HandleSaveStep(rr, req)

			if rr.Code != http.StatusBadRequest {
				t.Fatalf("Expected 400 for step=%s, got %d", stepStr, rr.Code)
			}
		})
	}
}

// buildStepPayload returns a mock payload for the given onboarding step.
func buildStepPayload(stepID int) map[string]interface{} {
	switch stepID {
	case 1:
		return map[string]interface{}{
			"fullName":  "Rajesh Kumar",
			"dob":       "1990-05-15",
			"gender":    "Male",
			"languages": []string{"Hindi", "Bengali", "English"},
		}
	case 2:
		return map[string]interface{}{
			"permAddress": "45 Park Street, Kolkata 700071",
			"currAddress": "45 Park Street, Kolkata 700071",
			"city":        "Kolkata",
		}
	case 3:
		return map[string]interface{}{
			"drivingLicense":     "/uploads/dl_front.pdf",
			"aadhaarId":          "/uploads/aadhaar.pdf",
			"panCard":            "/uploads/pan.pdf",
			"policeVerification": "/uploads/police.pdf",
		}
	case 4:
		return map[string]interface{}{
			"manualExpertise":    true,
			"automaticExpertise": true,
			"yearsOfExperience":  "8",
		}
	case 5:
		return map[string]interface{}{
			"accountNo":  "1234567890",
			"ifscCode":   "SBIN0001234",
			"holderName": "Rajesh Kumar",
			"upiId":      "rajesh@okicici",
		}
	case 6:
		return map[string]interface{}{
			"emergencyName":     "Priya Kumar",
			"emergencyRelation": "Spouse",
			"emergencyPhone":    "+919876543210",
		}
	case 7:
		return map[string]interface{}{
			"signatureName": "Rajesh Kumar",
			"agreedToTerms": true,
		}
	default:
		return map[string]interface{}{}
	}
}
