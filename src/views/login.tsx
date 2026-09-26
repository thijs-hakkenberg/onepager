import { Notice } from "./layout";

export const Login = (props: { next: string; providers: ("github" | "google")[]; error?: string }) => {
  const q = props.next === "/me" ? "" : `?next=${encodeURIComponent(props.next)}`;
  return (
    <Notice title="Sign in — OnePager" heading="Sign in to OnePager">
      {props.error && <p class="error">{props.error}</p>}
      {props.providers.length === 0 && <p>No sign-in provider is configured on this deployment.</p>}
      <div class="stack">
        {props.providers.includes("github") && <a class="btn primary" href={`/auth/github${q}`}>Continue with GitHub</a>}
        {props.providers.includes("google") && <a class="btn primary" href={`/auth/google${q}`}>Continue with Google</a>}
      </div>
    </Notice>
  );
};
