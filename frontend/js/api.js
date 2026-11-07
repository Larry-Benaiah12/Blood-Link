// fetch wrapper for the Flask API.
//
// USE_MOCKS = true  → requests are answered by js/mock.js (stored in this
//                     browser), so the UI works before the backend exists.
// USE_MOCKS = false → real requests to Flask.

import { getToken, clearSession } from "./auth.js";

export const USE_MOCKS = true;

// "" when Flask serves the frontend (same origin).
// "http://localhost:5000" when the frontend runs on its own server.
export const API_BASE = "";

export class ApiError extends Error {
  constructor(message, status = 0, fields = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields; // { fieldName: "message" } for validation errors
  }
}

// Paths where a 401 means "wrong credentials", not "session expired".
const NO_REDIRECT_ON_401 = ["/auth/login"];

async function request(method, path, body) {
  const token = getToken();

  let status;
  let data;

  if (USE_MOCKS) {
    const { mockRequest } = await import("./mock.js");
    ({ status, data } = await mockRequest(method, path, body, token));
  } else {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(API_BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError("Can't reach the server. Check your connection and try again.");
    }
    status = res.status;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text ? { message: text } : null;
    }
  }

  if (status === 401 && !NO_REDIRECT_ON_401.includes(path)) {
    clearSession();
    location.href = "login.html";
    throw new ApiError("Your session has ended. Please log in again.", 401);
  }

  if (status < 200 || status >= 300) {
    const message =
      (data && (data.message || data.error)) ||
      (status >= 500 ? "Something went wrong on our side. Please try again." : `Request failed (${status}).`);
    const fields = data && (data.fields || data.errors);
    throw new ApiError(message, status, fields && typeof fields === "object" ? fields : null);
  }

  return data;
}

export const get = (path) => request("GET", path);
export const post = (path, body = {}) => request("POST", path, body);
export const patch = (path, body = {}) => request("PATCH", path, body);
