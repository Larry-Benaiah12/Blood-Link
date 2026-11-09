// Layout for signed-in pages: sidebar + topbar, plus notification polling.
// Public pages (login/register) only get the simple header + footer.

import { get, wakeApi } from "./api.js";
import { getRole, getUser, logout, homeFor } from "./auth.js";
import { NOTIFICATION_POLL_MS } from "./config.js";
import { h } from "./ui.js";
import { icon } from "./icons.js";

const NAV = {
  donor: [
    ["donor.html", "Overview", "dashboard"],
    ["donor-history.html", "My responses", "history"],
    ["notifications.html", "Notifications", "bell", true],
    ["donor-profile.html", "My profile", "user"],
  ],
  hospital: [
    ["dashboard.html", "Dashboard", "dashboard"],
    ["new-request.html", "New request", "plus"],
    ["notifications.html", "Notifications", "bell", true],
    ["hospital-profile.html", "Hospital profile", "hospital"],
  ],
  admin: [
    ["admin.html#stats", "Overview", "activity"],
    ["admin.html#donors", "Donors", "users"],
    ["admin.html#hospitals", "Hospitals", "hospital"],
    ["admin.html#requests", "Requests", "list"],
  ],
};

const ROLE_LABEL = { donor: "Donor", hospital: "Hospital", admin: "Administrator" };
const page = () => location.pathname.split("/").pop() || "index.html";

function isActive(href) {
  const [file, hash] = href.split("#");
  if (file !== page()) return false;
  if (!hash) return true;
  const cur = location.hash.slice(1) || "stats";
  return cur === hash;
}

const displayName = (user) => user?.profile?.full_name || user?.profile?.name || user?.email || "Account";
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";

const brand = (role) =>
  h("a", { class: "brand", href: role ? homeFor(role) : "index.html" }, h("span", { class: "brand-mark" }, icon("droplet")), "BloodLink");

export function mountShell() {
  wakeApi();
  const role = getRole();
  if (document.getElementById("sidebar")) mountApp(role);
  else mountPublic(role);
  if (role === "donor" || role === "hospital") startNotificationPolling();
}

// ---------- Signed-in layout ----------

function mountApp(role) {
  const user = getUser();
  const name = displayName(user);
  const sidebar = document.getElementById("sidebar");
  const topbar = document.getElementById("topbar");
  const overlay = document.getElementById("overlay");

  const setOpen = (open) => {
    document.body.classList.toggle("nav-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };

  const links = (NAV[role] || []).map(([href, label, ico, isBell]) =>
    h("a", { class: "nav-link", href, ...(isActive(href) ? { "aria-current": "page" } : {}), onclick: () => setOpen(false) },
      icon(ico), h("span", {}, label),
      isBell ? h("span", { class: "notif-count", hidden: true }) : null)
  );
  if (role === "admin") {
    addEventListener("hashchange", () => links.forEach((a, i) => {
      if (isActive(NAV.admin[i][0])) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }));
  }

  sidebar.append(
    brand(role),
    h("p", { class: "nav-label" }, ROLE_LABEL[role] || ""),
    h("nav", { class: "nav", "aria-label": "Main" }, links),
    h("div", { class: "side-foot" },
      h("div", { class: "who" },
        h("span", { class: "avatar" }, initials(name)),
        h("div", {}, h("strong", {}, name), h("small", {}, user?.email || ""))),
      h("button", { type: "button", class: "nav-link logout", onclick: logout }, icon("logout"), h("span", {}, "Log out")))
  );

  const toggle = h("button", { type: "button", class: "icon-btn menu-btn", "aria-label": "Open menu", "aria-controls": "sidebar", "aria-expanded": "false", onclick: () => setOpen(!document.body.classList.contains("nav-open")) }, icon("menu"));
  overlay?.addEventListener("click", () => setOpen(false));
  addEventListener("keydown", (e) => e.key === "Escape" && setOpen(false));

  topbar.append(
    toggle,
    h("span", { class: "crumb" }, `${ROLE_LABEL[role] || ""} / `, h("b", {}, (NAV[role] || []).find(([href]) => isActive(href))?.[1] || "")),
    h("a", { class: "brand brand-sm", href: homeFor(role) }, h("span", { class: "brand-mark" }, icon("droplet")), "BloodLink"),
    h("div", { class: "top-right" },
      role !== "admin"
        ? h("a", { class: "icon-btn", href: "notifications.html", "aria-label": "Notifications" }, icon("bell"), h("span", { class: "notif-count dot", hidden: true }))
        : null,
      h("span", { class: "avatar", title: name }, initials(name)))
  );
}

// ---------- Public pages ----------

function mountPublic(role) {
  const header = document.getElementById("site-header");
  if (header) {
    header.className = "lp-header";
    const nav = h("nav", { class: "lp-nav", "aria-label": "Main" },
      h("a", { class: "lp-link", href: "login.html", ...(page() === "login.html" ? { "aria-current": "page" } : {}) }, "Log in"),
      h("a", { class: "lp-link lp-desktop", href: "register-hospital.html" }, "Register hospital"),
      h("a", { class: "lp-btn lp-btn-red", href: "register-donor.html" }, "Become a donor"));
    header.append(h("a", { class: "lp-brand", href: role ? homeFor(role) : "index.html" }, icon("droplet"), "BloodLink"), nav);
  }
  const footer = document.getElementById("site-footer");
  if (footer) {
    footer.className = "site-footer";
    footer.append(h("div", { class: "site-footer-inner" },
      h("a", { class: "lp-brand", href: "index.html" }, icon("droplet"), "BloodLink"),
      h("p", {}, "BloodLink is a prototype. Any real donation still goes through a hospital or blood bank's normal screening.")));
  }
}

// ---------- Notifications ----------

export function setUnreadCount(n) {
  document.querySelectorAll(".notif-count").forEach((el) => {
    el.textContent = el.classList.contains("dot") ? "" : n > 99 ? "99+" : String(n);
    el.hidden = n === 0;
  });
}

async function refresh() {
  try {
    const list = await get("/api/notifications");
    setUnreadCount(list.filter((n) => !n.is_read).length);
    document.dispatchEvent(new CustomEvent("notifications", { detail: list }));
  } catch { /* the badge is best-effort */ }
}

function startNotificationPolling() {
  refresh();
  setInterval(() => !document.hidden && refresh(), NOTIFICATION_POLL_MS);
  document.addEventListener("visibilitychange", () => !document.hidden && refresh());
}
