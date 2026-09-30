const pricing = require('../src/services/pricing.service');

describe('pricing.service', () => {
  it('prices a line as (price + add-ons) x quantity', () => {
    expect(pricing.lineTotal({ price: 100, quantity: 2, addons: [{ price: 20 }, { price: 10 }] })).toBe(260);
    expect(pricing.lineTotal({ price: 50, quantity: 3 })).toBe(150); // no addons field
  });

  it('sums a cart subtotal without float noise', () => {
    const items = [
      { price: 0.1, quantity: 1, addons: [] },
      { price: 0.2, quantity: 1, addons: [] },
    ];
    expect(pricing.subtotalOf(items)).toBe(0.3); // plain 0.1 + 0.2 is 0.30000000000000004
  });

  it('charges 5% tax rounded to paise', () => {
    expect(pricing.taxOn(100)).toBe(5);
    expect(pricing.taxOn(99.99)).toBe(5); // 4.9995 -> 5
    expect(pricing.taxOn(33.33)).toBe(1.67);
  });

  it('builds a total from subtotal + delivery + tax - discount', () => {
    expect(pricing.computeTotals({ subtotal: 200, deliveryFee: 30, discount: 20 })).toEqual({
      subtotal: 200,
      deliveryFee: 30,
      tax: 10,
      discount: 20,
      total: 220,
    });
  });

  it('never lets a discount push the payable amount below zero', () => {
    expect(pricing.computeTotals({ subtotal: 50, deliveryFee: 0, discount: 500 }).total).toBe(0);
  });

  it('defaults delivery fee and discount to zero', () => {
    expect(pricing.computeTotals({ subtotal: 100 })).toMatchObject({ deliveryFee: 0, discount: 0, total: 105 });
  });
});
