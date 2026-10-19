import type { MarkdownConfig } from "@lezer/markdown";
import { tags as t } from "@lezer/highlight";

/**
 * Lezer Markdown extension: treat a YAML block fenced by `---` at the very
 * start of the document as frontmatter instead of a setext heading.
 */
export const frontmatter: MarkdownConfig = {
  defineNodes: [{ name: "Frontmatter", block: true, style: t.meta }],
  parseBlock: [
    {
      name: "Frontmatter",
      before: "HorizontalRule",
      parse(cx, line) {
        if (cx.lineStart !== 0 || !/^---\s*$/.test(line.text)) return false;
        // Only commit if a closing fence exists, so a lone `---` stays a rule.
        // `input` is internal in the type definitions but present at runtime.
        const input = (cx as unknown as { input: { length: number; read(from: number, to: number): string } }).input;
        const head = input.read(0, Math.min(input.length, 200_000));
        if (!/^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.test(head)) return false;
        const start = cx.lineStart;
        while (cx.nextLine()) {
          if (/^(---|\.\.\.)\s*$/.test(line.text)) {
            const end = cx.lineStart + line.text.length;
            cx.nextLine();
            cx.addElement(cx.elt("Frontmatter", start, end));
            return true;
          }
        }
        return false;
      },
    },
  ],
};
