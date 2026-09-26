// The comments sidebar beside /p/:slug, and the bridge to the selection shim that
// runs inside the sandboxed author document (src/html/shim.ts). Four message
// types, untyped on both sides, so a rename is silent — test/pages.test.ts pins
// them in the shim.
(function () {
  "use strict";
  const POLL_MS = 30000;
  const GENERAL = { selector: "body", snippet: "(general)" };
  const sidebar = document.getElementById("sidebar");
  const frame = document.getElementById("onepager-frame");
  const threadsEl = document.getElementById("threads");
  const noticeEl = document.getElementById("notice");
  const form = document.getElementById("composer");
  const box = form.querySelector("textarea");
  const anchorLine = document.getElementById("anchor-line");
  const cancel = document.getElementById("cancel-anchor");
  const toggle = document.getElementById("comments-toggle");
  const toggleLabel = document.getElementById("comments-label");
  const countEl = document.getElementById("comments-count");
  const closeBtn = document.getElementById("sidebar-close");
  // Matches the sheet breakpoint in app.css. Above it the sidebar is always open.
  const narrow = window.matchMedia("(max-width: 1024px)");
  const base = "/p/" + encodeURIComponent(sidebar.dataset.slug) + "/comments";

  let all = [];
  let pending = null;
  let replyTo = null;
  let lost = new Set();
  let counts = {};

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const notice = (msg) => { noticeEl.textContent = msg || ""; };
  const stamp = (iso) => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "");
  const anchored = (c) => c.anchor_selector && c.anchor_selector !== "body";

  async function api(path, init) {
    const res = await fetch(base + path, {
      credentials: "same-origin",
      headers: init && init.body ? { "content-type": "application/json" } : {},
      ...init,
    });
    if (!res.ok && res.status !== 204) {
      let msg = "Request failed (" + res.status + ")";
      try { msg = (await res.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }
    return res.status === 204 ? null : res.json();
  }

  function anchorFor() {
    if (replyTo) {
      const root = all.find((c) => c.comment_id === replyTo);
      return root ? { selector: root.anchor_selector, snippet: root.anchor_text_snippet } : GENERAL;
    }
    return pending || GENERAL;
  }

  function renderAnchorLine() {
    if (replyTo) anchorLine.textContent = "Reply mode — comment goes onto this thread";
    else if (pending) anchorLine.textContent = "Anchor: " + pending.snippet.slice(0, 60);
    else anchorLine.textContent = "Anchor: page (general)";
    cancel.hidden = !(replyTo || pending);
    renderToggle();
  }

  // The sheet on phones and tablets. A tap in the page only arms the button
  // ("Comment on this"); the sheet opens when the reader asks for it.
  function setOpen(open) {
    document.body.classList.toggle("sheet-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  }

  function renderToggle() {
    toggleLabel.textContent = pending ? "Comment on “" + pending.snippet.slice(0, 24) + "”" : "Comments";
    const open = all.filter((c) => !c.parent_comment_id && !c.resolved_at).length;
    countEl.textContent = String(open);
    countEl.hidden = !open || !!pending;
  }

  function computeCounts() {
    const out = {};
    for (const c of all) {
      if (c.parent_comment_id || c.resolved_at || !anchored(c)) continue;
      out[c.anchor_selector] = (out[c.anchor_selector] || 0) + 1;
    }
    return out;
  }

  function postCounts() {
    if (frame.contentWindow) frame.contentWindow.postMessage({ type: "onepager:counts", counts: counts }, "*");
  }

  function body(c) {
    const wrap = document.createDocumentFragment();
    const by = el("div", "by");
    by.append(el("strong", "", c.author_name), " ", stamp(c.created_at));
    wrap.append(by, el("div", "text", c.text));
    return wrap;
  }

  function render() {
    threadsEl.replaceChildren();
    if (!all.length) {
      threadsEl.append(el("div", "muted pad", "No comments yet — be the first."));
      return;
    }
    const ids = new Set(all.map((c) => c.comment_id));
    const roots = all.filter((c) => !c.parent_comment_id || !ids.has(c.parent_comment_id));
    roots.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    for (const root of roots) {
      const t = el("article", "thread");
      t.dataset.anchor = root.anchor_selector;
      if (root.resolved_at) t.classList.add("resolved");
      if (lost.has(root.anchor_selector)) t.classList.add("lost");
      if (anchored(root)) t.append(el("div", "snippet", "↳ " + root.anchor_text_snippet));
      if (lost.has(root.anchor_selector)) t.append(el("div", "lost-note", "⚠ anchor lost — element no longer in the page"));
      t.append(body(root));
      all
        .filter((c) => c.parent_comment_id === root.comment_id)
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
        .forEach((r) => { const d = el("div", "reply"); d.append(body(r)); t.append(d); });
      const row = el("div", "row");
      const reply = el("button", "link", "Reply");
      reply.type = "button";
      reply.addEventListener("click", () => { replyTo = root.comment_id; pending = null; renderAnchorLine(); box.focus(); });
      row.append(reply);
      if (!root.resolved_at) {
        const resolve = el("button", "link", "Resolve");
        resolve.type = "button";
        resolve.addEventListener("click", () => resolveThread(root.comment_id));
        row.append(resolve);
      }
      t.append(row);
      threadsEl.append(t);
    }
  }

  function update(list) {
    all = list;
    counts = computeCounts();
    render();
    renderToggle();
    postCounts();
  }

  async function refresh() {
    try {
      update((await api("")).comments);
    } catch (err) {
      if (!all.length) {
        threadsEl.replaceChildren(el("div", "muted pad", "Comments could not be loaded right now. The page itself is unaffected."));
      }
    }
  }

  async function resolveThread(id) {
    try {
      await api("/" + encodeURIComponent(id) + "/resolve", { method: "POST" });
      notice("");
      await refresh();
    } catch (err) {
      notice(err.message === "Forbidden" ? "That comment is not yours to resolve." : err.message);
    }
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const text = box.value.trim();
    if (!text) return;
    const anchor = anchorFor();
    try {
      const made = await api("", {
        method: "POST",
        body: JSON.stringify({
          text: text,
          anchor_selector: anchor.selector,
          anchor_text_snippet: (anchor.snippet || GENERAL.snippet).slice(0, 200),
          parent_comment_id: replyTo,
        }),
      });
      box.value = "";
      pending = null;
      replyTo = null;
      notice("");
      renderAnchorLine();
      update(all.concat([made]));
    } catch (err) {
      notice("Your comment could not be saved — the text is still here, try again.");
    }
  });

  cancel.addEventListener("click", () => { pending = null; replyTo = null; renderAnchorLine(); });
  toggle.addEventListener("click", () => {
    setOpen(true);
    if (pending) box.focus();
  });
  closeBtn.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") setOpen(false); });

  function focusThread(selector) {
    const t = Array.from(threadsEl.querySelectorAll("[data-anchor]")).find((n) => n.dataset.anchor === selector);
    if (!t) return;
    t.scrollIntoView({ behavior: "smooth", block: "center" });
    t.animate([{ background: "#fff7c2" }, { background: "transparent" }], { duration: 1400 });
  }

  window.addEventListener("message", (ev) => {
    // The framed document has an opaque origin, so identity is the window itself.
    if (ev.source !== frame.contentWindow) return;
    const data = ev.data;
    if (!data || typeof data.type !== "string") return;
    if (data.type === "onepager:anchor" && typeof data.selector === "string") {
      pending = { selector: data.selector.slice(0, 1000), snippet: (data.snippet || "").trim() || GENERAL.snippet };
      replyTo = null;
      notice("");
      renderAnchorLine();
    } else if (data.type === "onepager:lost-anchors" && Array.isArray(data.lost)) {
      lost = new Set(data.lost.filter((s) => typeof s === "string"));
      render();
    } else if (data.type === "onepager:focus") {
      if (narrow.matches) setOpen(true);
      focusThread(data.selector);
    }
  });

  // A postMessage into a document still loading is dropped; replay on load.
  frame.addEventListener("load", postCounts);
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
})();
