import { requireRole } from "../auth.js";
import { mountShell } from "../shell.js";
import { donorFormActions } from "../files.js";
import { mountProfile } from "./profile-form.js";

mountShell();
if (requireRole("donor")) {
  document.getElementById("app").before(donorFormActions(document.getElementById("alert")));
  mountProfile("donor");
}
