// In-browser mock of the Flask API. Only loaded when USE_MOCKS = true in api.js.
// Data persists in localStorage (falls back to memory) so you can click
// through the whole flow. Delete this file once the backend is ready.
//
// Demo login: demo@hospital.test / password

import { BLOOD_GROUPS, COMPATIBLE_DONORS, DONATION_GAP_DAYS } from "./constants.js";

const STORE_KEY = "bloodlink_mock_db";
const DEMO = { email: "demo@hospital.test", password: "password" };
const HOSPITAL = { id: 1, name: "City General Hospital", lat: 5.6037, lng: -0.187 };
const DAY = 86400000;

let memoryDb = null;

function seed() {
  const now = Date.now();
  const names = ["Ama", "Kwame", "Esi", "Kofi", "Abena", "Yaw", "Akosua", "Kojo", "Efua", "Kwesi", "Adwoa", "Fiifi"];
  const donors = names.map((first, i) => ({
    id: i + 1,
    name: `${first} Mensah`,
    phone: "+000000000" + i, // never sent to the UI
    blood_group: BLOOD_GROUPS[i % BLOOD_GROUPS.length],
    lat: HOSPITAL.lat + ((i * 37) % 17 - 8) * 0.006,
    lng: HOSPITAL.lng + ((i * 53) % 19 - 9) * 0.006,
    area: "Central",
    last_donation_date: i % 3 === 0 ? new Date(now - 30 * DAY).toISOString().slice(0, 10) : null,
    consent: true,
  }));
  return {
    nextDonorId: donors.length + 1,
    nextRequestId: 103,
    donors,
    requests: [
      { id: 101, blood_group: "O-", units: 3, urgency: "critical", note: "Theatre 2", status: "open", created_at: new Date(now - 2 * 3600e3).toISOString() },
      { id: 102, blood_group: "A+", units: 1, urgency: "normal", note: "", status: "fulfilled", created_at: new Date(now - 3 * DAY).toISOString() },
    ],
    notified: {}, // { requestId: [donorId, ...] }
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  if (!memoryDb) memoryDb = seed();
  return memoryDb;
}

function save(db) {
  memoryDb = db;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch {}
}

function distanceKm(aLat, aLng, bLat, bLng) {
  const r = (d) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat);
  const dLng = r(bLng - aLng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function isEligible(donor) {
  if (!donor.last_donation_date) return true;
  return Date.now() - new Date(donor.last_donation_date).getTime() >= DONATION_GAP_DAYS * DAY;
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

  // ---- Public ----
  if (method === "POST" && url.pathname === "/donors") {
    const fields = {};
    if (!body.name || !String(body.name).trim()) fields.name = "Please enter your name.";
    const digits = String(body.phone || "").replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 15) fields.phone = "Enter a valid phone number, e.g. +233 24 123 4567.";
    if (!BLOOD_GROUPS.includes(body.blood_group)) fields.blood_group = "Choose your blood group.";
    if (!body.area || !String(body.area).trim()) fields.area = "Tell us your area or town.";
    if (body.last_donation_date && new Date(body.last_donation_date) > new Date()) fields.last_donation_date = "This date is in the future.";
    if (!body.consent) fields.consent = "We need your consent to contact you.";
    if (Object.keys(fields).length) return fail(400, "Please fix the highlighted fields.", fields);

    const donor = {
      id: db.nextDonorId++,
      ...body,
      // No location given: place them near the hospital so the demo still matches.
      lat: body.lat ?? HOSPITAL.lat + 0.01,
      lng: body.lng ?? HOSPITAL.lng + 0.01,
    };
    db.donors.push(donor);
    save(db);
    return ok({ id: donor.id }, 201);
  }

  if (method === "POST" && url.pathname === "/auth/login") {
    if (String(body.email).trim().toLowerCase() === DEMO.email && body.password === DEMO.password) {
      return ok({ token: "mock-token", hospital: { id: HOSPITAL.id, name: HOSPITAL.name } });
    }
    return fail(401, "That email and password don't match. Try demo@hospital.test / password.");
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
