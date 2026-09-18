import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { favoriteService } from '../services/favoriteService';
import { useAuth } from './AuthContext';

const FavoritesContext = createContext(null);

// Holds the favorited-restaurant set for the whole app so RestaurantCard/
// RestaurantDetail can show the right heart state without each doing its own
// fetch — same pattern as CartContext.
export function FavoritesProvider({ children }) {
  const { user } = useAuth();
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!user) {
      setRestaurants([]);
      return Promise.resolve([]);
    }
    setLoading(true);
    return favoriteService
      .list()
      .then((list) => {
        setRestaurants(list);
        return list;
      })
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?._id]);

  const isFavorite = useCallback((restaurantId) => restaurants.some((r) => r._id === restaurantId), [restaurants]);

  const toggleFavorite = useCallback(
    async (restaurantId) => {
      if (isFavorite(restaurantId)) {
        await favoriteService.remove(restaurantId);
        setRestaurants((prev) => prev.filter((r) => r._id !== restaurantId));
      } else {
        await favoriteService.add(restaurantId);
        await refresh();
      }
    },
    [isFavorite, refresh]
  );

  return (
    <FavoritesContext.Provider value={{ restaurants, loading, isFavorite, toggleFavorite, refresh }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error('useFavorites must be used within a FavoritesProvider');
  return ctx;
}
