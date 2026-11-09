import { get } from "../api.js";
import { requireRole } from "../auth.js";
import { mountShell } from "../shell.js";
import { icon } from "../icons.js";
import { h, showAlert, loadingRow, formatDate } from "../ui.js";
import { requestCard, emptyBlock, kpi } from "./parts.js";

mountShell();
if (requireRole("donor")) init();

async function init() {
  const app = document.getElementById("app");
  app.replaceChildren(loadingRow("Loading your responses…"));
  try {
    const list = await get("/api/donors/history");
    const accepted = list.filter((r) => r.my_response === "accepted").length;
    app.replaceChildren(
      list.length
        ? h("div", {},
            h("div", { class: "kpis" },
              kpi("checkCircle", accepted, "Accepted", "green"),
              kpi("ban", list.length - accepted, "Declined", "grey"),
              kpi("history", list.length, "Total responses", "blue")),
            h("div", { class: "req-list" },
              list.map((r) =>
                requestCard(r,
                  h("p", { class: "reply" + (r.my_response === "accepted" ? "" : " muted") },
                    icon(r.my_response === "accepted" ? "checkCircle" : "x"),
                    `You ${r.my_response} this on ${formatDate(r.responded_at)}`)))))
        : emptyBlock("history", "No responses yet", "Requests you accept or decline will be listed here.")
    );
  } catch (err) {
    app.replaceChildren();
    showAlert(document.getElementById("alert"), err.message);
  }
}
