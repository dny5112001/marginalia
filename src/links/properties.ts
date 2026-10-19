import { parseDocument, isMap } from "yaml";
import { extractFrontmatter } from "./parse";

/**
 * Frontmatter editing that preserves comments, key order and the note body.
 * All functions are pure: content in, content out.
 */

export type PropertyValue = string | number | boolean | string[] | null;

export function propertyType(v: unknown): "list" | "checkbox" | "number" | "date" | "text" {
  if (Array.isArray(v)) return "list";
  if (typeof v === "boolean") return "checkbox";
  if (typeof v === "number") return "number";
  if (v instanceof Date || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(v))) return "date";
  return "text";
}

function splitDoc(content: string) {
  const fm = extractFrontmatter(content);
  const yamlText = fm ? fm.raw : "";
  const body = fm ? content.slice(fm.end) : content;
  return { fm, yamlText, body };
}

function join(yamlText: string, body: string) {
  const y = yamlText.replace(/\n+$/, "");
  if (!y.trim()) return body.replace(/^\n/, "");
  return `---\n${y}\n---\n${body}`;
}

function edit(content: string, fn: (doc: ReturnType<typeof parseDocument>) => void): string {
  const { fm, yamlText, body } = splitDoc(content);
  if (fm?.error) throw new Error(`Frontmatter is not valid YAML: ${fm.error}`);
  const doc = parseDocument(yamlText);
  if (doc.contents == null) doc.contents = doc.createNode({}) as never;
  if (!isMap(doc.contents)) throw new Error("Frontmatter must be a key/value mapping.");
  fn(doc);
  const out = doc.contents && isMap(doc.contents) && doc.contents.items.length === 0 ? "" : doc.toString({ lineWidth: 0 });
  // Keep an empty line between frontmatter and body only if one was there before.
  return join(out, fm ? body : body.startsWith("\n") || !body ? body : "\n" + body);
}

export function setProperty(content: string, key: string, value: PropertyValue): string {
  const k = key.trim();
  if (!k) throw new Error("Property name cannot be empty.");
  return edit(content, (doc) => doc.set(k, value));
}

export function removeProperty(content: string, key: string): string {
  return edit(content, (doc) => {
    doc.delete(key);
  });
}

export function renameProperty(content: string, from: string, to: string): string {
  const target = to.trim();
  if (!target) throw new Error("Property name cannot be empty.");
  if (from === target) return content;
  return edit(content, (doc) => {
    if (doc.has(target)) throw new Error(`A property named "${target}" already exists.`);
    const map = doc.contents as { items: { key: { value?: unknown } | unknown }[] };
    const pair = map.items.find((p) => {
      const kk = p.key as { value?: unknown } | string;
      return (typeof kk === "object" && kk !== null ? kk.value : kk) === from;
    }) as { key: unknown } | undefined;
    if (!pair) return;
    // Keep the key's position by replacing only its scalar.
    pair.key = doc.createNode(target);
  });
}

/** Parse a user-typed value for a property of the given type. */
export function coerceValue(type: ReturnType<typeof propertyType>, raw: string): PropertyValue {
  if (type === "number") {
    const n = Number(raw);
    return raw.trim() === "" || Number.isNaN(n) ? null : n;
  }
  if (type === "checkbox") return raw === "true";
  if (type === "list") return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return raw;
}
