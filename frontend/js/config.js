// App settings.
// The API runs on Render's free tier: after ~15 min idle the first request can
// take 30–60 s (cold start), so the client uses a long timeout and pings
// /api/health on load to wake it.
export const API_BASE = window.BLOODLINK_API_URL || "https://bloodlink-api-bli0.onrender.com";
export const REQUEST_TIMEOUT_MS = 60000;
export const NOTIFICATION_POLL_MS = 45000;
