import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach } from 'vitest';
import { CartProvider, useCart } from './CartContext';
import { useAuth } from './AuthContext';
import { cartService } from '../services/cartService';

vi.mock('./AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../services/cartService', () => ({
  cartService: {
    get: vi.fn(),
    addItem: vi.fn(),
    updateItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    applyCoupon: vi.fn(),
    removeCoupon: vi.fn(),
  },
}));

const SERVER_CART = {
  items: [{ _id: 'i1', name: 'Margherita', quantity: 2, price: 100 }],
  restaurant: { _id: 'r1', name: 'Napoli' },
  subtotal: 200,
  deliveryFee: 10,
  tax: 10,
  discount: 20,
  total: 200,
};

// A minimal consumer: renders the cart's own numbers and exposes the actions as
// buttons, so each test asserts on what a real component would actually see.
function CartProbe() {
  const { cart, addItem, switchRestaurant, applyCoupon } = useCart();
  return (
    <div>
      <p data-testid="item-count">{cart.items.length}</p>
      <p data-testid="total">{cart.total}</p>
      <p data-testid="discount">{cart.discount}</p>
      <p data-testid="restaurant">{cart.restaurant?.name || 'none'}</p>
      <button type="button" onClick={() => addItem({ foodId: 'f1', quantity: 1 }).catch(() => {})}>
        add
      </button>
      <button type="button" onClick={() => switchRestaurant({ foodId: 'f2', quantity: 1 })}>
        switch
      </button>
      <button type="button" onClick={() => applyCoupon('SAVE20')}>
        coupon
      </button>
    </div>
  );
}

function renderCart() {
  return render(
    <CartProvider>
      <CartProbe />
    </CartProvider>
  );
}

describe('CartContext', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ user: { _id: 'u1', role: 'CUSTOMER' } });
    cartService.get.mockResolvedValue(SERVER_CART);
  });

  it('loads the cart from the server for a signed-in customer', async () => {
    renderCart();
    await waitFor(() => expect(screen.getByTestId('item-count')).toHaveTextContent('1'));
    // Every figure comes from the server response — the client never computes a
    // total of its own, because pricing is server-authoritative.
    expect(screen.getByTestId('total')).toHaveTextContent('200');
    expect(screen.getByTestId('restaurant')).toHaveTextContent('Napoli');
  });

  it('does not call the API at all for an anonymous visitor, and shows an empty cart', async () => {
    useAuth.mockReturnValue({ user: null });
    renderCart();

    await waitFor(() => expect(screen.getByTestId('item-count')).toHaveTextContent('0'));
    expect(cartService.get).not.toHaveBeenCalled();
    expect(screen.getByTestId('restaurant')).toHaveTextContent('none');
  });

  it('replaces local state with whatever the server returns after adding an item', async () => {
    const user = userEvent.setup();
    renderCart();
    await waitFor(() => expect(screen.getByTestId('item-count')).toHaveTextContent('1'));

    // The server is the one that recomputes totals; the client just adopts them.
    cartService.addItem.mockResolvedValue({ ...SERVER_CART, items: [...SERVER_CART.items, { _id: 'i2' }], total: 315 });
    await user.click(screen.getByRole('button', { name: 'add' }));

    await waitFor(() => expect(screen.getByTestId('item-count')).toHaveTextContent('2'));
    expect(screen.getByTestId('total')).toHaveTextContent('315');
  });

  it('propagates a cross-restaurant 409 instead of swallowing it', async () => {
    const user = userEvent.setup();
    renderCart();
    await waitFor(() => expect(screen.getByTestId('item-count')).toHaveTextContent('1'));

    // The caller (RestaurantDetail) needs this rejection to offer "clear cart and
    // switch restaurants?". If the context swallowed it, the user would get a
    // generic failure and no way forward.
    const conflict = { status: 409, data: { existingRestaurantName: 'Napoli' } };
    cartService.addItem.mockRejectedValue(conflict);
    await user.click(screen.getByRole('button', { name: 'add' }));

    await waitFor(() => expect(cartService.addItem).toHaveBeenCalled());
    // Cart is left untouched by the failed add — no optimistic local mutation.
    expect(screen.getByTestId('item-count')).toHaveTextContent('1');
    expect(screen.getByTestId('restaurant')).toHaveTextContent('Napoli');
  });

  it('clears before adding when switching restaurants, in that order', async () => {
    const user = userEvent.setup();
    renderCart();
    await waitFor(() => expect(screen.getByTestId('item-count')).toHaveTextContent('1'));

    const order = [];
    cartService.clear.mockImplementation(async () => {
      order.push('clear');
      return { ...SERVER_CART, items: [] };
    });
    cartService.addItem.mockImplementation(async () => {
      order.push('add');
      return { ...SERVER_CART, restaurant: { _id: 'r2', name: 'Tandoor' }, items: [{ _id: 'i9' }] };
    });

    await user.click(screen.getByRole('button', { name: 'switch' }));

    // Adding first would hit the same cross-restaurant conflict the switch is
    // meant to resolve, so the order matters.
    await waitFor(() => expect(order).toEqual(['clear', 'add']));
    expect(screen.getByTestId('restaurant')).toHaveTextContent('Tandoor');
  });

  it('takes the discount from the server response rather than computing one', async () => {
    const user = userEvent.setup();
    renderCart();
    await waitFor(() => expect(screen.getByTestId('item-count')).toHaveTextContent('1'));

    cartService.applyCoupon.mockResolvedValue({ ...SERVER_CART, discount: 40, total: 180 });
    await user.click(screen.getByRole('button', { name: 'coupon' }));

    await waitFor(() => expect(screen.getByTestId('discount')).toHaveTextContent('40'));
    expect(screen.getByTestId('total')).toHaveTextContent('180');
    expect(cartService.applyCoupon).toHaveBeenCalledWith('SAVE20');
  });

  it('empties the cart when the user signs out', async () => {
    const { rerender } = renderCart();
    await waitFor(() => expect(screen.getByTestId('item-count')).toHaveTextContent('1'));

    // Leaving a previous session's cart on screen after sign-out would show one
    // person's order to whoever uses the browser next.
    useAuth.mockReturnValue({ user: null });
    rerender(
      <CartProvider>
        <CartProbe />
      </CartProvider>
    );

    await waitFor(() => expect(screen.getByTestId('item-count')).toHaveTextContent('0'));
  });
});
