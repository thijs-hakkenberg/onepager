import { Layout, type Viewer } from "./layout";

export interface TokenRow {
  token_id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export const Tokens = (props: { user: Viewer; tokens: TokenRow[]; baseUrl: string }) => (
  <Layout title="Plugin tokens" user={props.user} scripts={["/tokens.js"]}>
    <h1>Plugin tokens</h1>
    <p>
      Tokens let the OnePager plugin publish on your behalf. Point the plugin at <code>{props.baseUrl}</code> and paste a
      token when it asks. A token is shown once, when you create it.
    </p>
    <form id="new-token" class="search">
      <input name="name" required maxlength={100} placeholder="Token name, e.g. laptop" />
      <button type="submit" class="btn primary">Create token</button>
    </form>
    <div id="token-once" class="once" hidden>
      <p>Copy this token now — it will not be shown again.</p>
      <code id="token-value" />
    </div>
    <div id="notice" class="error" role="status" />
    <table class="grid-table">
      <thead>
        <tr><th>Name</th><th>Id</th><th>Created</th><th>Last used</th><th /></tr>
      </thead>
      <tbody>
        {props.tokens.length === 0 && (
          <tr><td colspan={5}><em>No tokens yet.</em></td></tr>
        )}
        {props.tokens.map((t) => (
          <tr id={`token-${t.token_id}`}>
            <td>{t.name}</td>
            <td><code>{t.token_id}</code></td>
            <td>{t.created_at.slice(0, 10)}</td>
            <td>{t.last_used_at ? t.last_used_at.slice(0, 16).replace("T", " ") : <span class="muted">never</span>}</td>
            <td><button type="button" class="link danger" data-revoke={t.token_id}>Revoke</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  </Layout>
);
