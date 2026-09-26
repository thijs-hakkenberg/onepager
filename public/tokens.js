(function () {
  "use strict";
  const form = document.getElementById("new-token");
  const once = document.getElementById("token-once");
  const value = document.getElementById("token-value");
  const notice = document.getElementById("notice");

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    notice.textContent = "";
    const name = form.elements.name.value.trim();
    if (!name) return;
    const res = await fetch("/api/v1/tokens", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name }),
    });
    if (res.status !== 201) { notice.textContent = "Could not create the token (" + res.status + ")."; return; }
    const token = await res.json();
    value.textContent = token.full_token;
    once.hidden = false;
    form.reset();
  });

  document.addEventListener("click", async (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement) || !t.dataset.revoke) return;
    if (!confirm("Revoke this token? Anything using it stops working immediately.")) return;
    const res = await fetch("/api/v1/tokens/" + encodeURIComponent(t.dataset.revoke), { method: "DELETE", credentials: "same-origin" });
    if (res.status === 204) document.getElementById("token-" + t.dataset.revoke)?.remove();
    else notice.textContent = "Could not revoke (" + res.status + ").";
  });
})();
