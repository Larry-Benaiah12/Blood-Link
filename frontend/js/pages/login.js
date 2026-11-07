import { post, USE_MOCKS } from "../api.js";
import { getToken, saveSession } from "../auth.js";
import { showAlert, clearAlert, setLoading, clearFieldErrors, showFieldErrors } from "../ui.js";

// Already logged in? Go straight to the dashboard.
if (getToken()) location.replace("dashboard.html");

const form = document.getElementById("login-form");
const alertEl = document.getElementById("alert");

if (USE_MOCKS) {
  const hint = document.getElementById("demo-hint");
  hint.textContent = "Demo mode: log in with demo@hospital.test and the password \"password\".";
  hint.hidden = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAlert(alertEl);
  clearFieldErrors(form);

  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;

  const errors = {};
  if (!email) errors.email = "Please enter your email.";
  else if (!form.elements.email.checkValidity()) errors.email = "That doesn't look like an email address.";
  if (!password) errors.password = "Please enter your password.";
  if (Object.keys(errors).length) {
    showFieldErrors(form, errors);
    return;
  }

  const submit = form.querySelector('[type="submit"]');
  setLoading(submit, true, "Logging in…");
  try {
    const { token, hospital } = await post("/auth/login", { email, password });
    if (!token) throw new Error("Login worked but no token came back. Please try again.");
    saveSession(token, hospital);
    location.href = "dashboard.html";
  } catch (err) {
    setLoading(submit, false);
    showFieldErrors(form, err.fields);
    showAlert(alertEl, err.message);
    form.elements.password.select();
  }
});
