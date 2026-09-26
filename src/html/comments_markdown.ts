export interface MarkdownComment {
  comment_id: string;
  parent_comment_id: string | null;
  author_name: string;
  text: string;
  anchor_text_snippet: string;
  created_at: string;
  resolved_at: string | null;
}

const byCreated = (a: MarkdownComment, b: MarkdownComment) => a.created_at.localeCompare(b.created_at);

const line = (c: MarkdownComment, indent: string) =>
  `${indent}- **${c.author_name}** (${c.created_at.slice(0, 10)})${c.resolved_at ? " (resolved)" : ""}: ${c.text}`;

export function commentsMarkdown(comments: readonly MarkdownComment[]): string {
  if (comments.length === 0) return "## Comments\n\n_No comments yet._\n";
  const roots = comments.filter((c) => c.parent_comment_id === null).sort(byCreated);
  const body = roots.flatMap((root) => [
    `### On: "${root.anchor_text_snippet}"`,
    "",
    line(root, ""),
    ...comments.filter((c) => c.parent_comment_id === root.comment_id).sort(byCreated).map((c) => line(c, "  ")),
    "",
  ]);
  return ["## Comments", "", ...body].join("\n").replace(/\n+$/, "") + "\n";
}
