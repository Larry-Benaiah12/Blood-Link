import { requireRole } from "../auth.js";
import { mountShell } from "../shell.js";
import { mountProfile } from "./profile-form.js";

mountShell();
if (requireRole("donor")) mountProfile("donor");
