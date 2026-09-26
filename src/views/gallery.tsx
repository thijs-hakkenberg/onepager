import type { PagerMeta } from "../domain/pagers";
import { VisibilityPill } from "./dashboard";
import { Layout, type Viewer } from "./layout";

export const Gallery = (props: { user: Viewer; name: string; cards: PagerMeta[] }) => (
  <Layout title={`${props.name} — OnePager gallery`} user={props.user}>
    <h1>{props.name}</h1>
    <div class="cards">
      {props.cards.length === 0 && (
        <p class="muted">
          <em>This gallery has no OnePagers yet — publish one into the group with <code>/publish-onepager --group</code>.</em>
        </p>
      )}
      {props.cards.map((m) => (
        <a class="card" href={`/p/${m.slug}`}>
          <div class="title">
            {m.title} {m.visibility !== "signed_in" && <VisibilityPill v={m.visibility} />}
          </div>
          <div class="muted"><code>{m.slug}</code></div>
          <div class="muted small">
            v{m.version_count} · updated {(m.last_updated_at ?? m.created_at).slice(0, 10)}
          </div>
        </a>
      ))}
    </div>
  </Layout>
);
