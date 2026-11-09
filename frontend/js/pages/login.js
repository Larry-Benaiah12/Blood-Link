import { post } from "../api.js";
import { saveSession, clearSession, homeFor } from "../auth.js";
import { showAlert, clearAlert, setLoading, clearFieldErrors, showFieldErrors } from "../ui.js";

// Opening the login page always asks for credentials: any previous
// session is ended so nobody can walk past the sign-in form.
clearSession();

const form = document.getElementById("login-form");
const alertEl = document.getElementById("alert");

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
    const { token, hospital, role } = await post("/auth/login", { email, password });
    if (!token) throw new Error("Login worked but no token came back. Please try again.");
    saveSession(token, hospital, role || "hospital");
    location.href = homeFor(role || "hospital");
  } catch (err) {
    setLoading(submit, false);
    showFieldErrors(form, err.fields);
    showAlert(alertEl, err.message);
    form.elements.password.select();
  }
});
