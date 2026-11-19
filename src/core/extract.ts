// Pulls Marketplace listings out of Facebook's own embedded Relay JSON.
//
// We deliberately avoid the DOM and visible text: Facebook localises every UI
// string (Hebrew here) and reshuffles markup often, but the JSON payload keeps
// stable keys like `marketplace_listing_title` and `listing_price`. Reading it
// makes extraction locale-independent and immune to related-listing rails
// polluting the detail view (we select the focal object by id).

import type { Listing, ListingDetail } from "./types.js";
import { conditionFromRaw, parseVehicle, summarizeVehicle, vehicleAttributes } from "./vehicle.js";

type Json = unknown;
type Obj = Record<string, any>;

const SCRIPT_JSON_RE = /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;

const SYMBOL_CURRENCY: Array<[RegExp, string]> = [
  [/₪|\bILS\b|ש"ח|ש״ח/, "ILS"],
  [/€|\bEUR\b/, "EUR"],
  [/£|\bGBP\b/, "GBP"],
  // Before the bare "$" rule, or "A$6,500" is read as USD.
  [/A\$|AU\$|\bAUD\b/, "AUD"],
  [/\bUSD\b|US\$|\$/, "USD"],
];

export function parseJsonBlocks(html: string): Json[] {
  const out: Json[] = [];
  for (const m of html.matchAll(SCRIPT_JSON_RE)) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      // Non-JSON or truncated block: irrelevant for listings.
    }
  }
  return out;
}

/** GraphQL responses arrive as `for (;;);`-prefixed, newline-delimited JSON documents. */
export function parseGraphqlPayload(text: string): Json[] {
  const out: Json[] = [];
  const body = text.replace(/^for\s*\(;;\);/, "");
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // Partial chunk: skip.
    }
  }
  return out;
}

function walk(node: Json, visit: (o: Obj) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) walk(x, visit);
    return;
  }
  visit(node as Obj);
  for (const k in node as Obj) walk((node as Obj)[k], visit);
}

export function currencyFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const [re, code] of SYMBOL_CURRENCY) if (re.test(text)) return code;
  return null;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function priceFrom(p: Obj | null | undefined): { amount: number | null; text: string; currency: string | null } {
  if (!p) return { amount: null, text: "", currency: null };
  const text = String(p.formatted_amount ?? p.formatted_amount_zeros_stripped ?? "");
  let amount = toNumber(p.amount);
  if (amount === null && text) {
    const digits = text.replace(/[^\d.]/g, "");
    amount = toNumber(digits);
  }
  return { amount, text, currency: p.currency ? String(p.currency) : currencyFromText(text) };
}

function isListingObject(o: Obj): boolean {
  return typeof o.marketplace_listing_title === "string" && (typeof o.id === "string" || typeof o.id === "number");
}

/** A Relay fragment of this listing, including a vehicle-only sibling that has no title. */
function isFocalFragment(o: Obj): boolean {
  if ("marketplace_listing_title" in o || "listing_photos" in o || "redacted_description" in o || "attribute_data" in o) return true;
  if ("__isMarketplaceVehicleListing" in o || "custom_sub_titles_with_rendering_flags" in o || "dealership_name" in o) return true;
  if (typeof o.__typename === "string" && /MarketplaceVehicle/i.test(o.__typename)) return true;
  return Object.keys(o).some((k) => k.startsWith("vehicle_"));
}

export function toListing(o: Obj): Listing {
  const price = priceFrom(o.listing_price);
  const prev = priceFrom(o.strikethrough_price);
  const geo = o.location?.reverse_geocode;
  const summary = summarizeVehicle(o);
  return {
    id: String(o.id),
    url: `https://www.facebook.com/marketplace/item/${o.id}/`,
    title: String(o.marketplace_listing_title).replace(/^‏/, "").trim(),
    price: price.amount,
    currency: price.currency,
    priceText: price.text,
    previousPrice: prev.amount,
    city: geo?.city_page?.display_name ?? geo?.city ?? null,
    imageUrl: o.primary_listing_photo?.image?.uri ?? null,
    createdAt: toNumber(o.creation_time),
    isSold: Boolean(o.is_sold),
    isPending: Boolean(o.is_pending),
    sellerName: o.marketplace_listing_seller?.name ?? null,
    sellerId: o.marketplace_listing_seller?.id ?? null,
    deliveryTypes: Array.isArray(o.delivery_types) ? o.delivery_types.map(String) : [],
    categoryId: o.marketplace_listing_category_id ?? null,
    transmission: summary.transmission,
    odometerKm: summary.odometerKm,
    odometerText: summary.odometerText,
  };
}

/** Every distinct listing in the given JSON documents, in first-seen order. */
export function extractListings(docs: Json[]): Listing[] {
  const seen = new Map<string, Listing>();
  for (const doc of docs) {
    walk(doc, (o) => {
      if (!isListingObject(o)) return;
      const id = String(o.id);
      if (!seen.has(id)) seen.set(id, toListing(o));
    });
  }
  return [...seen.values()];
}

/** Merge every fragment describing `id`; a later null never erases an earlier value. */
function mergeFocal(docs: Json[], id: string): Obj {
  const merged: Obj = {};
  for (const doc of docs) {
    walk(doc, (o) => {
      if (o.id === undefined || o.id === null || String(o.id) !== id) return;
      // Vehicle facts often arrive on a second fragment that shares the listing
      // id but has none of the title / photo / description keys.
      if (!isFocalFragment(o)) return;
      for (const [k, v] of Object.entries(o)) {
        if (v !== null && v !== undefined && merged[k] === undefined) merged[k] = v;
      }
    });
  }
  return merged;
}

export function extractDetail(docs: Json[], id: string): ListingDetail | null {
  const o = mergeFocal(docs, id);
  if (!o.marketplace_listing_title) return null;
  const description = String(o.redacted_description?.text ?? "");
  const vehicle = parseVehicle(o, description);
  const base = toListing({ ...o, id });
  if (vehicle?.transmission) base.transmission = vehicle.transmission;
  if (vehicle?.odometerKm != null) {
    base.odometerKm = vehicle.odometerKm;
    base.odometerText = vehicle.odometerText;
  }
  const attrs: ListingDetail["attributes"] = Array.isArray(o.attribute_data)
    ? o.attribute_data.map((a: Obj) => ({
        name: String(a.attribute_name ?? "").replace(/[‎‏]/g, ""),
        value: String(a.value ?? ""),
        label: String(a.label ?? ""),
      }))
    : [];
  if (vehicle) {
    const seen = new Set(attrs.map((a) => `${a.name}\0${a.label}`));
    for (const a of vehicleAttributes(vehicle)) {
      const key = `${a.name}\0${a.label}`;
      if (seen.has(key)) continue;
      if (a.name !== "about" && attrs.some((x) => x.name === a.name)) continue;
      attrs.push(a);
      seen.add(key);
    }
  }
  const fromAttrs = attrs.find((a) => a.name !== "about" && /^(new|used|refurbished)/i.test(a.value));
  const cond =
    fromAttrs ??
    conditionFromRaw(o.vehicle_condition) ??
    conditionFromRaw(o.condition);
  const coords = o.location?.latitude !== undefined ? o.location : o.item_location;
  const photos: string[] = Array.isArray(o.listing_photos)
    ? o.listing_photos.map((p: Obj) => p?.image?.uri).filter(Boolean)
    : [];
  return {
    ...base,
    city: base.city ?? null,
    description,
    condition: cond?.value ?? null,
    conditionLabel: cond?.label ?? null,
    attributes: attrs,
    latitude: toNumber(coords?.latitude),
    longitude: toNumber(coords?.longitude),
    locationText: o.location_text?.text ?? null,
    photos,
    shippingOffered: Boolean(o.is_shipping_offered),
    status: o.renderable_listing_status ?? null,
    vehicle,
  };
}
