// Small DOM helpers. All API data goes in via textContent (see h()).

import { URGENCY, STATUS } from "./constants.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build an element safely: h("td", { class: "num" }, "12 km").
 * String/number children become text nodes, never HTML.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2), value);
    } else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Show a message in an .alert element. type: "error" | "success" | "info". */
export function showAlert(el, message, type = "error") {
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = message;
  el.hidden = false;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  if (type === "error") el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

export function clearAlert(el) {
  if (!el) return;
  el.textContent = "";
  el.hidden = true;
}

/** Disable a button and swap its text while work is in progress. */
export function setLoading(btn, loading, loadingText = "Loading…") {
  if (!btn) return;
  if (loading) {
    btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), loadingText);
  } else {
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
  }
}

/** Badge element for urgency or status values. */
export function badge(value) {
  const key = String(value ?? "").toLowerCase();
  const info = URGENCY[key] || STATUS[key];
  return h("span", { class: `badge badge-${info ? key : "normal"}` }, info ? info.label : key || "—");
}

export function yesNoBadge(flag, yes = "Yes", no = "No") {
  return h("span", { class: `badge ${flag ? "badge-yes" : "badge-no"}` }, flag ? yes : no);
}

/** Backend timestamps are UTC but carry no timezone suffix: parse as UTC. */
export function parseUtc(value) {
  if (!value) return null;
  const str = String(value);
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(str) ? str : `${str}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value) {
  const d = parseUtc(value);
  if (!d) return value ? String(value) : "—";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Plain YYYY-MM-DD dates (no time, no timezone shift). */
export function formatDay(value) {
  if (!value) return "—";
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function loadingRow(text = "Loading…") {
  return h("div", { class: "loading", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), text);
}

export function emptyState(text) {
  return h("div", { class: "empty-state" }, h("p", {}, text));
}

/** Clear all .field-error messages in a form. */
export function clearFieldErrors(form) {
  form.querySelectorAll(".form-field").forEach((f) => f.classList.remove("has-error"));
  form.querySelectorAll(".field-error").forEach((e) => (e.textContent = ""));
  form.querySelectorAll("[aria-invalid]").forEach((i) => i.removeAttribute("aria-invalid"));
}

/**
 * Show field errors returned by the API: { phone: "Enter a valid number" }.
 * Each field needs <span class="field-error" data-error-for="phone">.
 * Returns true if at least one error matched a field on the form.
 */
export function showFieldErrors(form, errors) {
  if (!errors || typeof errors !== "object") return false;
  let matched = false;
  let first = null;
  for (const [name, message] of Object.entries(errors)) {
    const slot = form.querySelector(`[data-error-for="${CSS.escape(name)}"]`);
    if (!slot) continue;
    matched = true;
    slot.textContent = Array.isArray(message) ? message.join(" ") : String(message);
    slot.closest(".form-field")?.classList.add("has-error");
    const input = form.elements[name];
    if (input && input.setAttribute) {
      input.setAttribute("aria-invalid", "true");
      first = first || input;
    }
  }
  first?.focus?.();
  return matched;
}

/**
 * Build a .form-field. `options` (array of strings or [value, label]) makes a <select>.
 */
export function field({ label, name, type = "text", options, required = true, hint, optional, value, wrapClass = "", ...attrs }) {
  const id = `f-${name}`;
  let input;
  if (options) {
    input = h(
      "select",
      { id, name, required: required || null, ...attrs },
      h("option", { value: "" }, "Choose…"),
      options.map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return h("option", { value: v }, l);
      })
    );
  } else if (type === "textarea") {
    input = h("textarea", { id, name, ...attrs });
  } else {
    input = h("input", { id, name, type, required: required || null, ...attrs });
  }
  if (value != null) input.value = value;
  return h(
    "div",
    { class: `form-field ${wrapClass}`.trim() },
    h("label", { for: id }, label, optional ? h("span", { class: "optional" }, " (optional)") : null),
    input,
    hint ? h("span", { class: "hint" }, hint) : null,
    h("span", { class: "field-error", "data-error-for": name })
  );
}

/** Run per-field checks (value => message | ""). Returns true if all pass. */
export function validate(form, rules) {
  clearFieldErrors(form);
  const errors = {};
  for (const [name, check] of Object.entries(rules)) {
    const msg = check(form.elements[name].value.trim());
    if (msg) errors[name] = msg;
  }
  if (Object.keys(errors).length) {
    showFieldErrors(form, errors);
    return false;
  }
  return true;
}

/** Short-lived toast message. */
export function toast(message, type = "success") {
  let box = document.getElementById("toasts");
  if (!box) {
    box = h("div", { id: "toasts", style: "position:fixed;right:16px;bottom:16px;z-index:50;display:grid;gap:8px;max-width:min(360px,calc(100vw - 32px))" });
    document.body.append(box);
  }
  const el = h("div", { class: `alert alert-${type}`, role: "status", style: "margin:0" }, message);
  box.append(el);
  setTimeout(() => el.remove(), 4500);
}
