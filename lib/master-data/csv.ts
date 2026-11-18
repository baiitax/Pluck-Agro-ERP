/**
 * CSV parsing and generation for the import centre and for exports.
 *
 * Hand-rolled on purpose: the delimiter handling, quoting and error reporting here are the part
 * that must be auditable, and a two-hundred-line dependency would hide the rules that decide
 * whether a supplier row is accepted. Round-trip behaviour is unit-tested.
 */

export type CsvRow = { rowNumber: number; values: Record<string, string> };

export type CsvParseResult = {
  headers: string[];
  rows: CsvRow[];
  errors: { rowNumber: number; message: string }[];
};

/**
 * Splits a whole CSV document into records, honouring double quotes, doubled quotes and quoted
 * fields that span line breaks. Returns each record with the 1-based line it started on, so an
 * error message can point at the line the user sees in their spreadsheet.
 */
function splitRecords(text: string): { line: number; cells: string[] }[] {
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let current = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let started = false;

  const endCell = () => {
    cells.push(current);
    current = "";
  };
  const endRecord = () => {
    endCell();
    records.push({ line: recordLine, cells });
    cells = [];
    started = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") line += 1;
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      if (!started) {
        started = true;
        recordLine = line;
      }
    } else if (char === ",") {
      if (!started) {
        started = true;
        recordLine = line;
      }
      endCell();
    } else if (char === "\n") {
      if (started || cells.length > 0 || current.length > 0) endRecord();
      line += 1;
      recordLine = line;
    } else {
      if (!started) {
        started = true;
        recordLine = line;
      }
      current += char;
    }
  }

  if (started || current.length > 0 || cells.length > 0) endRecord();
  return records;
}

/**
 * Parses a CSV document into header-keyed rows.
 *
 * Empty trailing lines are ignored, header names are trimmed and lower-cased so templates are
 * forgiving about casing, and a row with the wrong number of cells is reported instead of being
 * silently padded — a misaligned row is how import disasters start.
 */
export function parseCsv(text: string): CsvParseResult {
  const normalised = text.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  const records = splitRecords(normalised);

  if (records.length === 0) {
    return { headers: [], rows: [], errors: [{ rowNumber: 0, message: "The file is empty." }] };
  }

  const [headerRecord, ...dataRecords] = records;
  const headers = (headerRecord?.cells ?? []).map((header) => header.trim().toLowerCase());
  const rows: CsvRow[] = [];
  const errors: { rowNumber: number; message: string }[] = [];

  const seen = new Set<string>();
  for (const header of headers) {
    if (seen.has(header)) {
      errors.push({ rowNumber: 0, message: `Duplicate column "${header}" in the header row.` });
    }
    seen.add(header);
  }

  for (const record of dataRecords) {
    // A record of entirely empty cells is a blank line, not a rejected row.
    if (record.cells.every((cell) => cell.trim() === "")) continue;

    if (record.cells.length !== headers.length) {
      errors.push({
        rowNumber: record.line,
        message: `Row has ${record.cells.length} column(s) but the header declares ${headers.length}.`,
      });
      continue;
    }

    const values: Record<string, string> = {};
    headers.forEach((header, cellIndex) => {
      values[header] = (record.cells[cellIndex] ?? "").trim();
    });
    rows.push({ rowNumber: record.line, values });
  }

  return { headers, rows, errors };
}

/** Escapes a value for CSV output, including the spreadsheet formula-injection guard. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return `${lines.join("\n")}\n`;
}

export const IMPORT_TEMPLATES = {
  supplier: {
    label: "Suppliers",
    columns: [
      "legal_name", "trading_name", "supplier_type", "registration_number", "tax_identification_number",
      "registration_country", "phone", "email", "website", "contact_person", "preferred_currency_code",
      "status",
    ],
    required: ["legal_name"],
    notes: "Leave status blank to create records in draft. Banking details are never accepted by import.",
  },
  customer: {
    label: "Customers",
    columns: [
      "legal_name", "trading_name", "customer_type", "registration_number", "tax_identification_number",
      "registration_country", "contact_name", "contact_email", "contact_phone", "preferred_currency_code",
      "status",
    ],
    required: ["legal_name"],
    notes: "Credit reference data is never accepted by import; it is entered by Finance.",
  },
  product: {
    label: "Products",
    columns: [
      "code", "name", "short_description", "category_code", "product_type", "base_unit_code", "status",
    ],
    required: ["code", "name", "category_code", "base_unit_code"],
    notes: "The category and base unit must already exist. Base units are matched by unit code.",
  },
  unit_of_measure: {
    label: "Units of measure",
    columns: ["code", "name", "symbol", "category", "precision"],
    required: ["code", "name", "category"],
    notes: "Existing unit codes are updated rather than duplicated.",
  },
  payment_term: {
    label: "Payment terms",
    columns: ["code", "name", "payment_days", "payment_type", "description"],
    required: ["code", "name"],
    notes: "Imported terms are created inactive so Finance can review them before use.",
  },
  currency: {
    label: "Currencies",
    columns: ["code", "name", "symbol", "decimal_places"],
    required: ["code", "name"],
    notes: "Codes must be 3-letter ISO 4217. Imported currencies are created inactive.",
  },
} as const;

export type ImportEntity = keyof typeof IMPORT_TEMPLATES;

export function templateCsv(entity: ImportEntity): string {
  const template = IMPORT_TEMPLATES[entity];
  // One empty example row so a user can see the shape without guessing the delimiter.
  const example = template.columns.map(() => "");
  return toCsv([...template.columns], [example]);
}
