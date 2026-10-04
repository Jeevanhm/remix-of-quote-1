import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac, timingSafeEqual } from "node:crypto";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const databasePath = resolve(
  process.env.CATALOG_DB_PATH || resolve(projectRoot, "data", "catalog.sqlite"),
);
const staticRoot = resolve(projectRoot, "dist");
const port = Number.parseInt(process.env.PORT || "3001", 10);
const host = process.env.HOST || "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

mkdirSync(resolve(databasePath, ".."), { recursive: true });
const quotesDir = resolve(process.env.QUOTES_DIR || resolve(projectRoot, "data", "quotes"));
const maxPdfBytes = 20 * 1024 * 1024;
mkdirSync(quotesDir, { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS catalog_items (
    item TEXT PRIMARY KEY COLLATE NOCASE,
    unit_price REAL NOT NULL CHECK (unit_price >= 0),
    category TEXT NOT NULL CHECK (length(trim(category)) > 0)
  );
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS quote_files (
    number TEXT PRIMARY KEY,
    file_name TEXT NOT NULL
  );
`);

const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function sanitizeFileBase(value) {
  let name = (value || "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9 _-]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/_+/g, "_")
    .trim()
    .slice(0, 80)
    .trim();
  if (!name || /^[_ -]+$/.test(name)) name = "Quote";
  if (reservedNames.test(name)) name = `${name}_`;
  return name;
}

const selectItems = database.prepare(
  "SELECT item, unit_price AS unitPrice, category FROM catalog_items ORDER BY item COLLATE NOCASE",
);
const getMetadata = database.prepare("SELECT value FROM app_meta WHERE key = ?");
const insertItem = database.prepare(
  "INSERT INTO catalog_items (item, unit_price, category) VALUES (?, ?, ?)",
);

const adminPassword = process.env.ADMIN_PASSWORD || "";
const sessionHours = Number.parseFloat(process.env.ADMIN_SESSION_HOURS || "8") || 8;
const signingKey = createHmac("sha256", "quote-admin-session").update(adminPassword).digest();
const failedLogins = new Map();

if (!adminPassword) {
  console.warn("ADMIN_PASSWORD is not set: catalog changes are disabled for everyone.");
}

function safeEqual(a, b) {
  const left = createHmac("sha256", signingKey).update(a).digest();
  const right = createHmac("sha256", signingKey).update(b).digest();
  return timingSafeEqual(left, right);
}

function signToken(expiresAt) {
  const payload = Buffer.from(String(expiresAt)).toString("base64url");
  const signature = createHmac("sha256", signingKey).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function isAdmin(request) {
  if (!adminPassword) return false;
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = createHmac("sha256", signingKey).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) return false;
  const expiresAt = Number.parseInt(Buffer.from(payload, "base64url").toString(), 10);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function requireAdmin(request) {
  if (!adminPassword) {
    throw new HttpError(403, "Catalog changes are disabled: ADMIN_PASSWORD is not configured on the server.");
  }
  if (!isAdmin(request)) {
    throw new HttpError(401, "Admin login required.");
  }
}

function checkLoginRateLimit(address) {
  const entry = failedLogins.get(address);
  if (entry && entry.count >= 5 && Date.now() - entry.last < 60_000) {
    throw new HttpError(429, "Too many failed attempts. Try again in a minute.");
  }
}

function recordLoginResult(address, success) {
  if (success) {
    failedLogins.delete(address);
    return;
  }
  const entry = failedLogins.get(address);
  const recent = entry && Date.now() - entry.last < 60_000;
  failedLogins.set(address, { count: recent ? entry.count + 1 : 1, last: Date.now() });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getItems() {
  return selectItems.all();
}

function isInitialized() {
  return Boolean(getMetadata.get("catalog_initialized"));
}

function getQuotationCounter() {
  const row = getMetadata.get("quotation_counter");
  return row ? Number.parseInt(row.value, 10) || 0 : 0;
}

function setQuotationCounter(value) {
  database.prepare(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run("quotation_counter", String(value));
}

function formatQuotationNumber(value) {
  return String(value).padStart(5, "0");
}

// The first issued quotation number; the stored counter never drops below start - 1.
const quotationStart = Number.parseInt(process.env.QUOTATION_START || "84", 10);
if (!Number.isInteger(quotationStart) || quotationStart < 1) {
  throw new Error("QUOTATION_START must be a positive integer.");
}
if (getQuotationCounter() < quotationStart - 1) {
  setQuotationCounter(quotationStart - 1);
}

function validateItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "A catalog item is required.");
  }

  const item = typeof value.item === "string" ? value.item.trim() : "";
  const category = typeof value.category === "string" ? value.category.trim() : "";
  const unitPrice = value.unitPrice;

  if (!item || item.length > 200) {
    throw new HttpError(400, "Item name is required and must be 200 characters or fewer.");
  }
  if (!category || category.length > 100) {
    throw new HttpError(400, "Category is required and must be 100 characters or fewer.");
  }
  if (typeof unitPrice !== "number" || !Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new HttpError(400, "Unit price must be a non-negative number.");
  }

  return { item, unitPrice, category };
}

function validateItems(value) {
  if (!Array.isArray(value) || value.length > 2000) {
    throw new HttpError(400, "Catalog items must be an array containing at most 2000 entries.");
  }
  return value.map(validateItem);
}

function withTransaction(operation) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(request) {
  const body = await readBody(request, 1024 * 1024);

  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function insertItems(items, ignoreDuplicates = false) {
  const statement = ignoreDuplicates
    ? database.prepare(
        "INSERT OR IGNORE INTO catalog_items (item, unit_price, category) VALUES (?, ?, ?)",
      )
    : insertItem;
  for (const item of items) {
    statement.run(item.item, item.unitPrice, item.category);
  }
}

function initializeItems(items) {
  withTransaction(() => {
    if (isInitialized()) return;
    insertItems(items, true);
    database.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?)").run(
      "catalog_initialized",
      "true",
    );
  });
}

function resetItems(items) {
  withTransaction(() => {
    database.exec("DELETE FROM catalog_items");
    insertItems(items, true);
    database.prepare(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run("catalog_initialized", "true");
  });
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function serveStatic(urlPath, response) {
  if (!existsSync(staticRoot)) return false;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch {
    throw new HttpError(400, "Invalid URL path.");
  }

  const requestedPath = resolve(staticRoot, `.${decodedPath}`);
  if (requestedPath !== staticRoot && !requestedPath.startsWith(`${staticRoot}${sep}`)) {
    throw new HttpError(403, "Invalid file path.");
  }

  let filePath = requestedPath;
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = resolve(staticRoot, "index.html");
  }
  if (!existsSync(filePath)) return false;

  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
  });
  response.end(readFileSync(filePath));
  return true;
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const { pathname } = url;

  if (pathname === "/api/catalog" && request.method === "GET") {
    sendJson(response, 200, { items: getItems(), initialized: isInitialized() });
    return;
  }

  if (pathname === "/api/catalog/initialize" && request.method === "POST") {
    const body = await readJsonBody(request);
    initializeItems(validateItems(body?.items));
    sendJson(response, 200, { items: getItems(), initialized: true });
    return;
  }

  if (pathname === "/api/admin/login" && request.method === "POST") {
    if (!adminPassword) {
      throw new HttpError(403, "Admin login is disabled: ADMIN_PASSWORD is not configured on the server.");
    }
    const address = request.socket.remoteAddress || "unknown";
    checkLoginRateLimit(address);
    const body = await readJsonBody(request);
    const password = typeof body?.password === "string" ? body.password : "";
    const ok = safeEqual(password, adminPassword);
    recordLoginResult(address, ok);
    if (!ok) throw new HttpError(401, "Incorrect admin password.");
    sendJson(response, 200, { token: signToken(Date.now() + sessionHours * 3_600_000) });
    return;
  }

  if (pathname === "/api/admin/session" && request.method === "GET") {
    sendJson(response, 200, { admin: isAdmin(request), configured: Boolean(adminPassword) });
    return;
  }

  if (pathname === "/api/catalog" && request.method === "POST") {
    requireAdmin(request);
    const item = validateItem(await readJsonBody(request));
    try {
      insertItem.run(item.item, item.unitPrice, item.category);
    } catch (error) {
      if (error.code === "ERR_SQLITE_ERROR" && /UNIQUE constraint failed/i.test(error.message)) {
        throw new HttpError(409, "An item with this name already exists.");
      }
      throw error;
    }
    sendJson(response, 201, { items: getItems() });
    return;
  }

  if (pathname === "/api/catalog/reset" && request.method === "POST") {
    requireAdmin(request);
    const body = await readJsonBody(request);
    resetItems(validateItems(body?.items));
    sendJson(response, 200, { items: getItems() });
    return;
  }

  if (pathname === "/api/quotation/next" && request.method === "GET") {
    sendJson(response, 200, { number: formatQuotationNumber(getQuotationCounter() + 1) });
    return;
  }

  if (pathname === "/api/quotation/claim" && request.method === "POST") {
    const next = withTransaction(() => {
      const value = getQuotationCounter() + 1;
      setQuotationCounter(value);
      return value;
    });
    sendJson(response, 200, { number: formatQuotationNumber(next), next: formatQuotationNumber(next + 1) });
    return;
  }

  // Lets a browser's previous local counter carry over; the counter never goes backwards.
  if (pathname === "/api/quotation/seed" && request.method === "POST") {
    const body = await readJsonBody(request);
    const seed = body?.value;
    if (!Number.isInteger(seed) || seed < 0 || seed > 99999999) {
      throw new HttpError(400, "Seed value must be a non-negative integer.");
    }
    withTransaction(() => {
      if (seed > getQuotationCounter()) setQuotationCounter(seed);
    });
    sendJson(response, 200, { number: formatQuotationNumber(getQuotationCounter() + 1) });
    return;
  }

  if (pathname === "/api/quotes" && request.method === "GET") {
    requireAdmin(request);
    const files = readdirSync(quotesDir).filter((name) => name.endsWith(".pdf")).sort();
    sendJson(response, 200, { quotes: files });
    return;
  }

  const quoteFileMatch = pathname.match(/^\/api\/quotes\/files\/([^/]+)$/);
  if (quoteFileMatch && request.method === "GET") {
    requireAdmin(request);
    let name;
    try {
      name = decodeURIComponent(quoteFileMatch[1]);
    } catch {
      throw new HttpError(400, "Invalid file name.");
    }
    // Only serve names that exist in the quotes folder listing
    if (!readdirSync(quotesDir).includes(name) || !name.endsWith(".pdf")) {
      throw new HttpError(404, "Quote PDF not found.");
    }
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    });
    response.end(readFileSync(resolve(quotesDir, name)));
    return;
  }

  const quoteMatch = pathname.match(/^\/api\/quotes\/(\d{5,8})$/);
  if (quoteMatch && request.method === "PUT") {
    const number = quoteMatch[1];
    // Only numbers that were actually issued can be stored, once each
    if (Number.parseInt(number, 10) > getQuotationCounter()) {
      throw new HttpError(400, "Unknown quotation number.");
    }
    if (database.prepare("SELECT 1 FROM quote_files WHERE number = ?").get(number)) {
      throw new HttpError(409, "A PDF for this quotation already exists.");
    }
    const body = await readBody(request, maxPdfBytes);
    if (body.length < 5 || body.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new HttpError(400, "Request body must be a PDF file.");
    }

    const base = sanitizeFileBase(url.searchParams.get("application"));
    let fileName = "";
    for (let copy = 1; copy < 10000; copy++) {
      const candidate = copy === 1 ? `${base}.pdf` : `${base}_${copy}.pdf`;
      try {
        writeFileSync(resolve(quotesDir, candidate), body, { flag: "wx" });
        fileName = candidate;
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
    if (!fileName) throw new HttpError(409, "Too many saved quotes with this application name.");
    database.prepare("INSERT INTO quote_files (number, file_name) VALUES (?, ?)").run(number, fileName);
    sendJson(response, 201, { saved: fileName });
    return;
  }

  const itemMatch = pathname.match(/^\/api\/catalog\/([^/]+)$/);
  if (itemMatch) {
    let itemName;
    try {
      itemName = decodeURIComponent(itemMatch[1]);
    } catch {
      throw new HttpError(400, "Invalid catalog item name.");
    }

    if (request.method === "PUT") {
      requireAdmin(request);
      const item = validateItem(await readJsonBody(request));
      const result = database
        .prepare("UPDATE catalog_items SET item = ?, unit_price = ?, category = ? WHERE item = ?")
        .run(item.item, item.unitPrice, item.category, itemName);
      if (result.changes === 0) throw new HttpError(404, "Catalog item not found.");
      sendJson(response, 200, { items: getItems() });
      return;
    }

    if (request.method === "DELETE") {
      requireAdmin(request);
      const result = database.prepare("DELETE FROM catalog_items WHERE item = ?").run(itemName);
      if (result.changes === 0) throw new HttpError(404, "Catalog item not found.");
      sendJson(response, 200, { items: getItems() });
      return;
    }
  }

  if (request.method === "GET" && serveStatic(pathname, response)) return;
  throw new HttpError(404, "Not found.");
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    if (!(error instanceof HttpError)) {
      console.error("Catalog server error:", error);
    }
    sendJson(
      response,
      error instanceof HttpError ? error.status : 500,
      { error: error instanceof HttpError ? error.message : "Internal server error." },
    );
  });
});

server.listen(port, host, () => {
  console.log(`Quote catalog server listening at http://${host}:${port}`);
  console.log(`SQLite database: ${databasePath}`);
});

function closeServer() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", closeServer);
process.on("SIGTERM", closeServer);
