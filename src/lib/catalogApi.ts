import type { PriceItem } from "@/data/priceSheet";

interface CatalogResponse {
  items: PriceItem[];
  initialized: boolean;
}

function isPriceItem(value: unknown): value is PriceItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.item === "string" &&
    typeof item.category === "string" &&
    typeof item.unitPrice === "number"
  );
}

function isCatalogResponse(value: unknown): value is CatalogResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return (
    Array.isArray(response.items) &&
    response.items.every(isPriceItem) &&
    typeof response.initialized === "boolean"
  );
}

function getErrorMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" ? error : undefined;
}

const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");

async function request(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getAdminToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result: unknown = await response.json();

  if (!response.ok) {
    if (response.status === 401) clearAdminToken();
    throw new Error(getErrorMessage(result) || `Catalog request failed (${response.status}).`);
  }

  return result;
}

const ADMIN_TOKEN_KEY = "adminToken";

function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

function clearAdminToken() {
  try {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch (error) {
    console.warn("Could not clear the admin session.", error);
  }
}

export async function adminLogin(password: string): Promise<void> {
  const result = await request("/api/admin/login", "POST", { password });
  const token = result && typeof result === "object" ? (result as Record<string, unknown>).token : undefined;
  if (typeof token !== "string") throw new Error("The server returned an invalid login response.");
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function adminLogout() {
  clearAdminToken();
}

export async function checkAdminSession(): Promise<boolean> {
  if (!getAdminToken()) return false;
  const result = await request("/api/admin/session");
  const admin = result && typeof result === "object" ? (result as Record<string, unknown>).admin : false;
  if (admin !== true) clearAdminToken();
  return admin === true;
}

function readItemsResponse(value: unknown): PriceItem[] {
  if (!value || typeof value !== "object") {
    throw new Error("The catalog server returned an invalid response.");
  }
  const items = (value as Record<string, unknown>).items;
  if (!Array.isArray(items) || !items.every(isPriceItem)) {
    throw new Error("The catalog server returned invalid catalog items.");
  }
  return items;
}

export async function fetchCatalog(): Promise<CatalogResponse> {
  const result = await request("/api/catalog");
  if (!isCatalogResponse(result)) {
    throw new Error("The catalog server returned an invalid response.");
  }
  return result;
}

export async function initializeCatalog(items: PriceItem[]): Promise<void> {
  await request("/api/catalog/initialize", "POST", { items });
}

export async function createCatalogItem(item: PriceItem): Promise<PriceItem[]> {
  return readItemsResponse(await request("/api/catalog", "POST", item));
}

export async function updateCatalogItem(
  originalName: string,
  item: PriceItem,
): Promise<PriceItem[]> {
  return readItemsResponse(
    await request(`/api/catalog/${encodeURIComponent(originalName)}`, "PUT", item),
  );
}

export async function removeCatalogItem(itemName: string): Promise<PriceItem[]> {
  return readItemsResponse(
    await request(`/api/catalog/${encodeURIComponent(itemName)}`, "DELETE"),
  );
}

export async function resetCatalog(items: PriceItem[]): Promise<PriceItem[]> {
  return readItemsResponse(await request("/api/catalog/reset", "POST", { items }));
}

function readNumber(value: unknown): string {
  const number = value && typeof value === "object" ? (value as Record<string, unknown>).number : undefined;
  if (typeof number !== "string") {
    throw new Error("The server returned an invalid quotation number.");
  }
  return number;
}

export async function peekQuotationNumber(): Promise<string> {
  return readNumber(await request("/api/quotation/next"));
}

export async function claimQuotationNumber(): Promise<string> {
  return readNumber(await request("/api/quotation/claim", "POST"));
}

export async function seedQuotationCounter(value: number): Promise<string> {
  return readNumber(await request("/api/quotation/seed", "POST", { value }));
}

export async function uploadQuotePdf(
  quotationNumber: string,
  application: string,
  pdf: Blob,
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/pdf" };
  const token = getAdminToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const query = new URLSearchParams({ application });
  const response = await fetch(`${apiBase}/api/quotes/${encodeURIComponent(quotationNumber)}?${query}`, {
    method: "PUT",
    headers,
    body: pdf,
  });
  if (!response.ok) {
    const result: unknown = await response.json().catch(() => undefined);
    throw new Error(getErrorMessage(result) || `PDF upload failed (${response.status}).`);
  }
}
