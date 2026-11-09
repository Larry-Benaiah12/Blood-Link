import { requireRole } from "../auth.js";
import { mountShell } from "../shell.js";
import { setHeading } from "./parts.js";
import { mountProfile } from "./profile-form.js";

mountShell();
if (requireRole("hospital")) {
  mountProfile("hospital", {
    onLoaded: (p) => setHeading(p.name, p.is_verified ? "Verified hospital" : "Pending verification — an admin will verify your hospital."),
  });
}
