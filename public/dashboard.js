(function () {
  "use strict";
  const dialog = document.getElementById("viewers-dialog");
  const list = document.getElementById("viewers-list");

  const item = (text) => { const li = document.createElement("li"); li.textContent = text; return li; };

  const WARN_PUBLIC = "Make this page public?\n\nAnyone with the link will be able to read it without signing in, " +
    "and so can any agent that fetches its llm.txt.";

  document.addEventListener("change", async (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLSelectElement) || !t.dataset.visibility) return;
    const previous = t.dataset.current;
    const next = t.value;
    if (next === "public" && !confirm(WARN_PUBLIC)) { t.value = previous; return; }
    t.disabled = true;
    const res = await fetch("/api/v1/onepagers/" + encodeURIComponent(t.dataset.visibility), {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility: next }),
    });
    t.disabled = false;
    if (!res.ok) { t.value = previous; alert("Could not change visibility (" + res.status + ")."); return; }
    t.dataset.current = next;
    t.className = "vis vis-" + next;
  });

  document.addEventListener("click", async (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;

    if (t.dataset.delete) {
      const slug = t.dataset.delete;
      if (!confirm("Delete “" + (t.dataset.title || slug) + "” and all its versions? This cannot be undone.")) return;
      const res = await fetch("/me/onepagers/" + encodeURIComponent(slug), { method: "DELETE", credentials: "same-origin" });
      if (res.status === 204) document.getElementById("row-" + slug)?.remove();
      else alert("Could not delete (" + res.status + ").");
    }

    if (t.dataset.viewers) {
      list.replaceChildren(item("Loading…"));
      dialog.showModal();
      const res = await fetch("/me/onepagers/" + encodeURIComponent(t.dataset.viewers) + "/viewers", { credentials: "same-origin" });
      if (!res.ok) { list.replaceChildren(item("Could not load viewers (" + res.status + ").")); return; }
      const { viewers } = await res.json();
      list.replaceChildren(...(viewers.length
        ? viewers.map((v) => item((v.email || "(no email)") + " — " + v.views + " view" + (v.views === 1 ? "" : "s") +
            ", last " + v.last_viewed.slice(0, 16).replace("T", " ")))
        : [item("Nobody but you has viewed this yet.")]));
    }
  });
})();
