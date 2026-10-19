import { describe, expect, it } from "vitest";
import { expandTemplateVars, formatDate, parseDate } from "./dates";

const d = new Date(2024, 0, 5, 14, 7, 9);

describe("date formatting", () => {
  it("formats common tokens and literals", () => {
    expect(formatDate(d, "YYYY-MM-DD")).toBe("2024-01-05");
    expect(formatDate(d, "dddd, MMMM D YYYY [at] h:mm A")).toBe("Friday, January 5 2024 at 2:07 PM");
    expect(formatDate(d, "YY/M/D HH:mm:ss ddd MMM")).toBe("24/1/5 14:07:09 Fri Jan");
  });

  it("parses formatted names back to dates and rejects others", () => {
    expect(parseDate("2024-01-05", "YYYY-MM-DD")?.getTime()).toBe(new Date(2024, 0, 5).getTime());
    expect(parseDate("Friday, January 5 2024", "dddd, MMMM D YYYY")?.getDate()).toBe(5);
    expect(parseDate("2024-02-30", "YYYY-MM-DD")).toBeNull();
    expect(parseDate("notes", "YYYY-MM-DD")).toBeNull();
  });

  it("expands template variables", () => {
    expect(expandTemplateVars("# {{title}} {{date}} {{time}} {{date:dddd}} {{ time:HH }}", "N", d)).toBe("# N 2024-01-05 14:07 Friday 14");
  });
});
