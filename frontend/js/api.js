// fetch wrapper for the BloodLink API: bearer token, {error} parsing,
// global 401 handling, 60 s timeout (cold starts).

import { API_BASE, REQUEST_TIMEOUT_MS } from "./config.js";
import { getToken, clearSession, loginPageFor } from "./auth.js";

export class ApiError extends Error {
  constructor(message, status = 0, code = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code; // e.g. "email_not_verified"
  }
}

// A 401 from these means "wrong credentials", not "session expired".
const NO_REDIRECT_ON_401 = ["/api/auth/login"];

async function request(method, path, body) {
  const token = getToken();
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new ApiError(
      err?.name === "AbortError"
        ? "The server took too long to respond. Please try again."
        : "Can't reach the server. Check your connection and try again."
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (res.status === 401 && !NO_REDIRECT_ON_401.includes(path)) {
    const page = loginPageFor();
    clearSession();
    location.href = page;
    throw new ApiError(data?.error || "Your session has ended. Please log in again.", 401);
  }

  if (!res.ok) {
    const message =
      data?.error ||
      (res.status === 403
        ? "You don't have permission to do that."
        : res.status >= 500
          ? "Something went wrong on our side. Please try again."
          : `Request failed (${res.status}).`);
    throw new ApiError(message, res.status, data?.code || null);
  }
  return data;
}

export const get = (path) => request("GET", path);
export const post = (path, body = {}) => request("POST", path, body);
export const put = (path, body = {}) => request("PUT", path, body);
export const patch = (path, body) => request("PATCH", path, body);

/** Fire-and-forget ping so a sleeping Render instance starts waking up. */
export function wakeApi() {
  fetch(`${API_BASE}/api/health`, { cache: "no-store" }).catch(() => {});
}

// Email OTP endpoints (all public).
export const auth = {
  verifyEmail: (email, otp) => post("/api/auth/verify-email", { email, otp }),
  resendOtp: (email) => post("/api/auth/resend-otp", { email }),
  forgot: (email) => post("/api/auth/forgot-password", { email }),
  reset: (email, otp, new_password) => post("/api/auth/reset-password", { email, otp, new_password }),
};
