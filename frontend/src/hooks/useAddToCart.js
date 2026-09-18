import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';

// Centralizes the "add to cart, but the cart already has a different
// restaurant's items" flow: the backend rejects that with 409 + structured
// data (Phase 6 cart.service.js), and this hook turns that into a confirm
// prompt instead of a generic error toast.
export function useAddToCart() {
  const { addItem, switchRestaurant } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [conflict, setConflict] = useState(null); // { payload, existingRestaurantName }

  const requestAdd = useCallback(
    async (payload) => {
      if (!user) {
        toast.error('Please log in to add items to your cart');
        navigate('/login');
        return;
      }
      try {
        await addItem(payload);
        toast.success('Added to cart');
      } catch (err) {
        if (err.status === 409 && err.data?.existingRestaurantName) {
          setConflict({ payload, existingRestaurantName: err.data.existingRestaurantName });
        } else {
          toast.error(err.message || 'Could not add item to cart');
        }
      }
    },
    [user, addItem, navigate]
  );

  const confirmSwitch = useCallback(async () => {
    if (!conflict) return;
    try {
      await switchRestaurant(conflict.payload);
      toast.success('Cart updated for this restaurant');
    } catch (err) {
      toast.error(err.message || 'Could not update cart');
    } finally {
      setConflict(null);
    }
  }, [conflict, switchRestaurant]);

  const cancelSwitch = useCallback(() => setConflict(null), []);

  return { requestAdd, conflict, confirmSwitch, cancelSwitch };
}
