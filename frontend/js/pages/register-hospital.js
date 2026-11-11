import { getRole, homeFor } from "../auth.js";
import { mountShell } from "../shell.js";
import { h, field } from "../ui.js";
import { REGIONS } from "../constants.js";
import { mountRegister, baseRules, required, maxLen, both } from "./register.js";

if (getRole()) location.replace(homeFor());
mountShell();

mountRegister({
  role: "hospital",
  title: "Register your hospital",
  intro: "An admin verifies new hospitals. You can post requests straight away.",
  fields: [
    field({ label: "Hospital name", name: "name", maxlength: 160 }),
    field({ label: "Email", name: "email", type: "email", autocomplete: "email" }),
    field({ label: "Password", name: "password", type: "password", autocomplete: "new-password", hint: "At least 8 characters." }),
    field({ label: "Phone", name: "phone", type: "tel", autocomplete: "tel", placeholder: "0302123456" }),
    field({ label: "Region", name: "region", options: REGIONS, hint: "Donors in this region are notified of your requests." }),
    field({ label: "City / town", name: "city", maxlength: 80 }),
    field({ label: "Street address", name: "address" }),
    field({ label: "GPS address", name: "gps_address", required: false, optional: true, maxlength: 30, placeholder: "GA-000-0000" }),
  ],
  rules: {
    name: both(required("Please enter the hospital name."), maxLen("Name is too long (max 160).", 160)),
    ...baseRules,
    region: required("Choose your region."),
    city: both(required("Please enter your city or town."), maxLen("City is too long (max 80).", 80)),
    address: required("Please enter the street address."),
    gps_address: maxLen("GPS address is too long (max 30).", 30),
  },
  build: (f) => {
    const body = {
      email: f.email.value.trim(),
      password: f.password.value,
      name: f.name.value.trim(),
      phone: f.phone.value.replace(/\s+/g, ""),
      city: f.city.value.trim(),
      region: f.region.value,
      address: f.address.value.trim(),
    };
    if (f.gps_address.value.trim()) body.gps_address = f.gps_address.value.trim();
    return { path: "/api/auth/register/hospital", body };
  },
  switchLink: ["Already registered? ", h("a", { href: "login.html" }, "Log in")],
});
