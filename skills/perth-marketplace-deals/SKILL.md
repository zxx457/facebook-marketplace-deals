---
name: perth-marketplace-deals
description: Find and judge Facebook Marketplace listings around Perth, Western Australia (AUD). Use for used cars and other second-hand buys or resale flips in Perth, WA, including gearbox, kilometres, PPSR, the WA written-off register, dealer stock, and price-drop watches.
---

# Perth Marketplace deals

Buying or reselling around Perth, WA, with the `facebook-marketplace` tools (`marketplace_*`). Same loop as `marketplace-deals`: queries, an outside baseline, `marketplace_compare`, inspect, report, watch. Use that skill for other places. This one is Perth only.

If the tools are missing, say the server is not connected and stop. Read-only: never message a seller, never buy, never pay. Draft the message; the user sends it and hands over the money. Never suggest a deposit or paying before a look in person.

## Workflow

1. **Pin the target.** Year, make, model, badge, gearbox (manual or auto), rough km band, budget, and how far from Perth is acceptable. Ask one question only when the answer moves the price a lot. Otherwise assume any condition, private sellers, and location `perth`.

2. **Write queries the way WA sellers title things.** English, 2–4 variants: `["bmw 320ci", "e46 320ci", "bmw e46 manual"]`. Put `manual` or `auto` in `must_include` only when the user insisted. `exclude` parts, wrecking, swapping, wanted, finance, deposit. Set `min_price` high enough to skip accessories and joke prices. Pass `location: "perth"` (or the numeric id from `facebook.com/marketplace/<id>/` if `perth` returns the wrong city). Currency is AUD. For distance, pass Perth `home_lat` / `home_lng` (about -31.95, 115.86) or set `FBMP_HOME_LAT` / `FBMP_HOME_LNG`. `radius_km` only tightens once the user is logged in.

3. **Baseline from sold prices, not asking prices.** Look up recent sold or completed listings for the same year, badge, gearbox, and a similar km band on carsales, Gumtree, and eBay Australia (sold/completed). Active ads are the competition, not the value. Retail is only a ceiling for near-new cars. Pass one sold-based figure as `reference_price` when every query is the same variant.

4. **Run `marketplace_compare`** with those queries, `export_report: true`, and the reference when it applies. Aim for `counts.analysed` ≥ 15. If it is thinner, widen once (more spellings, drop `must_include`, raise `max_price`, or a neighbouring WA town) and then say the sample is thin.

5. **Inspect with `marketplace_listing`.** For each shortlisted car, read `vehicle` before any judgement:
   - `transmission` and `odometerKm` / `odometerText` are the gearbox and the kilometres Facebook shows. Do not say the listing "didn't say manual" or "didn't say km" while those fields are filled.
   - Also use `fuel`, `exteriorColor`, `interiorColor`, `owners`, `titleStatus`, `paidOff`, `sellerType`, `dealershipName`, `vin`, `year`, `make`, `model`, `trim`.
   - The same facts are copied into `attributes`.
   - If `vehicle` is null, use `attributes` and `vehicle.rawLines`. If those are empty too, say the tool did not return the about-this-vehicle block. That is not the same as Facebook leaving it blank.
   - `odometerPlaceholder: true` (1, 123, 1234, and the same joke numbers) means the seller typed a required field, not a real odometer.
   - If the description states a different km or gearbox than `vehicle`, trust neither until the seller confirms. Photos still matter: the car, the odometer cluster, service book, rust, panel gaps.

6. **PPSR and the WA written-off register.** Do not call a car clean, unencumbered, or roadworthy without a check. A PPSR search on the VIN (https://www.ppsr.gov.au/) is what shows a security interest, a stolen flag, and a written-off flag. WA's register (https://www.transport.wa.gov.au/licensing/vehicle/written-off-vehicles) is the local meaning: a statutory write-off cannot be licensed again; a repairable write-off needs the WA inspection path before it can. Unknown PPSR or WOVR status caps the score below an alert. Finance owing (`paidOff: false`) is a walk-away unless the user wants that risk.

7. **Flag dealers.** `sellerType: "dealer"`, a `dealershipName`, or title words such as dealer, finance available, or drive-away mean dealer stock. Prefer private sellers. Say "dealer" in the first line of that pick. Do not score it as a private bargain.

8. **Report, then offer a watch.** Shortlist at most four cars that survive inspection. State sold comps, landed cost, the score, and what is still unchecked. Draft a short Australian English message per pick. Offer `marketplace_watch` with the same queries, excludes, location, and `target_price` set to the realistic sold price, not the asking price. Run `marketplace_check_watches` once so later runs only report new listings, price drops, and target hits.

## Resale score

Inspired by the bargain-scoring approach in [zxx457/Clanker-Skills](https://github.com/zxx457/Clanker-Skills) (`SKILL_BARGAIN_HUNTING_PPS.md`, GPL-3.0). The rules below are written for this MIT repo and are not that file.

A low ask is not a deal. Score only after costs, and only against prices cars like this actually sold for.

**Landed cost** = asking price + a realistic Perth pickup (name the suburb; Bunbury or Geraldton is not a free local car) + a pre-purchase inspection if it has not been done + obvious near-term spend (tyres, service, battery, unlicensed transfer) + a buffer when km, gearbox, or ownership is unclear.

**Realistic resale** = the lower half of recent sold comps for the same model, year, gearbox, and similar km. Subtract the fees and freight the user would actually pay to resell. Profit = that net figure − landed cost.

| Piece | Points |
|---|---:|
| Gap versus sold comps after landed cost | 0–35 |
| Comps are recent and sold, not another suburb's asking prices | 0–20 |
| Gearbox and odometer were read from `vehicle`, and they agree with the ad | 0–15 |
| Private seller, real photos, no dealer wording | 0–15 |
| PPSR / WOVR not a known problem | 0–15 |

- **80–100:** strong deal. Alert, and name the one thing still to verify.
- **65–79:** mention only when the user asked for a shortlist.
- **Below 65:** stay quiet unless they asked to see everything.
- PPSR or WOVR not checked yet: cap at 79. No alert.
- Dealer stock: subtract 15, and do not call it a private deal.
- Placeholder price (`A$1`, `A$123`, `A$1,234`, `A$12,345` — the compare tool already flags these): not a deal. Real price unknown.
- Negative or tiny profit after costs: score under 65 even if the ask looks exciting.

**Price-drop re-alert.** `marketplace_check_watches` reports drops. Ping again only when the new price moves the score across a band above, or the price is now at or under `target_price`. Quote the old price and the new price. Do not re-alert an unchanged listing. Do not message the seller.

## Reading compare output

- Up to four `bestDeals`. If inspection kills one, fetch more with `top_n`. Do not pad.
- `groups` are title variants (storage and tier words). Cars of different km and gearboxes still share a group, so say so and lean on `vehicle` plus the sold comps, not the Marketplace median alone.
- `suspicious` is for scams and bait, not for high-km cars. High km is a fact, not a flag, once `odometerKm` is known.
- `meta.loggedIn: false` is about 24 results per page. Suggest `marketplace_login` if coverage is thin. The user logs in themselves.
- `meta.priceDrops` is the re-alert input above.

## Message to draft

Keep it short. The user pastes it.

`Hi, is the <year make model> still available? I can come to <suburb> to inspect. Is the <manual/auto> and <km> in the ad correct, any finance owing, and is the rego current?`

Add a service-history question when the photos do not show a book. Do not open with an offer on a car whose PPSR is unchecked. When the price is the thing to negotiate, one number: the most the landed-cost maths still supports, then stop.
