import { VISIBILITIES, VISIBILITY_LABEL, type Visibility } from "../domain/access";
import type { ListingRow } from "../domain/pagers";
import { Layout, type Viewer } from "./layout";

export interface DashboardRow extends ListingRow {
  groups: string[];
  views: number;
}

export const VisibilityPill = ({ v }: { v: Visibility }) => (
  <span class={`vis vis-${v}`} title={VISIBILITY_LABEL[v].who}>{VISIBILITY_LABEL[v].name}</span>
);

const href = (group: string, q: string) => {
  const p = new URLSearchParams();
  if (group) p.set("group", group);
  if (q) p.set("q", q);
  const s = p.toString();
  return s ? `/me?${s}` : "/me";
};

export function Dashboard(props: {
  user: Viewer;
  rows: DashboardRow[];
  groups: { group_slug: string; name: string }[];
  q: string;
  group: string;
}) {
  const names = new Map(props.groups.map((g) => [g.group_slug, g.name]));
  return (
    <Layout title="Your OnePagers" user={props.user} scripts={["/dashboard.js"]}>
      <h1>Your OnePagers</h1>
      <form method="get" action="/me" class="search">
        {props.group && <input type="hidden" name="group" value={props.group} />}
        <input type="search" name="q" value={props.q} placeholder="Search titles, filenames and content" />
        <button type="submit" class="btn">Search</button>
        {props.q && <a href={href(props.group, "")}>Clear</a>}
      </form>
      {props.groups.length > 0 && (
        <div class="chips">
          <span class="muted">Groups:</span>
          <a href={href("", props.q)} class={props.group === "" ? "chip active" : "chip"}>All</a>
          {props.groups.map((g) => (
            <span>
              <a href={href(g.group_slug, props.q)} class={props.group === g.group_slug ? "chip active" : "chip"}>{g.name}</a>
              <a href={`/g/${g.group_slug}`} title="Open live gallery" class="chip">↗</a>
            </span>
          ))}
        </div>
      )}
      {props.q && (
        <p class="muted">
          {props.rows.length} result{props.rows.length === 1 ? "" : "s"} for “{props.q}”
        </p>
      )}
      <table class="grid-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Slug</th>
            <th>Groups</th>
            <th>Role</th>
            <th>Visibility</th>
            <th>Created</th>
            <th>Views</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {props.rows.length === 0 && (
            <tr>
              <td colspan={8}>
                <em>
                  {props.q || props.group
                    ? "Nothing matches."
                    : "No OnePagers yet — publish one with a plugin token from the tokens page."}
                </em>
              </td>
            </tr>
          )}
          {props.rows.map((r) => (
            <tr id={`row-${r.slug}`}>
              <td>
                <a href={`/p/${r.slug}`}>{r.title}</a>
                {r.matched_content && <span class="badge soft">content match</span>}
              </td>
              <td><code>{r.slug}</code></td>
              <td>
                {r.groups.length === 0 ? <span class="muted">—</span> : r.groups.map((g) => <a href={`/g/${g}`} class="gap">{names.get(g) ?? g}</a>)}
              </td>
              <td>{r.role}</td>
              <td>
                {r.role === "owner" ? (
                  <select class={`vis vis-${r.visibility}`} data-visibility={r.slug} data-current={r.visibility} aria-label="Who can see this">
                    {VISIBILITIES.map((v) => (
                      <option value={v} selected={v === r.visibility} title={VISIBILITY_LABEL[v].who}>{VISIBILITY_LABEL[v].name}</option>
                    ))}
                  </select>
                ) : (
                  <VisibilityPill v={r.visibility} />
                )}
              </td>
              <td>{r.created_at.slice(0, 10)}</td>
              <td>{r.views === 0 ? <span class="muted">Never viewed</span> : r.views}</td>
              <td class="actions">
                {r.role === "owner" && (
                  <>
                    <button type="button" class="link" data-viewers={r.slug}>Viewers</button>
                    <button type="button" class="link danger" data-delete={r.slug} data-title={r.title}>Delete</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dialog id="viewers-dialog">
        <h2>Who viewed</h2>
        <ul id="viewers-list" />
        <form method="dialog"><button class="btn">Close</button></form>
      </dialog>
    </Layout>
  );
}
