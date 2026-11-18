import { describe, expect, it } from "vitest";

import { IMPORT_TEMPLATES, csvCell, parseCsv, templateCsv, toCsv } from "@/lib/master-data/csv";

describe("CSV parsing", () => {
  it("reads headers and rows with a row number that matches the file", () => {
    const result = parseCsv("legal_name,email\nAlpha Ltd,a@example.test\nBeta Ltd,b@example.test\n");
    expect(result.headers).toEqual(["legal_name", "email"]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({ rowNumber: 2, values: { legal_name: "Alpha Ltd", email: "a@example.test" } });
    expect(result.rows[1]?.rowNumber).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  it("honours quoted values containing commas, quotes and newlines", () => {
    const result = parseCsv('legal_name,notes\n"Alpha, Ltd","He said ""hello""\nsecond line"\n');
    expect(result.rows[0]?.values.legal_name).toBe("Alpha, Ltd");
    expect(result.rows[0]?.values.notes).toBe('He said "hello"\nsecond line');
  });

  it("strips a UTF-8 BOM so the first header is not corrupted", () => {
    const result = parseCsv("\uFEFFlegal_name\nAlpha Ltd\n");
    expect(result.headers[0]).toBe("legal_name");
  });

  it("reports a row with the wrong number of columns instead of silently shifting values", () => {
    const result = parseCsv("legal_name,email\nAlpha Ltd\n");
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]?.rowNumber).toBe(2);
    expect(result.errors[0]?.message).toMatch(/declares 2/);
  });

  it("reports duplicate headers rather than keeping one of them", () => {
    const result = parseCsv("legal_name,legal_name\nA,B\n");
    expect(result.errors[0]?.message).toMatch(/duplicate/i);
  });

  it("rejects an empty file and a file with headers only, distinctly", () => {
    expect(parseCsv("").errors[0]?.rowNumber).toBe(0);
    const headersOnly = parseCsv("legal_name,email\n");
    expect(headersOnly.errors).toHaveLength(0);
    expect(headersOnly.rows).toHaveLength(0);
  });
});

describe("CSV output", () => {
  it("escapes delimiter, quotes and newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe("");
  });

  it("neutralises spreadsheet formula injection", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@cmd")).toBe("'@cmd");
  });

  it("round-trips through the parser", () => {
    const csv = toCsv(["legal_name", "notes"], [["Alpha, Ltd", 'line "one"']]);
    const parsed = parseCsv(csv);
    expect(parsed.rows[0]?.values).toEqual({ legal_name: "Alpha, Ltd", notes: 'line "one"' });
  });
});

describe("import templates", () => {
  it("never offers a banking or credit column, because those are entered by authorised staff", () => {
    const columns = Object.values(IMPORT_TEMPLATES).flatMap((template) => [...template.columns]);
    for (const forbidden of ["account_number", "bank_name", "credit_limit", "credit_status"]) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it("declares every required column as an actual column", () => {
    for (const template of Object.values(IMPORT_TEMPLATES)) {
      for (const required of template.required) {
        expect([...template.columns]).toContain(required);
      }
    }
  });

  it("emits a template whose headers match the declared columns", () => {
    for (const entity of Object.keys(IMPORT_TEMPLATES) as (keyof typeof IMPORT_TEMPLATES)[]) {
      const csv = templateCsv(entity);
      const parsed = parseCsv(csv);
      expect(parsed.headers).toEqual([...IMPORT_TEMPLATES[entity].columns]);
      // The example row is deliberately blank, and a fully blank row is ignored rather than staged
      // as a rejected row of empty values.
      expect(parsed.rows).toHaveLength(0);
      expect(parsed.errors).toHaveLength(0);
    }
  });
});
