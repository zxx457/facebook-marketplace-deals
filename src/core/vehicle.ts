// "About this vehicle" is not attribute_data.
//
// Goods listings carry condition and colour in `attribute_data`. Vehicle
// listings leave that array empty and put the same facts on the Relay object
// as `vehicle_*` fields (odometer, transmission, fuel, colours, owners, title
// status, seller type). Search cards often skip those fields and instead send
// a short subtitle such as "Manual · 208K km". The rendered English lines
// ("Driven 208,000 km") are produced from those values, so we read the JSON
// and only fall back to free text when the structured fields are absent.

import type { VehicleDetails } from "./types.js";

type Obj = Record<string, unknown>;

export interface VehicleSummary {
  transmission: string | null;
  odometerKm: number | null;
  odometerText: string | null;
}

const KM_PER_MILE = 1.609344;
const MAX_KM = 2_000_000;
/** Readings sellers type because Marketplace requires an odometer. */
const PLACEHOLDER_KM = new Set([1, 11, 111, 123, 1234, 12345, 1111, 11111, 111111, 123456, 99999, 999999]);

const CONDITION_TABLE: Record<string, { value: string; label: string }> = {
  new: { value: "new", label: "New" },
  used_like_new: { value: "used_like_new", label: "Used - like new" },
  like_new: { value: "used_like_new", label: "Used - like new" },
  excellent: { value: "used_like_new", label: "Excellent" },
  refurbished: { value: "refurbished", label: "Refurbished" },
  used_good: { value: "used_good", label: "Used - good" },
  very_good: { value: "used_good", label: "Very good" },
  good: { value: "used_good", label: "Good" },
  used: { value: "used", label: "Used" },
  used_fair: { value: "used_fair", label: "Used - fair" },
  fair: { value: "used_fair", label: "Fair" },
  poor: { value: "poor", label: "Poor" },
};

const OWNERS: Record<string, string> = {
  ONE: "1",
  TWO: "2",
  THREE: "3",
  FOUR: "4",
  FIVE: "5",
  THREE_OR_MORE: "3+",
  FOUR_OR_MORE: "4+",
  FIVE_OR_MORE: "5+",
};

const CONSUMED = new Set([
  "vehicle_odometer_data",
  "vehicle_transmission_type",
  "vehicle_transmission",
  "vehicle_fuel_type",
  "vehicle_exterior_color",
  "vehicle_interior_color",
  "vehicle_make_display_name",
  "vehicle_model_display_name",
  "vehicle_trim_display_name",
  "vehicle_year",
  "vehicle_seller_type",
  "vehicle_title_status",
  "vehicle_is_paid_off",
  "vehicle_number_of_owners",
  "vehicle_condition",
  "vehicle_body_style",
  "vehicle_body_type",
  "vehicle_features",
  "vehicle_specifications",
  "vehicle_identification_number",
  "vehicle_vin",
]);

export function conditionFromRaw(raw: unknown): { value: string; label: string } | null {
  const text = scalar(raw);
  if (!text) return null;
  const key = text.toLowerCase().replace(/[\s-]+/g, "_");
  return CONDITION_TABLE[key] ?? null;
}

export function conditionLabel(value: string | null): string | null {
  if (!value) return null;
  return CONDITION_TABLE[value]?.label ?? pretty(value);
}

/** Transmission and odometer for a search card. Does not read the description. */
export function summarizeVehicle(source: Obj): VehicleSummary {
  const v = parseVehicle(source, "");
  return {
    transmission: v?.transmission ?? null,
    odometerKm: v?.odometerKm ?? null,
    odometerText: v?.odometerText ?? null,
  };
}

export function parseVehicle(source: Obj, description = ""): VehicleDetails | null {
  const specs = specBag(source.vehicle_specifications);
  const subtitles = readSubtitles(source);
  const structured = hasStructuredSignal(source);

  let transmission = normalizeTransmission(scalar(source.vehicle_transmission_type) ?? scalar(source.vehicle_transmission) ?? specPick(specs, /transmi|gearbox/));
  let odometer = readOdometer(source.vehicle_odometer_data) ?? readOdometer(specPick(specs, /odometer|mileage/));
  let fuel = normalizeFuel(scalar(source.vehicle_fuel_type) ?? specPick(specs, /fuel/));
  let exteriorColor = colorFrom(source.vehicle_exterior_color ?? specPick(specs, /exterior/));
  let interiorColor = colorFrom(source.vehicle_interior_color ?? specPick(specs, /interior/));
  let owners = readOwners(source.vehicle_number_of_owners);
  let titleStatus = normalizeTitle(scalar(source.vehicle_title_status));
  let paidOff = readPaidOff(source.vehicle_is_paid_off);
  const make = nameFrom(source.vehicle_make_display_name);
  const model = nameFrom(source.vehicle_model_display_name);
  const trim = nameFrom(source.vehicle_trim_display_name);
  const bodyStyle = readBody(source.vehicle_body_style ?? source.vehicle_body_type);
  const vin = readVin(source.vehicle_identification_number) ?? readVin(source.vehicle_vin);
  const features = readFeatures(source.vehicle_features);
  const seller = readSeller(source);
  const condition = conditionFromRaw(source.vehicle_condition);
  const title = scalar(source.marketplace_listing_title) ?? scalar(source.custom_title) ?? "";

  const subtitleText = subtitles.join("\n");
  if (!transmission) transmission = transmissionFromText(subtitleText);
  if (!odometer) odometer = mileageFromText(subtitleText);

  const prose = description.trim();
  const proseIsVehicle = prose ? isAboutLine(prose) || Boolean(transmissionFromText(prose) || mileageFromText(prose)) : false;
  if (prose && (structured || proseIsVehicle)) {
    if (!transmission) transmission = transmissionFromText(prose);
    if (!odometer) odometer = mileageFromText(prose);
    if (!fuel) fuel = fuelFromText(prose);
    if (!exteriorColor) exteriorColor = labeledColor(prose, "exterior");
    if (!interiorColor) interiorColor = labeledColor(prose, "interior");
    if (!owners) owners = ownersFromText(prose);
    if (!titleStatus) titleStatus = titleFromText(prose);
    if (paidOff == null) paidOff = paidOffFromText(prose);
  }
  const structuredCore = Boolean(
    (structured && (transmission || odometer || fuel || make)) || seller.sellerType || condition || vin,
  );

  const year = readYear(source.vehicle_year, title, Boolean(structured || transmission || odometer || make));
  const rawLines = collectRawLines(source, specs, subtitles, prose, structuredCore);

  const vehicle: VehicleDetails = {
    year,
    make,
    model,
    trim,
    bodyStyle,
    transmission,
    odometerKm: odometer?.km ?? null,
    odometerText: odometer?.text ?? null,
    odometerPlaceholder: odometer?.placeholder ?? false,
    fuel,
    exteriorColor,
    interiorColor,
    owners,
    titleStatus,
    paidOff,
    sellerType: seller.sellerType,
    dealershipName: seller.dealershipName,
    vin,
    condition: condition?.value ?? null,
    features,
    rawLines,
  };
  return hasAnyFact(vehicle) ? vehicle : null;
}

export function vehicleAttributes(v: VehicleDetails): Array<{ name: string; value: string; label: string }> {
  const out: Array<{ name: string; value: string; label: string }> = [];
  const add = (name: string, value: string | number | null, label: string | null) => {
    if (value === null || value === "" || !label) return;
    out.push({ name, value: String(value), label });
  };
  add("year", v.year, v.year ? `Year: ${v.year}` : null);
  add("make", v.make, v.make ? `Make: ${v.make}` : null);
  add("model", v.model, v.model ? `Model: ${v.model}` : null);
  add("trim", v.trim, v.trim ? `Trim: ${v.trim}` : null);
  add("body_style", v.bodyStyle, v.bodyStyle ? `Body: ${v.bodyStyle}` : null);
  add("transmission", v.transmission, transmissionLabel(v.transmission));
  add(
    "odometer",
    v.odometerKm,
    v.odometerText ? `Driven ${v.odometerText}${v.odometerPlaceholder ? " (placeholder)" : ""}` : null,
  );
  add("fuel", v.fuel, v.fuel ? pretty(v.fuel) : null);
  add("exterior_color", v.exteriorColor, v.exteriorColor ? `Exterior color: ${v.exteriorColor}` : null);
  add("interior_color", v.interiorColor, v.interiorColor ? `Interior color: ${v.interiorColor}` : null);
  add("owners", v.owners, v.owners ? ownersLabel(v.owners) : null);
  add("title_status", v.titleStatus, titleLabel(v.titleStatus));
  if (v.paidOff !== null) add("paid_off", v.paidOff ? "true" : "false", v.paidOff ? "Paid off" : "Not paid off");
  add("seller_type", v.sellerType, sellerLabel(v.sellerType));
  add("dealership", v.dealershipName, v.dealershipName ? `Dealership: ${v.dealershipName}` : null);
  add("vin", v.vin, v.vin ? `VIN: ${v.vin}` : null);
  add("condition", v.condition, conditionLabel(v.condition));
  if (v.features.length) add("features", v.features.join(", "), `Features: ${v.features.join(", ")}`);
  for (const line of v.rawLines) add("about", line, line);
  return out;
}

function hasStructuredSignal(o: Obj): boolean {
  if (o.__isMarketplaceVehicleListing) return true;
  if (typeof o.__typename === "string" && /vehicle/i.test(o.__typename)) return true;
  if (scalar(o.dealership_name)) return true;
  return Object.keys(o).some((k) => k.startsWith("vehicle_") && o[k] != null && o[k] !== "");
}

function hasAnyFact(v: VehicleDetails): boolean {
  return Boolean(
    v.year ||
      v.make ||
      v.model ||
      v.trim ||
      v.bodyStyle ||
      v.transmission ||
      v.odometerKm ||
      v.fuel ||
      v.exteriorColor ||
      v.interiorColor ||
      v.owners ||
      v.titleStatus ||
      v.paidOff !== null ||
      v.sellerType ||
      v.dealershipName ||
      v.vin ||
      v.condition ||
      v.features.length ||
      v.rawLines.length,
  );
}

function collectRawLines(source: Obj, specs: Array<[string, string]>, subtitles: string[], prose: string, structuredCore: boolean): string[] {
  const lines: string[] = [];
  if (!structuredCore) {
    for (const line of prose.split(/\n+/)) {
      const t = line.trim();
      if (t && t.length <= 180 && isAboutLine(t)) lines.push(t);
    }
    lines.push(...subtitles.filter((s) => isAboutLine(s) || /\d/.test(s)));
  }
  for (const [key, value] of Object.entries(source)) {
    if (!key.startsWith("vehicle_") || CONSUMED.has(key) || value == null) continue;
    const text = scalar(value);
    if (text && text.length <= 180) lines.push(`${labelize(key)}: ${text}`);
    else if (Array.isArray(value)) {
      for (const item of value) {
        const s = scalar(item);
        if (s && s.length <= 180) lines.push(s);
      }
    }
  }
  const usedSpec = /transmi|gearbox|odometer|mileage|fuel|exterior|interior/;
  for (const [key, value] of specs) {
    if (usedSpec.test(key)) continue;
    if (value.length <= 180) lines.push(`${labelize(key)}: ${value}`);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= 30) break;
  }
  return out;
}

function isAboutLine(line: string): boolean {
  return /transmission|gearbox|\bkm\b|kilomet|miles|\bmi\b|colou?r|owners?|clean title|salvage|paid off|finance owing|petrol|diesel|hybrid|electric|unleaded|lpg/i.test(line);
}

function scalar(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.replace(/[‎‏‪-‮]/g, "").trim();
    return t || null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Obj;
    return scalar(o.display_name ?? o.text ?? o.label ?? o.name ?? o.value);
  }
  return null;
}

function numberish(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const digits = v.replace(/[^\d.]/g, "");
    if (!digits) return null;
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Obj;
    return numberish(o.value ?? o.amount);
  }
  return null;
}

function fmtKm(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function pretty(s: string): string {
  const t = s.trim().replace(/_/g, " ");
  // BMW, VW, HSV: an all-caps token is a name, not a sentence.
  if (/^[A-Z0-9]{2,4}$/.test(t)) return t;
  if (t !== t.toLowerCase() && t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

function labelize(key: string): string {
  return pretty(key.replace(/^vehicle_/, "").replace(/_/g, " "));
}

function nameFrom(v: unknown): string | null {
  const s = scalar(v);
  if (!s || s.length > 60) return null;
  return pretty(s);
}

interface Odometer {
  km: number;
  text: string;
  placeholder: boolean;
}

function readOdometer(raw: unknown): Odometer | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") return mileageFromText(raw);
  if (typeof raw === "number") return odometerFrom(raw, "KILOMETERS", null);
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Obj;
  const unit = String(o.unit ?? o.units ?? "KILOMETERS");
  let value = numberish(o.value ?? o.amount ?? o.odometer);
  const rawValue = scalar(o.value ?? o.amount);
  if (value != null && rawValue && /\dk\b/i.test(rawValue) && value < 10_000) value *= 1000;
  return odometerFrom(value, unit, scalar(o.formatted ?? o.text));
}

function odometerFrom(value: number | null, unit: string, formatted: string | null): Odometer | null {
  if (value == null || value <= 0 || value > MAX_KM) return null;
  const miles = /\bMI\b|MILE/i.test(unit);
  const km = miles ? Math.round(value * KM_PER_MILE) : Math.round(value);
  if (km <= 0 || km > MAX_KM) return null;
  const text = miles ? `${fmtKm(km)} km (${fmtKm(value)} mi)` : formatted && /km/i.test(formatted) ? formatted : `${fmtKm(km)} km`;
  const placeholder = PLACEHOLDER_KM.has(Math.round(value)) || PLACEHOLDER_KM.has(km);
  return { km, text, placeholder };
}

function mileageFromText(text: string): Odometer | null {
  if (!text) return null;
  // The "k" in "208,000 km" must not be read as a thousands suffix.
  const driven = text.match(
    /driven\s+(\d{1,3}(?:[ ,.\u00a0]\d{3})+|\d{4,7}|\d+(?:[.,]\d+)?\s*k)\s*(km|kms|kilomet(?:re|er)s?|miles?|mi)?/i,
  );
  if (driven) {
    const parsed = fromMileageMatch(driven[1], undefined, driven[2]);
    if (parsed) return parsed;
  }
  const compact = text.match(/(\d+(?:[.,]\d+)?)\s*k\s*(km|kms|kilomet(?:re|er)s?|miles?|mi)\b/i);
  if (compact) return fromMileageMatch(compact[1], "k", compact[2]);
  const all = [...text.matchAll(/(\d{1,3}(?:[ ,.\u00a0]\d{3})+|\d{4,7})\s*(km|kms|kilomet(?:re|er)s?|miles?|mi)\b/gi)];
  const short = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.length <= 40);
  for (const line of short) {
    const m = line.match(/(\d{1,3}(?:[ ,.\u00a0]\d{3})+|\d{4,7})\s*(km|kms|kilomet(?:re|er)s?|miles?|mi)\b/i);
    if (m) return fromMileageMatch(m[1], undefined, m[2]);
  }
  if (all.length === 1) return fromMileageMatch(all[0][1], undefined, all[0][2]);
  return null;
}

function fromMileageMatch(rawNumber: string, kFlag: string | undefined, unit: string | undefined): Odometer | null {
  const kilo = Boolean(kFlag) || /\d\s*k\s*$/i.test(rawNumber);
  const body = rawNumber.replace(/k/gi, "").trim();
  const grouped = /[ ,.\u00a0]\d{3}/.test(body);
  const n = grouped ? Number(body.replace(/[^\d]/g, "")) : Number(body.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n)) return null;
  const miles = unit ? /^mi/i.test(unit) : false;
  return odometerFrom(kilo ? n * 1000 : n, miles ? "MILES" : "KILOMETERS", null);
}

function normalizeTransmission(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/[·•|]/g, " ").replace(/\s+/g, " ").trim();
  if (/owner'?s manual|user manual|service manual|manual book/.test(s)) return null;
  // "automatic climate" / "electric windows" are not the gearbox.
  if (/climate|aircon|air con|window|seat|headlight|wiper|mirror|door/.test(s)) return null;
  const lead = s.match(/^(manual|automatic|auto|cvt|stick(?: shift)?)\b/);
  const phrase = s.match(/\b(manual|automatic|auto|cvt|stick(?: shift)?)\s+(transmission|gearbox)\b/);
  const flipped = s.match(/\b(?:transmission|gearbox)\s*[:\-]?\s*(manual|automatic|auto|cvt)\b/);
  const token = (lead?.[1] ?? phrase?.[1] ?? flipped?.[1] ?? "").toLowerCase();
  if (token.startsWith("manual") || token.startsWith("stick")) return "manual";
  if (token === "cvt") return "cvt";
  if (token === "automatic" || token === "auto") return "automatic";
  if (/^[a-z0-9]{2,24}$/.test(s)) {
    if (s === "manual") return "manual";
    if (s === "cvt") return "cvt";
    if (/^(automatic|auto|tiptronic|dsg)$/.test(s)) return "automatic";
  }
  return null;
}

function transmissionFromText(text: string): string | null {
  if (!text) return null;
  for (const line of text.split(/\n+/)) {
    const t = line.trim();
    if (!t || t.length > 48) continue;
    if (/owner'?s manual|user manual|service manual/.test(t)) continue;
    if (!/transmission|gearbox|manual|automatic|\bauto\b|cvt|stick/i.test(t)) continue;
    const n = normalizeTransmission(t);
    if (n) return n;
  }
  const phrase =
    text.match(/\b(manual|automatic|auto|cvt)\s+(transmission|gearbox)\b/i) ||
    text.match(/\b(transmission|gearbox)\s*[:\-]\s*(manual|automatic|cvt|auto)\b/i);
  return phrase ? normalizeTransmission(phrase[0]) : null;
}

function transmissionLabel(value: string | null): string | null {
  if (!value) return null;
  if (value === "manual") return "Manual transmission";
  if (value === "automatic") return "Automatic transmission";
  if (value === "cvt") return "CVT";
  return pretty(value);
}

function normalizeFuel(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/_/g, " ");
  if (/plug|phev/.test(s)) return "plug-in hybrid";
  if (/hybrid/.test(s)) return "hybrid";
  if (/diesel/.test(s)) return "diesel";
  if (/electric|\bbev\b/.test(s)) return "electric";
  if (/\blpg\b|\bcng\b/.test(s)) return "lpg";
  if (/flex/.test(s)) return "flex-fuel";
  if (/petrol|gasoline|unleaded|\bgas\b/.test(s)) return "petrol";
  if (s.split(/\s+/).length <= 3 && s.length <= 30 && !/see |description|unknown|other/.test(s)) return s.trim();
  return null;
}

function fuelFromText(text: string): string | null {
  for (const line of text.split(/\n+/)) {
    const t = line.trim();
    if (/^(petrol|diesel|unleaded|gasoline|hybrid|plug-in hybrid|electric|lpg|cng|flex-fuel)$/i.test(t)) return normalizeFuel(t);
  }
  const labeled = text.match(/\bfuel(?:\s+type)?\s*[:\-]\s*([a-z][a-z \-]{2,30})/i);
  return labeled ? normalizeFuel(labeled[1]) : null;
}

function colorFrom(v: unknown): string | null {
  const s = scalar(v);
  if (!s || s.length > 40) return null;
  if (/^(n\/?a|none|unknown|other|true|false)$/i.test(s)) return null;
  return pretty(s);
}

function labeledColor(text: string, which: "exterior" | "interior"): string | null {
  const m = text.match(new RegExp(`${which}\\s+colou?r\\s*[:\\-]\\s*([^\\n,.]{2,40})`, "i"));
  return m ? colorFrom(m[1]) : null;
}

function readOwners(v: unknown): string | null {
  if (typeof v === "number" && v >= 1 && v <= 20) return String(Math.round(v));
  const s = scalar(v);
  if (!s) return null;
  const key = s.toUpperCase().replace(/[\s-]+/g, "_");
  if (OWNERS[key]) return OWNERS[key];
  const count = s.match(/^(\d+)\s*\+?$/);
  if (count) return s.includes("+") ? `${count[1]}+` : count[1];
  const phrase = s.match(/^(\d+|one|two|three|four|five)\s*\+?\s+owners?$/i);
  if (!phrase) return null;
  return OWNERS[phrase[1].toUpperCase()] ?? phrase[1];
}

function ownersFromText(text: string): string | null {
  const m = text.match(/\b(\d+|one|two|three|four|five)\s*\+?\s+(?:previous\s+)?owners?\b/i);
  if (!m) return null;
  const token = m[1].toUpperCase();
  return OWNERS[token] ?? (/^\d+$/.test(m[1]) ? m[1] : null);
}

function ownersLabel(owners: string): string {
  if (owners === "1") return "1 owner";
  return `${owners} owners`;
}

function normalizeTitle(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/_/g, " ");
  if (/clean/.test(s)) return "clean";
  if (/salvage/.test(s)) return "salvage";
  if (/rebuilt|repaired/.test(s)) return "rebuilt";
  if (/written/.test(s)) return "written off";
  if (/parts/.test(s)) return "parts";
  if (/lien|encumber/.test(s)) return "lien";
  if (s.split(/\s+/).length <= 3 && s.length <= 30) return s.trim();
  return null;
}

function titleFromText(text: string): string | null {
  if (/clean title/i.test(text)) return "clean";
  if (/salvage/i.test(text)) return "salvage";
  if (/written[ -]?off/i.test(text)) return "written off";
  if (/rebuilt title/i.test(text)) return "rebuilt";
  return null;
}

function titleLabel(status: string | null): string | null {
  if (!status) return null;
  if (status === "clean") return "Clean title";
  if (status === "salvage") return "Salvage title";
  if (status === "rebuilt") return "Rebuilt title";
  if (status === "parts") return "Parts only";
  if (status === "lien") return "Lien recorded";
  if (status === "written off") return "Written off";
  return pretty(status);
}

function readPaidOff(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  const s = scalar(v)?.toLowerCase();
  if (!s) return null;
  if (/^(yes|true|paid|paid off|paid_off)$/.test(s)) return true;
  if (/^(no|false|unpaid|financed|not paid|not_paid_off)$/.test(s)) return false;
  return null;
}

function paidOffFromText(text: string): boolean | null {
  if (/paid off/i.test(text)) return true;
  if (/finance owing|not paid off|still financed/i.test(text)) return false;
  return null;
}

function readSeller(o: Obj): { sellerType: string | null; dealershipName: string | null } {
  const dealershipName = nameFrom(o.dealership_name);
  const raw = scalar(o.vehicle_seller_type)?.toUpperCase().replace(/[\s-]+/g, "_") ?? "";
  let sellerType: string | null = null;
  if (/DEALER/.test(raw) || dealershipName) sellerType = "dealer";
  else if (/PRIVATE|INDIVIDUAL|OWNER/.test(raw)) sellerType = "private";
  else if (raw && raw.length <= 32) sellerType = raw.toLowerCase();
  return { sellerType, dealershipName };
}

function sellerLabel(sellerType: string | null): string | null {
  if (!sellerType) return null;
  if (sellerType === "dealer") return "Dealer";
  if (sellerType === "private") return "Private seller";
  return `Seller: ${pretty(sellerType)}`;
}

function readBody(v: unknown): string | null {
  const s = nameFrom(v);
  if (!s || /^(car|vehicle|automobile)$/i.test(s)) return null;
  return s;
}

function readVin(v: unknown): string | null {
  const s = scalar(v);
  if (!s) return null;
  const vin = s.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin) ? vin : null;
}

function readFeatures(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = scalar(item);
    if (s && s.length <= 80) out.push(pretty(s));
  }
  return [...new Set(out)].slice(0, 40);
}

function readYear(raw: unknown, title: string, allowTitle: boolean): number | null {
  const n = numberish(raw);
  const max = new Date().getFullYear() + 1;
  if (n != null && n >= 1950 && n <= max) return Math.round(n);
  if (!allowTitle) return null;
  const m = title.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1950 && y <= max ? y : null;
}

function readSubtitles(o: Obj): string[] {
  const raw = o.custom_sub_titles_with_rendering_flags ?? o.custom_sub_titles;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const s = typeof item === "string" ? item.trim() : scalar((item as Obj)?.subtitle ?? item);
    if (s && s.length <= 120) out.push(s);
  }
  return out;
}

function specBag(v: unknown): Array<[string, string]> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(v as Obj)) {
    if (key.startsWith("__")) continue;
    const s = scalar(value);
    if (s && s.length <= 80 && !/^https?:/i.test(s)) out.push([key.toLowerCase(), s]);
  }
  return out;
}

function specPick(specs: Array<[string, string]>, re: RegExp): string | null {
  return specs.find(([key]) => re.test(key))?.[1] ?? null;
}
