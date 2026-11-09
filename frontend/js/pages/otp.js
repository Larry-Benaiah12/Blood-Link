// Shared bits for the verify / forgot / reset screens.

import { getRole, homeFor, saveSession } from "../auth.js";
import { h, field } from "../ui.js";

export const RESEND_SECONDS = 60;
export const normEmail = (v) => String(v).trim().toLowerCase();
export const digitsOnly = (v) => String(v).replace(/\D/g, "").slice(0, 6);

/** Public auth screens bounce signed-in users home. */
export function redirectIfSignedIn() {
  if (getRole()) location.replace(homeFor());
}

/** 6-digit code field. */
export function otpField(name = "otp", label = "6-digit code") {
  const f = field({
    label, name, type: "text", inputmode: "numeric", autocomplete: "one-time-code",
    maxlength: 6, pattern: "[0-9]*", placeholder: "••••••", style: "letter-spacing:.5em;font-size:1.4rem;text-align:center",
  });
  f.querySelector("input").addEventListener("input", (e) => {
    e.target.value = digitsOnly(e.target.value);
  });
  return f;
}

/**
 * A "Resend code" button with a visible cooldown. `send` performs the request.
 * Starts counting immediately (a code was just sent) unless startReady.
 */
export function resendButton(send, { startReady = false } = {}) {
  const btn = h("button", { type: "button", class: "btn btn-secondary btn-block" });
  let left = startReady ? 0 : RESEND_SECONDS;
  let timer = null;
  const paint = () => {
    btn.disabled = left > 0;
    btn.textContent = left > 0 ? `Resend code in ${left}s` : "Resend code";
  };
  const start = () => {
    left = RESEND_SECONDS;
    paint();
    clearInterval(timer);
    timer = setInterval(() => {
      left -= 1;
      paint();
      if (left <= 0) clearInterval(timer);
    }, 1000);
  };
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await send();
    } finally {
      start();
    }
  });
  paint();
  if (!startReady) start();
  return { el: btn, restart: start };
}

/** Store the session from a verify-email response and go to the role's home. */
export function finishSignIn({ access_token, user, role }) {
  saveSession(access_token, user);
  location.href = homeFor(role || user.role);
}
