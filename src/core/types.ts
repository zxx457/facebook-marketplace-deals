export interface Listing {
  id: string;
  url: string;
  title: string;
  price: number | null;
  /** ISO code when Facebook gives one, otherwise inferred from the formatted price symbol. */
  currency: string | null;
  priceText: string;
  /** Price before the seller's last reduction, when shown. */
  previousPrice: number | null;
  city: string | null;
  imageUrl: string | null;
  /** Unix seconds. */
  createdAt: number | null;
  isSold: boolean;
  isPending: boolean;
  sellerName: string | null;
  sellerId: string | null;
  deliveryTypes: string[];
  categoryId: string | null;
  /**
   * Gearbox when the search payload includes one (`manual`, `automatic`, `cvt`).
   * Detail pages also copy this from `vehicle`.
   */
  transmission: string | null;
  /** Odometer converted to kilometres, when the payload includes one. */
  odometerKm: number | null;
  /** Display form, e.g. "208,000 km" or "128,748 km (80,000 mi)". */
  odometerText: string | null;
}

/** Facts Facebook shows under "About this vehicle". Null when the listing is not a vehicle. */
export interface VehicleDetails {
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  bodyStyle: string | null;
  /** `manual`, `automatic`, `cvt`, or a short raw token. */
  transmission: string | null;
  odometerKm: number | null;
  odometerText: string | null;
  /** True for joke readings sellers type because the field is required (1, 123, 1234, …). */
  odometerPlaceholder: boolean;
  fuel: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  /** "1", "2", "4+", … */
  owners: string | null;
  /** clean, salvage, rebuilt, parts, lien, written off. */
  titleStatus: string | null;
  paidOff: boolean | null;
  /** `private` or `dealer` when Facebook says which. */
  sellerType: string | null;
  dealershipName: string | null;
  vin: string | null;
  /** Normalised goods-style condition when Facebook sent a vehicle condition. */
  condition: string | null;
  features: string[];
  /**
   * Lines we could not file onto a field, or the about-section text when the
   * structured `vehicle_*` fields were missing.
   */
  rawLines: string[];
}

export interface ListingDetail extends Listing {
  description: string;
  condition: string | null;
  conditionLabel: string | null;
  attributes: Array<{ name: string; value: string; label: string }>;
  latitude: number | null;
  longitude: number | null;
  locationText: string | null;
  photos: string[];
  shippingOffered: boolean;
  status: string | null;
  vehicle: VehicleDetails | null;
}

export interface Specs {
  /** Storage in GB (1TB = 1024). */
  storageGb: number | null;
  /** Model tier words, normalised to English: pro, max, mini, plus, ultra, ... */
  tiers: string[];
  /** Screen / product size in inches. */
  sizeInch: number | null;
}

export type Severity = "high" | "medium" | "low";

export interface RedFlag {
  code: string;
  severity: Severity;
  message: string;
}
