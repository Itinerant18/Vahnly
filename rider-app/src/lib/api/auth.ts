import { apiClient } from "./client";
import type { Rider } from "./types";

export interface VerifyOTPResponse {
  token: string;
  rider: Rider;
  is_new_rider: boolean;
}

export interface GoogleLoginResponse {
  registered?: boolean;
  email?: string;
  name?: string;
  token?: string;
  rider?: Rider;
  is_new_rider?: boolean;
}

export interface PasswordLoginResponse {
  token: string;
  refresh_token?: string;
  rider: Rider;
  is_new_rider: boolean;
}

export interface FirebaseVerifyResponse {
  success: boolean;
  is_new_user: boolean;
  data?: { token: string; refresh_token?: string };
  message?: string;
}

export const authApi = {
  sendOTP: (phone: string) =>
    apiClient.post<{ message: string; expires_in_seconds: number }>(
      "/api/v1/rider/auth/send-otp",
      { phone },
    ),

  verifyOTP: (phone: string, otp: string, referredByCode?: string) =>
    apiClient.post<VerifyOTPResponse>("/api/v1/rider/auth/verify-otp", {
      phone,
      otp,
      referred_by_code: referredByCode ?? "",
    }),

  googleLogin: (
    idToken: string,
    regData?: { phone_token: string; name?: string; referred_by_code?: string },
  ) =>
    apiClient.post<GoogleLoginResponse>("/api/v1/rider/auth/login/google", {
      id_token: idToken,
      ...(regData && {
        phone_token: regData.phone_token,
        name: regData.name,
        referred_by_code: regData.referred_by_code,
      }),
    }),

  // Phone + password login (no OTP / no SMS).
  login: (phone: string, password: string) =>
    apiClient.post<PasswordLoginResponse>("/api/v1/rider/auth/login", { phone, password }),

  forgotPassword: (phone: string) =>
    apiClient.post<{ message: string }>("/api/v1/rider/auth/forgot-password", { phone }),

  resetPassword: (phone: string, otp: string, newPassword: string) =>
    apiClient.post<PasswordLoginResponse>("/api/v1/rider/auth/reset-password", {
      phone,
      otp,
      new_password: newPassword,
    }),

  setPassword: (password: string) =>
    apiClient.post<{ message: string }>("/api/v1/rider/me/password", { password }),

  firebaseVerify: (firebaseIdToken: string, userType: "driver" | "rider") =>
    apiClient.postRaw<FirebaseVerifyResponse>("/api/v1/auth/firebase/verify", {
      firebase_id_token: firebaseIdToken,
      user_type: userType,
    }),

  me: () => apiClient.get<Rider>("/api/v1/rider/me"),

  updateProfile: (
    patch: Partial<
      Pick<Rider, "name" | "email" | "gender" | "preferred_language">
    > & {
      date_of_birth?: string;
      profile_photo_url?: string;
    },
  ) => apiClient.put<Rider>("/api/v1/rider/me", patch),
};
