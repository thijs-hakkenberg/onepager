(function () {
  "use strict";
  const dialog = document.getElementById("viewers-dialog");
  const list = document.getElementById("viewers-list");

  const item = (text) => { const li = document.createElement("li"); li.textContent = text; return li; };

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
