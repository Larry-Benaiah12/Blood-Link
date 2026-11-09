// In-browser mock of the Flask API. Only loaded when USE_MOCKS = true in api.js.
// Data persists in localStorage (falls back to memory) so you can click
// through the whole flow. Delete this file once the backend is ready.
//
// Temporary sign-in accounts (until the real backend checks credentials):
//   admin@bloodlink.test / BloodLink@2026  → admin page
//   demo@hospital.test   / Hospital@2026   → hospital dashboard
// Donors create their own account (username/email + password, or Google).

import { BLOOD_GROUPS, COMPATIBLE_DONORS, DONATION_GAP_DAYS, donorCode } from "./constants.js";
import { queryDonations, donationBounds, SITES, VOLUME_ML } from "./mock-donations.js";

const STORE_KEY = "bloodlink_mock_db";
const DEMO = { email: "demo@hospital.test", password: "Hospital@2026" };
const ADMIN = { email: "admin@bloodlink.test", password: "BloodLink@2026" };
const HOSPITAL = { id: 1, name: "City General Hospital", lat: 5.6037, lng: -0.187 };
const DAY = 86400000;
const DONOR_TOKEN = "mock-donor-";

let memoryDb = null;

function seed() {
  const now = Date.now();
  const names = ["Ama", "Kwame", "Esi", "Kofi", "Abena", "Yaw", "Akosua", "Kojo", "Efua", "Kwesi", "Adwoa", "Fiifi"];
  const donors = names.map((first, i) => ({
    id: i + 1,
    donor_code: donorCode(i + 1),
    registered_at: new Date(now - (names.length - i) * 9 * DAY).toISOString(),
    name: `${first} Mensah`,
    phone: `+233 24 555 ${String(1001 + i)}`, // only shown to admins
    blood_group: BLOOD_GROUPS[i % BLOOD_GROUPS.length],
    lat: HOSPITAL.lat + ((i * 37) % 17 - 8) * 0.006,
    lng: HOSPITAL.lng + ((i * 53) % 19 - 9) * 0.006,
    area: ["Amasaman, Accra", "Madina, Accra", "Kasoa, Accra", "Tema, Accra"][i % 4],
    location_shared: true,
    last_donation_date: i % 3 === 0 ? new Date(now - 30 * DAY).toISOString().slice(0, 10) : null,
    consent: true,
  }));
  return migrate({
    nextDonorId: donors.length + 1,
    nextRequestId: 103,
    donors,
    requests: [
      { id: 101, blood_group: "O-", units: 3, urgency: "critical", note: "Theatre 2", status: "open", created_at: new Date(now - 2 * 3600e3).toISOString() },
      { id: 102, blood_group: "A+", units: 1, urgency: "normal", note: "", status: "fulfilled", created_at: new Date(now - 3 * DAY).toISOString() },
    ],
    notified: {}, // { requestId: [donorId, ...] }
  });
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch {}
  if (!memoryDb) memoryDb = seed();
  return memoryDb;
}

// Bring data saved by older versions up to date.
function migrate(db) {
  const now = Date.now();
  db.donors.forEach((d) => {
    if (!d.donor_code) d.donor_code = donorCode(d.id);
    if (!d.registered_at) d.registered_at = new Date(now - (db.nextDonorId - d.id) * 3 * DAY).toISOString();
    if (d.prior_last_donation === undefined) d.prior_last_donation = d.last_donation_date || null;
  });
  db.visits ||= []; // donor visits recorded by an admin
  db.nextVisitId ||= 1_000_001; // far above the generated demo history
  db.nextWalkInId ||= 1;
  db.accounts ||= []; // donor sign-in accounts
  db.nextAccountId ||= 1;
  return db;
}

function save(db) {
  memoryDb = db;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch {}
}

// ---------- Donors ----------

const visitsOf = (db, code) => db.visits.filter((v) => v.donor_id === code);

/** Eligible to donate now? Admin override first, then the 90-day rule. */
function isEligible(donor) {
  if (donor.status_override === "must_wait") return false;
  if (donor.status_override === "eligible") return true;
  if (!donor.last_donation_date) return true;
  return Date.now() - new Date(donor.last_donation_date).getTime() >= DONATION_GAP_DAYS * DAY;
}

/** Last donation = latest of what they told us at sign-up and completed visits. */
function refreshDonor(db, d) {
  const dates = visitsOf(db, d.donor_code)
    .filter((v) => v.status === "completed")
    .map((v) => v.donated_at.slice(0, 10));
  if (d.prior_last_donation) dates.push(d.prior_last_donation);
  d.last_donation_date = dates.sort().pop() || null;
}

/** Full donor details: admins only (and the donor's own page). */
function donorRecord(d, db) {
  const visits = db ? visitsOf(db, d.donor_code) : [];
  return {
    id: d.id,
    donor_code: d.donor_code,
    name: d.name,
    phone: d.phone,
    blood_group: d.blood_group,
    area: d.area,
    location_shared: d.location_shared !== false,
    lat: d.location_shared === false ? null : d.lat,
    lng: d.location_shared === false ? null : d.lng,
    last_donation_date: d.last_donation_date || null,
    registered_at: d.registered_at,
    eligible: isEligible(d),
    status_override: d.status_override || null,
    visits: visits.length,
    donations: visits.filter((v) => v.status === "completed").length,
    donated_before_signup: !!d.prior_last_donation,
    consent: !!d.consent,
  };
}

/** Search by Donor ID ("DN0007", "7", "0007") or by any part of the name. */
function searchDonors(db, q) {
  const query = String(q || "").trim();
  if (!query) return db.donors;
  const compact = query.toUpperCase().replace(/\s+/g, "");
  const idDigits = /^(DN)?\d+$/.test(compact) ? Number(compact.replace(/^DN/, "")) : null;
  const words = query.toLowerCase().split(/\s+/);
  return db.donors.filter(
    (d) =>
      d.donor_code.includes(compact) ||
      (idDigits != null && d.id === idDigits) ||
      words.every((w) => d.name.toLowerCase().includes(w))
  );
}

function findDonor(db, code) {
  const c = String(code || "").trim().toUpperCase();
  return db.donors.find((d) => d.donor_code === c);
}

// ---------- Admin: recorded visits ----------

const pad = (n) => String(n).padStart(2, "0");
function localStamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function recordVisit(db, body) {
  const fields = {};
  let donor = null;
  const walkIn = !!body.walk_in;

  if (walkIn) {
    if (!String(body.walk_in_name || "").trim()) fields.walk_in_name = "Enter the donor's name.";
  } else {
    donor = findDonor(db, body.donor_code);
    if (!donor) fields.donor_code = body.donor_code ? `No registered donor has the ID ${body.donor_code}.` : "Choose a registered donor.";
  }
  const group = donor ? donor.blood_group : body.blood_group;
  if (!BLOOD_GROUPS.includes(group)) fields.blood_group = "Choose the blood group.";

  const when = new Date(body.donated_at);
  if (!body.donated_at || Number.isNaN(when.getTime())) fields.donated_at = "Enter the date and time of the visit.";
  else if (when.getTime() > Date.now() + 5 * 60e3) fields.donated_at = "The visit can't be in the future.";

  if (!String(body.site || "").trim()) fields.site = "Choose the collection site.";
  if (!(body.type in VOLUME_ML)) fields.type = "Choose the donation type.";
  if (!["completed", "deferred"].includes(body.status)) fields.status = "Choose the outcome.";

  const litres = Number(body.volume_l);
  if (body.status === "completed" && (!Number.isFinite(litres) || litres <= 0 || litres > 1.5)) {
    fields.volume_l = "Enter the litres collected (between 0.01 and 1.5).";
  }
  const visitNo = Number(body.visit_number);
  if (!Number.isInteger(visitNo) || visitNo < 1 || visitNo > 500) fields.visit_number = "Enter the visit number (1 for a first-timer).";

  if (Object.keys(fields).length) return { error: fields };

  const visit = {
    id: db.nextVisitId++,
    donated_at: localStamp(when),
    donor_id: donor ? donor.donor_code : `WALKIN-${db.nextWalkInId++}`,
    donor_name: donor ? donor.name : String(body.walk_in_name).trim(),
    blood_group: group,
    type: body.type,
    volume_ml: body.status === "completed" ? Math.round(litres * 1000) : 0,
    site: String(body.site).trim(),
    first_time: visitNo === 1,
    visit_number: visitNo,
    status: body.status,
    manual: true,
    recorded_at: new Date().toISOString(),
  };
  db.visits.push(visit);

  if (donor) {
    // Completed: the normal 90-day wait applies. Deferred: must wait until an admin clears it.
    donor.status_override = body.status === "deferred" ? "must_wait" : null;
    refreshDonor(db, donor);
  }
  return { visit, donor };
}

// ---------- Donor accounts ----------

async function hashPassword(identifier, password) {
  const input = `bloodlink:${identifier}:${password}`;
  try {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // crypto.subtle is missing on plain-http pages; good enough for a mock.
    let h = 2166136261;
    for (const ch of input) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return `fnv${(h >>> 0).toString(16)}`;
  }
}

/** Reads the payload of a Google ID token. The real backend MUST verify the signature. */
function decodeJwt(token) {
  try {
    const part = String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      [...atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), "="))].map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function accountFromToken(db, token) {
  if (!String(token || "").startsWith(DONOR_TOKEN)) return null;
  const id = Number(token.slice(DONOR_TOKEN.length));
  return db.accounts.find((a) => a.id === id) || null;
}

function publicAccount(a) {
  return { id: a.id, name: a.name, email: a.email || null, username: a.username || null, provider: a.provider, picture: a.picture || null };
}

function session(a) {
  return ok({ token: `${DONOR_TOKEN}${a.id}`, role: "donor", account: publicAccount(a) });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USERNAME_RE = /^[a-z0-9._]{3,30}$/;

// ---------- Hospital matching ----------

function distanceKm(aLat, aLng, bLat, bLng) {
  const r = (d) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat);
  const dLng = r(bLng - aLng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function matchesFor(db, req) {
  const allowed = COMPATIBLE_DONORS[req.blood_group] || [];
  const notified = db.notified[req.id] || [];
  return db.donors
    .filter((d) => d.consent && allowed.includes(d.blood_group) && d.lat != null)
    .map((d) => ({
      id: d.id,
      first_name: d.name.split(/\s+/)[0],
      blood_group: d.blood_group,
      distance_km: Math.round(distanceKm(HOSPITAL.lat, HOSPITAL.lng, d.lat, d.lng) * 10) / 10,
      eligible: isEligible(d),
      notified: notified.includes(d.id),
    }))
    .filter((m) => m.distance_km <= 25)
    .sort((a, b) => a.distance_km - b.distance_km);
}

const ok = (data, status = 200) => ({ status, data });
const fail = (status, message, fields) => ({ status, data: { message, ...(fields ? { fields } : {}) } });

export async function mockRequest(method, path, body = {}, token) {
  await new Promise((r) => setTimeout(r, 350)); // feel like a network
  const db = load();
  const url = new URL(path, "http://mock");
  const parts = url.pathname.split("/").filter(Boolean); // ["requests", "101", "matches"]

  // ---- Donor accounts (public) ----
  if (method === "POST" && url.pathname === "/auth/donor/register") {
    const fields = {};
    const name = String(body.name || "").trim();
    const identifier = String(body.identifier || "").trim().toLowerCase();
    const password = String(body.password || "");
    const isEmail = identifier.includes("@");
    if (!name) fields.name = "Please enter your full name.";
    if (!identifier) fields.identifier = "Choose a username or enter your email.";
    else if (isEmail && !EMAIL_RE.test(identifier)) fields.identifier = "That doesn't look like an email address.";
    else if (!isEmail && !USERNAME_RE.test(identifier)) fields.identifier = "Usernames use 3–30 letters, numbers, dots or underscores.";
    else if (db.accounts.some((a) => a.email === identifier || a.username === identifier)) fields.identifier = "That username or email is already taken. Try signing in.";
    if (password.length < 8 || !/[a-z]/i.test(password) || !/\d/.test(password)) fields.password = "Use at least 8 characters with letters and numbers.";
    if (Object.keys(fields).length) return fail(400, "Please fix the highlighted fields.", fields);

    const account = {
      id: db.nextAccountId++,
      provider: "password",
      name,
      email: isEmail ? identifier : null,
      username: isEmail ? null : identifier,
      password_hash: await hashPassword(identifier, password),
      created_at: new Date().toISOString(),
      donor_id: null,
    };
    db.accounts.push(account);
    save(db);
    return session(account);
  }

  if (method === "POST" && url.pathname === "/auth/donor/login") {
    const identifier = String(body.identifier || "").trim().toLowerCase();
    const account = db.accounts.find((a) => a.provider === "password" && (a.email === identifier || a.username === identifier));
    if (!account || account.password_hash !== (await hashPassword(identifier, String(body.password || "")))) {
      return fail(401, "Incorrect username/email or password.");
    }
    return session(account);
  }

  if (method === "POST" && url.pathname === "/auth/google") {
    // Real backend: verify body.credential with Google (signature, aud = your
    // client ID, iss, exp) before trusting any of it.
    const claims = decodeJwt(body.credential);
    if (!claims?.sub || !claims?.email) return fail(401, "Google sign-in failed. Please try again.");
    const email = String(claims.email).toLowerCase();
    let account = db.accounts.find((a) => a.google_sub === claims.sub) || db.accounts.find((a) => a.email === email);
    if (!account) {
      account = { id: db.nextAccountId++, created_at: new Date().toISOString(), donor_id: null };
      db.accounts.push(account);
    }
    Object.assign(account, {
      provider: "google",
      google_sub: claims.sub,
      email,
      name: account.name || claims.name || email.split("@")[0],
      picture: claims.picture || account.picture || null,
    });
    save(db);
    return session(account);
  }

  // ---- Donor (signed-in donor required) ----
  if (url.pathname === "/donor/me" || (method === "POST" && url.pathname === "/donors")) {
    const account = accountFromToken(db, token);
    if (!account) return fail(401, "Please sign in first.");
    const donor = account.donor_id ? db.donors.find((d) => d.id === account.donor_id) : null;

    if (method === "GET") return ok({ account: publicAccount(account), donor: donor ? donorRecord(donor, db) : null });

    if (donor) return fail(409, `You're already registered as donor ${donor.donor_code}.`);
    const fields = {};
    if (!body.name || !String(body.name).trim()) fields.name = "Please enter your name.";
    const digits = String(body.phone || "").replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 15) fields.phone = "Enter a valid phone number, e.g. +233 24 123 4567.";
    if (!BLOOD_GROUPS.includes(body.blood_group)) fields.blood_group = "Choose your blood group.";
    if (!body.area || !String(body.area).trim()) fields.area = "Tell us your area or town.";
    if (body.last_donation_date && new Date(body.last_donation_date) > new Date()) fields.last_donation_date = "This date is in the future.";
    if (!body.consent) fields.consent = "We need your consent to contact you.";
    if (Object.keys(fields).length) return fail(400, "Please fix the highlighted fields.", fields);

    const id = db.nextDonorId++;
    const created = {
      id,
      donor_code: donorCode(id), // sequential: DN0001, DN0002, …
      registered_at: new Date().toISOString(),
      ...body,
      name: String(body.name).trim(),
      prior_last_donation: body.last_donation_date || null,
      location_shared: body.lat != null && body.lng != null,
      // No location given: place them near the hospital so the demo still matches.
      lat: body.lat ?? HOSPITAL.lat + 0.01,
      lng: body.lng ?? HOSPITAL.lng + 0.01,
      account_id: account.id,
    };
    db.donors.push(created);
    account.donor_id = id;
    save(db);
    return ok({ id, donor_code: created.donor_code, donor: donorRecord(created, db) }, 201);
  }

  // ---- Staff sign-in ----
  if (method === "POST" && url.pathname === "/auth/login") {
    if (String(body.email).trim().toLowerCase() === DEMO.email && body.password === DEMO.password) {
      return ok({ token: "mock-token", role: "hospital", hospital: { id: HOSPITAL.id, name: HOSPITAL.name } });
    }
    if (String(body.email).trim().toLowerCase() === ADMIN.email && body.password === ADMIN.password) {
      return ok({ token: "mock-admin-token", role: "admin", hospital: { id: 0, name: "BloodLink network" } });
    }
    return fail(401, "Incorrect email or password. Please check your details and try again.");
  }

  // ---- Admin (admin token required) ----
  if (parts[0] === "admin") {
    if (token !== "mock-admin-token") return fail(token ? 403 : 401, "Admins only.");
    if (method === "GET" && url.pathname === "/admin/donations/meta") {
      return ok({ sites: SITES, ...donationBounds(db.visits) });
    }
    if (method === "GET" && url.pathname === "/admin/donations") {
      return ok(queryDonations(url.searchParams, db.visits));
    }
    // Visits recorded by hand, newest entry first.
    if (method === "GET" && url.pathname === "/admin/donations/recent") {
      return ok([...db.visits].sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1)).slice(0, 50));
    }
    if (method === "POST" && url.pathname === "/admin/donations") {
      const res = recordVisit(db, body);
      if (res.error) return fail(400, "Please fix the highlighted fields.", res.error);
      save(db);
      return ok({ visit: res.visit, donor: res.donor ? donorRecord(res.donor, db) : null }, 201);
    }
    if (method === "DELETE" && parts[1] === "donations" && parts[2]) {
      const i = db.visits.findIndex((v) => String(v.id) === parts[2]);
      if (i < 0) return fail(404, "That entry no longer exists.");
      const [removed] = db.visits.splice(i, 1);
      const donor = findDonor(db, removed.donor_id);
      if (donor) refreshDonor(db, donor);
      save(db);
      return ok({ removed: removed.id });
    }
    if (method === "GET" && url.pathname === "/admin/donors") {
      const list = searchDonors(db, url.searchParams.get("q")).map((d) => donorRecord(d, db)).sort((a, b) => a.id - b.id);
      return ok({ total: db.donors.length, results: list });
    }
    // Set a donor's status: "eligible", "must_wait" or "auto" (90-day rule).
    if (method === "PATCH" && parts[1] === "donors" && parts[2]) {
      const donor = findDonor(db, decodeURIComponent(parts[2]));
      if (!donor) return fail(404, "We couldn't find that donor.");
      if (!["auto", "eligible", "must_wait"].includes(body.status)) return fail(400, "Unknown status.");
      donor.status_override = body.status === "auto" ? null : body.status;
      save(db);
      return ok(donorRecord(donor, db));
    }
  }

  // ---- Hospital (auth required) ----
  if (token !== "mock-token") return fail(401, "Please log in.");

  if (parts[0] === "requests") {
    if (parts.length === 1 && method === "GET") return ok(db.requests);

    if (parts.length === 1 && method === "POST") {
      const fields = {};
      if (!BLOOD_GROUPS.includes(body.blood_group)) fields.blood_group = "Choose a blood group.";
      if (!Number.isInteger(body.units) || body.units < 1) fields.units = "Enter at least 1 unit.";
      if (!["critical", "high", "normal"].includes(body.urgency)) fields.urgency = "Choose an urgency.";
      if (Object.keys(fields).length) return fail(400, "Please fix the highlighted fields.", fields);

      const req = {
        id: db.nextRequestId++,
        blood_group: body.blood_group,
        units: body.units,
        urgency: body.urgency,
        note: body.note || "",
        status: "open",
        created_at: new Date().toISOString(),
      };
      db.requests.push(req);
      save(db);
      return ok(req, 201);
    }

    const req = db.requests.find((r) => String(r.id) === parts[1]);
    if (!req) return fail(404, "We couldn't find that request.");

    if (parts.length === 2 && method === "GET") return ok(req);

    if (parts.length === 2 && method === "PATCH") {
      if (!["open", "fulfilled", "cancelled"].includes(body.status)) return fail(400, "Unknown status.");
      req.status = body.status;
      save(db);
      return ok(req);
    }

    if (parts[2] === "matches" && method === "GET") return ok(matchesFor(db, req));

    if (parts[2] === "notify" && method === "POST") {
      if (req.status !== "open") return fail(409, "Only open requests can notify donors.");
      const already = new Set(db.notified[req.id] || []);
      const fresh = matchesFor(db, req).filter((m) => m.eligible && !already.has(m.id));
      fresh.forEach((m) => already.add(m.id));
      db.notified[req.id] = [...already];
      save(db);
      return ok({ notified: fresh.length });
    }
  }

  return fail(404, `Mock has no handler for ${method} ${url.pathname}.`);
}
