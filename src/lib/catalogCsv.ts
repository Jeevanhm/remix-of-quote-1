import type { PriceItem } from "@/data/priceSheet";

const HEADER = ["item", "unitPrice", "category"];

function escapeCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function catalogToCsv(items: PriceItem[]): string {
  const rows = items.map((i) => [escapeCell(i.item), String(i.unitPrice), escapeCell(i.category)].join(","));
  return [HEADER.join(","), ...rows].join("\r\n") + "\r\n";
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function parseCatalogCsv(text: string): PriceItem[] {
  const rows = parseRows(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("The file has no catalog rows.");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const [iItem, iPrice, iCat] = HEADER.map(col);
  if (iItem < 0 || iPrice < 0 || iCat < 0) {
    throw new Error("The header row must be: item,unitPrice,category");
  }
  const seen = new Set<string>();
  return rows.slice(1).map((r, idx) => {
    const line = idx + 2;
    const item = (r[iItem] ?? "").trim();
    const category = (r[iCat] ?? "").trim();
    const unitPrice = Number(r[iPrice]);
    if (!item || !category) throw new Error(`Line ${line}: item and category are required.`);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error(`Line ${line}: invalid unit price.`);
    const key = item.toLowerCase();
    if (seen.has(key)) throw new Error(`Line ${line}: duplicate item "${item}".`);
    seen.add(key);
    return { item, unitPrice, category };
  });
}
