// Token storage + login guard. localStorage can throw (private mode,
// blocked storage), so every access is wrapped and falls back to memory.

const TOKEN_KEY = "bloodlink_token";
const HOSPITAL_KEY = "bloodlink_hospital";
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

export function getToken() {
  return read(TOKEN_KEY);
}

export function saveSession(token, hospital) {
  write(TOKEN_KEY, token);
  write(HOSPITAL_KEY, hospital ? JSON.stringify(hospital) : null);
}

export function getHospital() {
  try {
    return JSON.parse(read(HOSPITAL_KEY) || "null");
  } catch {
    return null;
  }
}

export function clearSession() {
  write(TOKEN_KEY, null);
  write(HOSPITAL_KEY, null);
}

/** Redirect to the login page if there is no token. Returns true if logged in. */
export function requireLogin() {
  if (getToken()) return true;
  location.replace("login.html");
  return false;
}

/** Wire up any [data-logout] buttons on the page. */
export function bindLogout() {
  document.querySelectorAll("[data-logout]").forEach((btn) => {
    btn.addEventListener("click", () => {
      clearSession();
      location.href = "login.html";
    });
  });
}
