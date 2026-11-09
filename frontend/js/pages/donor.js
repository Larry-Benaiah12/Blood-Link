import { get, post, put } from "../api.js";
import { requireRole, getProfile, getUser, saveUser } from "../auth.js";
import { mountShell } from "../shell.js";
import { icon } from "../icons.js";
import { h, showAlert, clearAlert, loadingRow, toast, formatDay } from "../ui.js";
import { groupLabel } from "../constants.js";
import { requestCard, setHeading, kpi, emptyBlock } from "./parts.js";

mountShell();

const alertEl = document.getElementById("alert");
const app = document.getElementById("app");
const GAP_DAYS = 90; // advisory only: the backend doesn't enforce a donation gap
let profile = getProfile();
let requests = [];
let history = [];

function headingFor(p) {
  setHeading("Overview", p ? `${p.full_name} · ${groupLabel(p.blood_type)} · ${p.city}, ${p.region}` : "");
}

async function init() {
  headingFor(profile);
  app.replaceChildren(loadingRow("Loading your dashboard…"));
  const [me, reqs, hist] = await Promise.allSettled([get("/api/donors/me"), get("/api/donors/requests"), get("/api/donors/history")]);
  if (me.status === "fulfilled") {
    profile = me.value;
    const user = getUser();
    if (user) saveUser({ ...user, profile });
    headingFor(profile);
  }
  requests = reqs.status === "fulfilled" ? reqs.value : [];
  history = hist.status === "fulfilled" ? hist.value : [];
  const failed = [me, reqs, hist].find((r) => r.status === "rejected");
  if (failed) showAlert(alertEl, failed.reason.message);
  render();
}

async function reloadRequests() {
  try {
    [requests, history] = await Promise.all([get("/api/donors/requests"), get("/api/donors/history")]);
  } catch (err) {
    showAlert(alertEl, err.message);
  }
  render();
}

// ---------- Eligibility (advisory) ----------

function eligibility() {
  const last = profile?.last_donation_date;
  if (!last) return { value: "Ready", sub: "No donation on record", tone: "green" };
  const next = new Date(`${last}T00:00:00`);
  next.setDate(next.getDate() + GAP_DAYS);
  const days = Math.ceil((next - Date.now()) / 86400000);
  return days <= 0
    ? { value: "Ready", sub: `Last gave ${formatDay(last)}`, tone: "green" }
    : { value: `${days} day${days === 1 ? "" : "s"}`, sub: `Eligible again ${formatDay(next.toISOString().slice(0, 10))}`, tone: "amber" };
}

// ---------- Availability ----------

function availability() {
  const on = profile?.is_available !== false;
  const sw = h("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(on), "aria-label": "Available to donate" });
  sw.addEventListener("click", async () => {
    clearAlert(alertEl);
    sw.disabled = true;
    try {
      profile = await put("/api/donors/me", { is_available: !on });
      const user = getUser();
      if (user) saveUser({ ...user, profile });
      toast(profile.is_available ? "You're available. Matching requests will show up." : "You're paused. No requests or notifications until you're back.", "info");
      await reloadRequests();
    } catch (err) {
      sw.disabled = false;
      showAlert(alertEl, err.message);
    }
  });
  return h("section", { class: `avail${on ? " on" : ""}` },
    h("div", { class: "avail-text" },
      h("strong", {}, h("span", { class: "pulse" }), on ? "You're available to donate" : "You're not available"),
      h("p", {}, on
        ? "You'll be notified when a hospital in your region needs your blood type."
        : "While paused you won't see requests or get notifications.")),
    sw);
}

// ---------- Render ----------

function render() {
  const available = profile?.is_available !== false;
  const accepted = history.filter((x) => x.my_response === "accepted").length;
  const open = requests.length;
  const elig = eligibility();

  const children = [
    h("div", { class: "kpis" },
      kpi("droplet", groupLabel(profile?.blood_type || "—"), "Blood type", "red", profile ? profile.region : ""),
      kpi("list", available ? open : "—", "Matching requests", "blue", available ? "Open in your region" : "Paused"),
      kpi("heart", accepted, "Requests accepted", "green", `${history.length} response${history.length === 1 ? "" : "s"} in total`),
      kpi("calendar", elig.value, "Next donation", elig.tone, elig.sub)),
    availability(),
    h("h2", { class: "section-title" }, icon("activity"), "Open requests for you"),
  ];

  if (!available) {
    children.push(emptyBlock("ban", "You're paused", "Turn availability back on to see requests that match you."));
  } else if (!requests.length) {
    children.push(emptyBlock("inbox", "No open requests right now",
      `Nothing matches ${profile?.blood_type ? groupLabel(profile.blood_type) : "your blood type"} in ${profile?.region || "your region"} at the moment. We'll notify you when one appears.`));
  } else {
    children.push(h("div", { class: "req-list" }, requests.map(card)));
  }
  app.replaceChildren(...children);
}

function card(r) {
  const reply = h("p", { class: "reply", role: "status", hidden: true });
  const accept = h("button", { type: "button", class: "btn btn-primary" }, icon("check"), "Accept");
  const decline = h("button", { type: "button", class: "btn btn-secondary" }, icon("x"), "Decline");

  const sync = (resp) => {
    accept.replaceChildren(icon("check"), resp === "accepted" ? "Accepted" : "Accept");
    decline.replaceChildren(icon("x"), resp === "declined" ? "Declined" : "Decline");
    accept.classList.toggle("is-picked", resp === "accepted");
    accept.disabled = resp === "accepted";
    decline.disabled = resp === "declined";
  };
  const say = (resp) => {
    reply.hidden = !resp;
    reply.className = `reply${resp === "declined" ? " muted" : ""}`;
    reply.replaceChildren(icon(resp === "accepted" ? "phone" : "clock"),
      resp === "accepted"
        ? `Thank you! ${r.hospital_name} now has your name and phone number and may call you.`
        : "You declined. You can change your mind while the request is open.");
  };
  sync(r.my_response);
  if (r.my_response) say(r.my_response);

  const respond = (choice, btn) => async () => {
    clearAlert(alertEl);
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const res = await post(`/api/donors/requests/${r.id}/respond`, { status: choice });
      r.my_response = res.status;
      sync(res.status);
      say(res.status);
    } catch (err) {
      btn.textContent = label;
      sync(r.my_response);
      showAlert(alertEl, err.status === 409 ? "This request is no longer open." : err.message);
      if (err.status === 409 || err.status === 404) reloadRequests();
    }
  };
  accept.addEventListener("click", respond("accepted", accept));
  decline.addEventListener("click", respond("declined", decline));
  return requestCard(r, accept, decline, reply);
}

if (requireRole("donor")) init();
