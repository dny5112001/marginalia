/**
 * Small date formatter/parser for the common moment.js-style tokens used in note
 * names and templates: YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm ss A a,
 * with [bracketed] literals.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TOKEN_RE = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|ss|A|a/g;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function formatDate(d: Date, format: string): string {
  return format.replace(TOKEN_RE, (tok, literal) => {
    if (literal !== undefined) return literal;
    const h12 = d.getHours() % 12 || 12;
    switch (tok) {
      case "YYYY":
        return String(d.getFullYear());
      case "YY":
        return pad(d.getFullYear() % 100);
      case "MMMM":
        return MONTHS[d.getMonth()];
      case "MMM":
        return MONTHS[d.getMonth()].slice(0, 3);
      case "MM":
        return pad(d.getMonth() + 1);
      case "M":
        return String(d.getMonth() + 1);
      case "DD":
        return pad(d.getDate());
      case "D":
        return String(d.getDate());
      case "dddd":
        return DAYS[d.getDay()];
      case "ddd":
        return DAYS[d.getDay()].slice(0, 3);
      case "HH":
        return pad(d.getHours());
      case "H":
        return String(d.getHours());
      case "hh":
        return pad(h12);
      case "h":
        return String(h12);
      case "mm":
        return pad(d.getMinutes());
      case "ss":
        return pad(d.getSeconds());
      case "A":
        return d.getHours() < 12 ? "AM" : "PM";
      case "a":
        return d.getHours() < 12 ? "am" : "pm";
    }
    return tok;
  });
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse a string produced by `formatDate(…, format)` back into a local date (date part only). */
export function parseDate(text: string, format: string): Date | null {
  const fields: string[] = [];
  let re = "^";
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(format))) {
    re += escapeRe(format.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) {
      re += escapeRe(m[1]);
      continue;
    }
    const tok = m[0];
    fields.push(tok);
    re +=
      tok === "YYYY" ? "(\\d{4})" :
      tok === "MMMM" ? `(${MONTHS.join("|")})` :
      tok === "MMM" ? `(${MONTHS.map((x) => x.slice(0, 3)).join("|")})` :
      tok === "dddd" ? `(${DAYS.join("|")})` :
      tok === "ddd" ? `(${DAYS.map((x) => x.slice(0, 3)).join("|")})` :
      tok === "A" || tok === "a" ? "([AaPp][Mm])" :
      "(\\d{1,2})";
  }
  re += escapeRe(format.slice(last)) + "$";
  const match = new RegExp(re).exec(text);
  if (!match) return null;
  let y = NaN;
  let mo = 0;
  let day = 1;
  fields.forEach((tok, i) => {
    const v = match[i + 1];
    if (tok === "YYYY") y = Number(v);
    else if (tok === "YY") y = 2000 + Number(v);
    else if (tok === "MM" || tok === "M") mo = Number(v) - 1;
    else if (tok === "MMMM") mo = MONTHS.indexOf(v);
    else if (tok === "MMM") mo = MONTHS.findIndex((x) => x.startsWith(v));
    else if (tok === "DD" || tok === "D") day = Number(v);
  });
  if (Number.isNaN(y)) return null;
  const d = new Date(y, mo, day);
  return d.getFullYear() === y && d.getMonth() === mo && d.getDate() === day ? d : null;
}

/** Expand {{title}}, {{date}}, {{time}}, {{date:FORMAT}}, {{time:FORMAT}} in a template. */
export function expandTemplateVars(template: string, title: string, now = new Date()): string {
  return template.replace(/\{\{\s*(title|date|time)(?::([^}]*))?\s*\}\}/g, (_m, key: string, fmt?: string) => {
    if (key === "title") return title;
    const f = fmt?.trim() || (key === "date" ? "YYYY-MM-DD" : "HH:mm");
    return formatDate(now, f);
  });
}
