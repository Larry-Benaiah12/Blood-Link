import { get, patch } from "../api.js";
import { requireRole } from "../auth.js";
import { mountShell, setUnreadCount } from "../shell.js";
import { icon } from "../icons.js";
import { h, showAlert, loadingRow, formatDate } from "../ui.js";
import { emptyBlock, kpi } from "./parts.js";

mountShell();

const app = document.getElementById("app");
const alertEl = document.getElementById("alert");
let items = [];

async function init() {
  app.replaceChildren(loadingRow("Loading notifications…"));
  try {
    items = await get("/api/notifications");
    render();
  } catch (err) {
    app.replaceChildren();
    showAlert(alertEl, err.message);
  }
  // The shell polls too; keep this page in sync, preserving local reads.
  document.addEventListener("notifications", (e) => {
    const read = new Set(items.filter((n) => n.is_read).map((n) => n.id));
    items = e.detail.map((n) => ({ ...n, is_read: n.is_read || read.has(n.id) }));
    render();
  });
}

const unreadCount = () => items.filter((n) => !n.is_read).length;

async function markRead(n) {
  if (n.is_read) return;
  n.is_read = true;
  setUnreadCount(unreadCount());
  render();
  try {
    await patch(`/api/notifications/${n.id}/read`);
  } catch (err) {
    n.is_read = false;
    setUnreadCount(unreadCount());
    render();
    showAlert(alertEl, err.message);
  }
}

// No bulk endpoint exists, so mark each unread one in turn.
async function markAll() {
  for (const n of items.filter((x) => !x.is_read)) await markRead(n);
}

function render() {
  if (!items.length) {
    app.replaceChildren(emptyBlock("bell", "You're all caught up", "New blood requests that match you will appear here."));
    return;
  }
  const unread = unreadCount();
  app.replaceChildren(
    h("div", { class: "kpis" }, kpi("bell", unread, "Unread", unread ? "red" : "grey"), kpi("inbox", items.length, "Total", "blue")),
    unread ? h("div", { style: "margin-bottom:12px" }, h("button", { type: "button", class: "btn btn-secondary", onclick: markAll }, icon("checkCircle"), "Mark all as read")) : null,
    h("div", { class: "req-list" },
      items.map((n) =>
        h("article", { class: `notice${n.is_read ? "" : " is-unread"}` },
          h("span", { class: "mark", "aria-hidden": "true" }),
          h("div", {}, h("p", {}, n.message), h("small", {}, formatDate(n.created_at))),
          n.is_read ? null : h("button", { type: "button", class: "btn btn-secondary", onclick: () => markRead(n) }, "Mark read"))))
  );
}

if (requireRole("donor", "hospital")) init();
