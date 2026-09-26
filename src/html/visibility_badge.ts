import { VISIBILITY_LABEL, type Visibility } from "../domain/access";

// Shown only to the owner, over their own page: a full-width strip when the page
// is public, a small pill otherwise. Hiding it is a CSS checkbox toggle, so it
// works under the chrome CSP (no inline script) and inside author HTML alike.
// Styles live in /visibility.css; the slug is slug-shaped, the labels are ours.
export function visibilityBadge(slug: string, visibility: Visibility): string {
  const { name, who } = VISIBILITY_LABEL[visibility];
  const id = "onepager-vis-hide";
  return (
    `<link rel="stylesheet" href="/visibility.css">` +
    `<input type="checkbox" id="${id}" class="onepager-vis-toggle" hidden>` +
    `<div class="onepager-vis onepager-vis-${visibility}" role="status" title="Only you see this">` +
    `<span class="onepager-vis-dot"></span><strong>${name}</strong>` +
    `<span class="onepager-vis-who">${who}</span>` +
    `<a href="/me#row-${slug}" target="_top">Change</a>` +
    `<label for="${id}" aria-label="Hide">×</label>` +
    `</div>`
  );
}
