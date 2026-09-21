// The single source of truth for how an order total is built. cart.service.js
// (the running total shown while browsing) and order.service.js (the amount
// actually recorded and charged) both call this, so the two can never drift
// apart. Amounts are never taken from the client.
//
// Later milestones (platform fees, restaurant-funded vs platform-funded
// discounts) plug in here; the rate below becomes admin-configurable then.
const TAX_RATE = 0.05; // flat 5% — a real deployment would vary this by jurisdiction/item

// Money is rounded to whole paise so float noise (0.1 + 0.2) never reaches a total.
const round2 = (n) => Math.round(n * 100) / 100;

function lineTotal(item) {
  const addonsTotal = (item.addons || []).reduce((sum, addon) => sum + addon.price, 0);
  return (item.price + addonsTotal) * item.quantity;
}

function subtotalOf(items) {
  return round2(items.reduce((sum, item) => sum + lineTotal(item), 0));
}

function taxOn(subtotal) {
  return round2(subtotal * TAX_RATE);
}

// `discount` is clamped so a coupon can never push the payable amount negative.
function computeTotals({ subtotal, deliveryFee = 0, discount = 0 }) {
  const tax = taxOn(subtotal);
  const total = Math.max(round2(subtotal + deliveryFee + tax - discount), 0);
  return { subtotal, deliveryFee, tax, discount, total };
}

module.exports = { TAX_RATE, round2, lineTotal, subtotalOf, taxOn, computeTotals };
