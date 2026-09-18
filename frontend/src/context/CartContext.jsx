import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { cartService } from '../services/cartService';
import { useAuth } from './AuthContext';

const CartContext = createContext(null);

const EMPTY_CART = { items: [], restaurant: null, subtotal: 0, deliveryFee: 0, tax: 0, discount: 0, total: 0 };

export function CartProvider({ children }) {
  const { user } = useAuth();
  const [cart, setCart] = useState(EMPTY_CART);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!user) {
      setCart(EMPTY_CART);
      return Promise.resolve(EMPTY_CART);
    }
    setLoading(true);
    return cartService
      .get()
      .then((c) => {
        setCart(c);
        return c;
      })
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?._id]);

  // On a cross-restaurant conflict the addItem promise rejects with the
  // {status:409, data:{existingRestaurantName}} shape from api.js's interceptor —
  // left unhandled here so the caller (RestaurantDetail) can offer a "clear cart
  // and switch restaurants?" prompt instead of a generic failure toast.
  const addItem = useCallback(async (payload) => {
    const updated = await cartService.addItem(payload);
    setCart(updated);
    return updated;
  }, []);

  const switchRestaurant = useCallback(async (payload) => {
    await cartService.clear();
    const updated = await cartService.addItem(payload);
    setCart(updated);
    return updated;
  }, []);

  const updateQuantity = useCallback(async (itemId, quantity) => {
    const updated = await cartService.updateItem(itemId, quantity);
    setCart(updated);
    return updated;
  }, []);

  const removeItem = useCallback(async (itemId) => {
    const updated = await cartService.removeItem(itemId);
    setCart(updated);
    return updated;
  }, []);

  const clear = useCallback(async () => {
    const updated = await cartService.clear();
    setCart(updated);
    return updated;
  }, []);

  const itemCount = useMemo(() => cart.items.reduce((sum, i) => sum + i.quantity, 0), [cart.items]);

  return (
    <CartContext.Provider
      value={{ cart, loading, itemCount, refresh, addItem, switchRestaurant, updateQuantity, removeItem, clear }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within a CartProvider');
  return ctx;
}
