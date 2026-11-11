// File downloads (donor form, admin reports) and admin delete helpers.
// These endpoints need the bearer token, so plain <a href> won't work:
// fetch a Blob, then open or save it.

import { getBlob, del } from "./api.js";
import { h, setLoading, showAlert, toast } from "./ui.js";
import { icon } from "./icons.js";

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const asPdf = (blob) => new Blob([blob], { type: "application/pdf" });

/** Open the donor's form in a new tab (PDF viewer has Print); falls back to a download if popups are blocked. */
export async function printDonorForm() {
  // Open synchronously so the popup blocker treats it as a user gesture, then point it at the PDF.
  const win = window.open("", "_blank");
  try {
    const blob = asPdf(await getBlob("/api/donors/me/form"));
    if (!win) return saveBlob(blob, "bloodlink-donor-form.pdf");
    win.location.href = URL.createObjectURL(blob);
  } catch (err) {
    win?.close();
    throw err;
  }
}

export async function downloadDonorForm() {
  saveBlob(asPdf(await getBlob("/api/donors/me/form?download=1")), "bloodlink-donor-form.pdf");
}

const EXT = { pdf: "pdf", docx: "docx", xlsx: "xlsx" };

export async function downloadReport(kind, fmt, filters = {}) {
  const qs = new URLSearchParams({ format: fmt });
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v); // URLSearchParams encodes "+" as %2B
  saveBlob(await getBlob(`/api/admin/reports/${kind}?${qs}`), `bloodlink-${kind}-report.${EXT[fmt]}`);
}

export const deleteUser = (userId) => del(`/api/admin/users/${userId}`);

/** Button that runs `action` with a loading state and reports errors in alertEl. */
function actionButton(label, iconName, action, alertEl, cls = "btn btn-secondary") {
  const btn = h("button", { type: "button", class: cls }, icon(iconName), label);
  btn.addEventListener("click", async () => {
    setLoading(btn, true, "Preparing…");
    try {
      await action();
    } catch (err) {
      showAlert(alertEl, err.message);
    } finally {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      btn.replaceChildren(icon(iconName), label);
    }
  });
  return btn;
}

/** "Print my form" + "Download PDF" buttons for donor pages. */
export function donorFormActions(alertEl) {
  return h("div", { class: "form-actions-row" },
    actionButton("Print my form", "printer", printDonorForm, alertEl, "btn btn-primary"),
    actionButton("Download PDF", "download", downloadDonorForm, alertEl));
}

/** Download menu (PDF / Word / Excel). `getFilters` is read at click time so it matches the current view. */
export function reportMenu(kind, getFilters, alertEl) {
  const busy = h("span", { class: "visually-hidden", role: "status" });
  const trigger = h("button", { type: "button", class: "btn btn-secondary", "aria-haspopup": "menu", "aria-expanded": "false" }, icon("download"), "Download");
  const items = [["pdf", "PDF (.pdf)"], ["docx", "Word (.docx)"], ["xlsx", "Excel (.xlsx)"]].map(([fmt, label]) => {
    const item = h("button", { type: "button", role: "menuitem", class: "menu-item" }, label);
    item.addEventListener("click", async () => {
      close();
      setLoading(trigger, true, "Preparing report…");
      try {
        await downloadReport(kind, fmt, getFilters());
        toast("Report downloaded.");
      } catch (err) {
        showAlert(alertEl, err.message);
      } finally {
        trigger.disabled = false;
        trigger.removeAttribute("aria-busy");
        trigger.replaceChildren(icon("download"), "Download");
      }
    });
    return item;
  });
  const menu = h("div", { class: "menu-list", role: "menu", hidden: true }, items);
  const root = h("div", { class: "menu" }, trigger, menu, busy);
  function close() {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  }
  trigger.addEventListener("click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) items[0].focus();
  });
  document.addEventListener("click", (e) => { if (!root.contains(e.target)) close(); });
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") { close(); trigger.focus(); } });
  return root;
}
