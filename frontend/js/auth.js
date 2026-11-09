// Token + user storage and route guards. The JWT lasts 24 h and there is no
// refresh endpoint. Storage can throw (private mode), so every access is
// wrapped and falls back to memory.

const TOKEN_KEY = "bloodlink_token";
const USER_KEY = "bloodlink_user";
const memory = {};

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory[key] ?? null;
  }
}
function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    if (value == null) delete memory[key];
    else memory[key] = value;
  }
}

export const getToken = () => read(TOKEN_KEY);

export function saveSession(token, user) {
  write(TOKEN_KEY, token);
  write(USER_KEY, user ? JSON.stringify(user) : null);
}

export function getUser() {
  try {
    return JSON.parse(read(USER_KEY) || "null");
  } catch {
    return null;
  }
}

/** Update the cached user (e.g. after a profile edit). */
export function saveUser(user) {
  write(USER_KEY, user ? JSON.stringify(user) : null);
}

export const getRole = () => (getToken() ? getUser()?.role || null : null);
export const getProfile = () => getUser()?.profile || null;

export function clearSession() {
  write(TOKEN_KEY, null);
  write(USER_KEY, null);
}

export function homeFor(role = getRole()) {
  if (role === "admin") return "admin.html";
  if (role === "donor") return "donor.html";
  if (role === "hospital") return "dashboard.html";
  return "login.html";
}

export const loginPageFor = () => "login.html";

/**
 * Redirect to login if signed out, or to the user's own home if their role
 * isn't allowed here. Returns true if the page may load.
 */
export function requireRole(...roles) {
  const role = getRole();
  if (!role) {
    location.replace(loginPageFor());
    return false;
  }
  if (roles.length && !roles.includes(role)) {
    location.replace(homeFor(role));
    return false;
  }
  return true;
}

export function logout() {
  clearSession();
  location.href = loginPageFor();
}

// Email carried between the register / verify / reset screens. Kept in
// sessionStorage (not the URL) so it isn't leaked in links or history.
const PENDING_KEY = "bloodlink_pending_email";
export function setPendingEmail(email) {
  try { sessionStorage.setItem(PENDING_KEY, email); } catch { memory[PENDING_KEY] = email; }
}
export function getPendingEmail() {
  try { return sessionStorage.getItem(PENDING_KEY) || ""; } catch { return memory[PENDING_KEY] || ""; }
}

// One-time notice shown on the next page (e.g. "Password updated").
const FLASH_KEY = "bloodlink_flash";
export function setFlash(msg) {
  try { sessionStorage.setItem(FLASH_KEY, msg); } catch { memory[FLASH_KEY] = msg; }
}
export function takeFlash() {
  let v = "";
  try { v = sessionStorage.getItem(FLASH_KEY) || ""; sessionStorage.removeItem(FLASH_KEY); } catch { v = memory[FLASH_KEY] || ""; delete memory[FLASH_KEY]; }
  return v;
}
