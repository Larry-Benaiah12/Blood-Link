import { getRole, homeFor } from "../auth.js";
import { mountShell } from "../shell.js";
import { h, field } from "../ui.js";
import { BLOOD_GROUPS, REGIONS, groupLabel } from "../constants.js";
import { mountRegister, baseRules, required, maxLen, both } from "./register.js";

if (getRole()) location.replace(homeFor());
mountShell();

mountRegister({
  role: "donor",
  title: "Create your donor account",
  intro: "You'll only see requests that match your blood type and region.",
  fields: [
    field({ label: "Full name", name: "full_name", autocomplete: "name", maxlength: 120 }),
    field({ label: "Email", name: "email", type: "email", autocomplete: "email" }),
    field({ label: "Password", name: "password", type: "password", autocomplete: "new-password", hint: "At least 8 characters." }),
    field({ label: "Phone", name: "phone", type: "tel", autocomplete: "tel", placeholder: "0241234567", hint: "Shared with a hospital only when you accept its request." }),
    field({ label: "Blood type", name: "blood_type", options: BLOOD_GROUPS.map((g) => [g, groupLabel(g)]) }),
    field({ label: "Region", name: "region", options: REGIONS }),
    field({ label: "City / town", name: "city", maxlength: 80 }),
    field({ label: "GPS address", name: "gps_address", required: false, optional: true, maxlength: 30, placeholder: "GA-123-4567", hint: "Ghana Post GPS code." }),
  ],
  rules: {
    full_name: both(required("Please enter your full name."), maxLen("Name is too long (max 120).", 120)),
    ...baseRules,
    blood_type: required("Choose your blood type."),
    region: required("Choose your region."),
    city: both(required("Please enter your city or town."), maxLen("City is too long (max 80).", 80)),
    gps_address: maxLen("GPS address is too long (max 30).", 30),
  },
  build: (f) => {
    const body = {
      email: f.email.value.trim(),
      password: f.password.value,
      full_name: f.full_name.value.trim(),
      phone: f.phone.value.replace(/\s+/g, ""),
      blood_type: f.blood_type.value,
      city: f.city.value.trim(),
      region: f.region.value,
    };
    if (f.gps_address.value.trim()) body.gps_address = f.gps_address.value.trim();
    return { path: "/api/auth/register/donor", body };
  },
  switchLink: ["Already registered? ", h("a", { href: "login.html" }, "Log in")],
});
