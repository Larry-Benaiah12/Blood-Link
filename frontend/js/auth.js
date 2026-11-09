// Token storage + login guard. The session lives in sessionStorage, so it
// ends when the browser tab / installed app is closed and the user has to
// sign in again. Storage can throw (private mode, blocked storage), so every
// access is wrapped and falls back to memory.

const TOKEN_KEY = "bloodlink_token";
const HOSPITAL_KEY = "bloodlink_hospital";
const ROLE_KEY = "bloodlink_role";
const memory = {};

// Remove sessions saved by older versions, which never expired.
try {
  [TOKEN_KEY, HOSPITAL_KEY, ROLE_KEY].forEach((k) => localStorage.removeItem(k));
} catch { /* ignore */ }

function read(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return memory[key] ?? null;
  }
}

function write(key, value) {
  try {
    if (value == null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    if (value == null) delete memory[key];
    else memory[key] = value;
  }
}

export function getToken() {
  return read(TOKEN_KEY);
}

/** role: "hospital" (default), "admin" or "donor". `hospital` holds the profile (hospital or donor account). */
export function saveSession(token, hospital, role = "hospital") {
  write(TOKEN_KEY, token);
  write(HOSPITAL_KEY, hospital ? JSON.stringify(hospital) : null);
  write(ROLE_KEY, token ? role : null);
}

export function getRole() {
  return read(ROLE_KEY) || "hospital";
}

/** Where each role lands after logging in. */
export function homeFor(role = getRole()) {
  if (role === "admin") return "admin.html";
  if (role === "donor") return "donate.html";
  return "dashboard.html";
}

/** Sign-in page for each role: donors have their own. */
export function loginPageFor(role = getRole()) {
  return role === "donor" ? "donor-login.html" : "login.html";
}

export function getHospital() {
  try {
    return JSON.parse(read(HOSPITAL_KEY) || "null");
  } catch {
    return null;
  }
}

/** The signed-in donor account (or hospital) saved with the session. */
export const getProfile = getHospital;

export function clearSession() {
  write(TOKEN_KEY, null);
  write(HOSPITAL_KEY, null);
  write(ROLE_KEY, null);
}

/**
 * Redirect to the login page if there is no token, or to the right home page
 * if the signed-in role doesn't match. Returns true if the page may load.
 */
export function requireLogin(role = "hospital") {
  const current = getToken() ? getRole() : null;
  if (current === role) return true;
  // Not signed in, or a donor/staff mix-up: go to the right sign-in page.
  if (!current || role === "donor" || current === "donor") {
    location.replace(loginPageFor(role));
    return false;
  }
  location.replace(homeFor(current)); // hospital ↔ admin
  return false;
}

/** Wire up any [data-logout] buttons on the page. */
export function bindLogout() {
  document.querySelectorAll("[data-logout]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = loginPageFor();
      clearSession();
      location.href = page;
    });
  });
}
