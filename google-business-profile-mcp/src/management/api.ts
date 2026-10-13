import { GoogleApiError } from "../google-client";
export type Json = Record<string, any>;
export type Request = (url: string, init?: RequestInit) => Promise<Json>;
export const API = {
  info: "https://mybusinessbusinessinformation.googleapis.com/v1",
  accounts: "https://mybusinessaccountmanagement.googleapis.com/v1",
  v4: "https://mybusiness.googleapis.com/v4",
  performance: "https://businessprofileperformance.googleapis.com/v1",
  verification: "https://mybusinessverifications.googleapis.com/v1",
  actions: "https://mybusinessplaceactions.googleapis.com/v1",
  notifications: "https://mybusinessnotifications.googleapis.com/v1",
};
export const resource = (s: string, p: string) =>
  s.startsWith(p + "/") ? s : p + "/" + s;
export function endpoint(base: string, path: string, query: Json = {}) {
  const u = new URL(base + "/" + path);
  for (const [k, v] of Object.entries(query))
    if (v !== undefined)
      for (const x of Array.isArray(v) ? v : [v])
        u.searchParams.append(k, String(x));
  return u.href;
}
export const invalid = (message: string) =>
  new GoogleApiError(message, 400, "invalid_request");
export async function pages(
  request: Request,
  url: string,
  field: string,
  maxPages = 20,
) {
  const items: Json[] = [];
  let token: string | undefined;
  let first: Json = {};
  const seen = new Set<string>();
  for (let i = 0; i < maxPages; i++) {
    const u = new URL(url);
    if (token) u.searchParams.set("pageToken", token);
    const r = await request(u.href);
    if (i === 0) first = r;
    items.push(...(r[field] || []));
    token = r.nextPageToken;
    if (!token) break;
    if (seen.has(token)) throw invalid("Google repeated a pagination token.");
    seen.add(token);
  }
  return {
    items,
    complete: !token,
    nextPageToken: token,
    total: first.totalReviewCount ?? first.totalMediaItemCount,
    averageRating: first.averageRating,
  };
}
export function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .filter((k) => (value as Json)[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + canonical((value as Json)[k]))
      .join(",") +
    "}"
  );
}
export async function digest(value: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(value)),
      ),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export function errorData(e: unknown) {
  return e instanceof GoogleApiError
    ? {
        available: false,
        status: e.status,
        category: e.category,
        message: e.message,
        reason: e.reason,
        google: e.google,
      }
    : { available: false, status: 500, category: "internal_error" };
}
export async function check(fn: () => Promise<unknown>) {
  try {
    return { available: true, data: await fn() };
  } catch (e) {
    return errorData(e);
  }
}
export const profile = (
  request: Request,
  location: string,
  mask = "name,title,websiteUri,phoneNumbers,categories,regularHours,specialHours,serviceArea,metadata,profile,openInfo,labels,moreHours,serviceItems,storefrontAddress",
) =>
  request(
    endpoint(API.info, resource(location, "locations"), { readMask: mask }),
  );
