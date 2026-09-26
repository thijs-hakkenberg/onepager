import { Notice } from "./layout";

export const NoPager = ({ slug }: { slug: string }) => (
  <Notice title="NoPager — that link goes nowhere" heading="NoPager — that link goes nowhere.">
    <p>
      No OnePager exists at <code>/p/{slug}</code> — it may have been deleted or the slug was mistyped.
    </p>
    <p>
      See your own dashboard at <a href="/me">/me</a>.
    </p>
  </Notice>
);

export const Private = ({ slug }: { slug: string }) => (
  <Notice title="Private OnePager — you don't have access" heading="This OnePager is private.">
    <p>
      The OnePager at <code>/p/{slug}</code> is eyes only — its owner has limited who can see it, and your account
      isn't on the list.
    </p>
    <p>
      If you think you should have access, ask the owner to share it with the email address you sign in with. Your
      own OnePagers are at <a href="/me">/me</a>.
    </p>
  </Notice>
);

export const NoGroup = ({ slug }: { slug: string }) => (
  <Notice title="No such gallery" heading="No such gallery.">
    <p>
      There is no group at <code>/g/{slug}</code>.
    </p>
  </Notice>
);
