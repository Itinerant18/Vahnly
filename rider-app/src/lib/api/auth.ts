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
    regData?: { phone: string; otp: string; name?: string; referred_by_code?: string },
  ) =>
    apiClient.post<GoogleLoginResponse>("/api/v1/rider/auth/login/google", {
      id_token: idToken,
      ...(regData && {
        phone: regData.phone,
        otp: regData.otp,
        name: regData.name,
        referred_by_code: regData.referred_by_code,
      }),
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
