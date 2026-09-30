// The single source of truth for how an order total is built. cart.service.js
// (the running total shown while browsing) and order.service.js (the amount
// actually recorded and charged) both call this, so the two can never drift
// apart. Amounts are never taken from the client.
//
// M17 made the tax rate admin-configurable (PlatformSetting.pricing.taxRate).
// This module stays SYNCHRONOUS and settings-unaware on purpose: it is pure
// arithmetic, called from both an async service and a unit test, and making it
// reach into the database would turn every total into an awaitable and give this
// file a dependency on a model. Instead the caller passes the rate it read —
// cart.service.js and order.service.js each fetch it once per operation, so
// every line of one total is computed at one rate and cannot straddle an edit.
//
// The constant below remains the fallback for any caller that passes no rate,
// and is the value PlatformSetting seeds itself with, so a deployment whose
// settings document has never been written behaves exactly as it did pre-M17.
const TAX_RATE = 0.05; // flat 5% — the platform default, editable per deployment

// Money is rounded to whole paise so float noise (0.1 + 0.2) never reaches a total.
const round2 = (n) => Math.round(n * 100) / 100;

function lineTotal(item) {
  const addonsTotal = (item.addons || []).reduce((sum, addon) => sum + addon.price, 0);
  return (item.price + addonsTotal) * item.quantity;
}

function subtotalOf(items) {
  return round2(items.reduce((sum, item) => sum + lineTotal(item), 0));
}

// `taxRate` is the caller's rate, read from platform settings. A null/undefined
// rate falls back to TAX_RATE; a rate of 0 is honored as a real zero-tax
// configuration, so the check is explicit rather than `taxRate || TAX_RATE`.
function taxOn(subtotal, taxRate) {
  const rate = typeof taxRate === 'number' && Number.isFinite(taxRate) ? taxRate : TAX_RATE;
  return round2(subtotal * rate);
}

// `discount` is clamped so a coupon can never push the payable amount negative.
function computeTotals({ subtotal, deliveryFee = 0, discount = 0, taxRate }) {
  const tax = taxOn(subtotal, taxRate);
  const total = Math.max(round2(subtotal + deliveryFee + tax - discount), 0);
  return { subtotal, deliveryFee, tax, discount, total };
}

// The price a line is actually charged at: the chosen variant's price if the food has
// variants (a variant is REQUIRED once any exist — see cart.service.js), otherwise the
// food's own effective price. Never trusts a client-sent price.
function unitPriceFor(food, variantId) {
  if (food.variants && food.variants.length > 0) {
    const variant = food.variants.id ? food.variants.id(variantId) : food.variants.find((v) => String(v._id) === String(variantId));
    if (!variant || !variant.isAvailable) return null;
    return variant.discountPrice != null ? variant.discountPrice : variant.price;
  }
  return food.effectivePrice();
}

module.exports = { TAX_RATE, round2, lineTotal, subtotalOf, taxOn, computeTotals, unitPriceFor };
