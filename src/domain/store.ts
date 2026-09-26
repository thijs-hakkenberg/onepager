import type { Bindings } from "../env";

export type Store = Pick<Bindings, "DB" | "BUCKET">;
export interface Actor {
  id: string;
  email: string | null;
  name: string | null;
}

export const blobKey = (slug: string, n: number) => `${slug}/v/${n}.html`;
export const bool = (v: unknown) => v === 1 || v === true;
