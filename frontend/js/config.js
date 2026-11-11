// App settings.
// The API runs on Render's free tier: after ~15 min idle the first request can
// take 30–60 s (cold start), so the client uses a long timeout and pings
// /api/health on load to wake it.
export const API_BASE = window.BLOODLINK_API_URL || "https://bloodlink-api-bli0.onrender.com";
// Public Google OAuth client ID (Web application). Safe to ship; never add a secret.
// Authorized JavaScript origins in Google Cloud Console must include every origin
// that serves this site (e.g. http://localhost:5500 and the deployed URL).
export const GOOGLE_CLIENT_ID = window.BLOODLINK_GOOGLE_CLIENT_ID || "391369153857-ct65sdhbq4fk4neeaiaqp4mggej3b373.apps.googleusercontent.com";
export const REQUEST_TIMEOUT_MS = 60000;
export const NOTIFICATION_POLL_MS = 45000;
