// Donor's page after registering: their Donor ID and registration slip,
// which they can download as a PDF or print. Donors must be signed in.

import { get } from "../api.js";
import { requireLogin, bindLogout } from "../auth.js";
import { groupLabel } from "../constants.js";
import { h } from "../ui.js";
import { slipRows, downloadSlip } from "../donor-export.js";

if (requireLogin("donor")) {
  bindLogout();
  init();
}

async function init() {
  // Extra details from this tab's sign-up (e.g. the place name from "Use my location").
  let fresh = null;
  try {
    fresh = JSON.parse(sessionStorage.getItem("bloodlink_registration") || "null");
  } catch {
    fresh = null;
  }

  let me;
  try {
    me = await get("/donor/me");
  } catch {
    return; // signed out: api.js redirects to the sign-in page
  }
  if (!me?.donor) {
    location.replace("donate.html"); // signed in but not registered yet
    return;
  }

  const sameDonor = fresh?.donor_code === me.donor.donor_code;
  const reg = { ...(sameDonor ? fresh : {}), ...me.donor, place: sameDonor ? fresh.place : "" };
  showSlip(reg, sameDonor);
}

function showSlip(reg, justRegistered) {
  const $ = (id) => document.getElementById(id);

  $("slip-code").textContent = reg.donor_code;
  $("slip-group").textContent = groupLabel(reg.blood_group);
  $("slip-details").replaceChildren(
    ...slipRows(reg)
      .filter(([k]) => k !== "Blood group")
      .flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])
  );

  const pill = document.querySelector(".lp-pill[role='status']");
  if (pill) {
    const first = String(reg.name || "").split(/\s+/)[0];
    pill.lastChild.textContent = justRegistered
      ? `You're registered. Your Donor ID is ${reg.donor_code}`
      : `Welcome back${first ? `, ${first}` : ""}. Your Donor ID is ${reg.donor_code}`;
  }

  $("slip").hidden = false;

  const pdfBtn = $("slip-pdf");
  const errorEl = $("slip-error");
  pdfBtn.addEventListener("click", async () => {
    const original = [...pdfBtn.childNodes];
    pdfBtn.disabled = true;
    errorEl.hidden = true;
    pdfBtn.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), "Preparing PDF…");
    try {
      await downloadSlip(reg);
    } catch (err) {
      errorEl.textContent = err.message || "Couldn't create the PDF. Use Print instead.";
      errorEl.hidden = false;
    } finally {
      pdfBtn.replaceChildren(...original);
      pdfBtn.disabled = false;
    }
  });

  $("slip-print").addEventListener("click", () => window.print());
}
