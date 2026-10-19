import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";
import { splitWikiTarget } from "../links/parse";

/* Minimal unist shapes, to avoid depending on transitive type packages. */
interface UNode {
  type: string;
  value?: string;
  url?: string;
  children?: UNode[];
  data?: { hProperties?: Record<string, unknown>; hName?: string };
  properties?: Record<string, unknown>;
  tagName?: string;
}

const INLINE_RE = /(!?)\[\[([^[\]\n]+?)\]\]|(^|[\s(,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

/** remark plugin: turn `[[wikilinks]]`, `![[embeds]]` and `#tags` in text into link/image nodes. */
function remarkWikilinks() {
  return (tree: UNode) => {
    const walk = (node: UNode) => {
      if (!node.children) return;
      if (node.type === "link" || node.type === "linkReference" || node.type === "code" || node.type === "inlineCode") return;
      const out: UNode[] = [];
      for (const child of node.children) {
        if (child.type !== "text" || !child.value) {
          walk(child);
          out.push(child);
          continue;
        }
        const text = child.value;
        let last = 0;
        INLINE_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = INLINE_RE.exec(text))) {
          if (m[2] !== undefined) {
            if (m.index > last) out.push({ type: "text", value: text.slice(last, m.index) });
            const { target, heading, alias } = splitWikiTarget(m[2]);
            const display = alias ?? (heading && !target ? heading : heading ? `${target} › ${heading}` : target);
            const href = `wikilink:${encodeURIComponent(target)}${heading ? "#" + encodeURIComponent(heading) : ""}`;
            if (m[1] === "!" && /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(target)) {
              out.push({ type: "image", url: href, data: { hProperties: { alt: alias ?? target, className: ["embed"] } } } as UNode);
            } else {
              out.push({
                type: "link",
                url: href,
                data: { hProperties: { className: ["wikilink"], dataTarget: target } },
                children: [{ type: "text", value: display }],
              });
            }
            last = m.index + m[0].length;
          } else if (m[4] !== undefined) {
            const start = m.index + m[3].length;
            if (start > last) out.push({ type: "text", value: text.slice(last, start) });
            out.push({
              type: "link",
              url: `tag:${encodeURIComponent(m[4])}`,
              data: { hProperties: { className: ["tag"] } },
              children: [{ type: "text", value: "#" + m[4] }],
            });
            last = m.index + m[0].length;
          }
        }
        if (last === 0) out.push(child);
        else if (last < text.length) out.push({ type: "text", value: text.slice(last) });
      }
      node.children = out;
    };
    walk(tree);
  };
}

/** rehype plugin (runs after sanitize): move vault image sources to `data-src` so they load via IPC. */
function rehypeVaultImages() {
  return (tree: UNode) => {
    const walk = (node: UNode) => {
      if (node.tagName === "img" && node.properties) {
        const src = String(node.properties.src ?? "");
        if (src && !/^(https?:|data:)/i.test(src)) {
          node.properties.dataSrc = src;
          delete node.properties.src;
        }
      }
      if (node.tagName === "a" && node.properties) {
        const href = String(node.properties.href ?? "");
        if (/^https?:/i.test(href)) node.properties.rel = "noopener noreferrer";
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

const schema: SanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "wikilink", "tag"],
    src: [...(defaultSchema.protocols?.src ?? []), "wikilink"],
  },
  attributes: {
    ...defaultSchema.attributes,
    // Replace (not append to) the default className rule for links, which would otherwise win.
    a: [
      ...(defaultSchema.attributes?.a ?? []).filter((d) => !(Array.isArray(d) && d[0] === "className")),
      ["className", "wikilink", "tag", "unresolved", "data-footnote-backref"],
      "dataTarget",
    ],
    img: [...(defaultSchema.attributes?.img ?? []), ["className", "embed"]],
    code: [...(defaultSchema.attributes?.code ?? []), ["className", /^language-./]],
  },
  // Keep heading ids predictable without the default `user-content-` clobber prefix on links we generate.
  clobberPrefix: "md-",
};

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml", "toml"])
  .use(remarkGfm)
  .use(remarkWikilinks)
  // Raw HTML in notes is never passed through (allowDangerousHtml is off).
  .use(remarkRehype)
  .use(rehypeSanitize, schema)
  .use(rehypeHighlight, { detect: false, ignoreMissing: true } as never)
  .use(rehypeVaultImages)
  .use(rehypeStringify);

export function renderMarkdown(source: string): string {
  try {
    return String(processor.processSync(source));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `<p class="render-error">Could not render preview: ${msg.replace(/[<>&]/g, "")}</p>`;
  }
}
