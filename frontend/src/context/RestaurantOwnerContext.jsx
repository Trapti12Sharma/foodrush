import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { restaurantService } from '../services/restaurantService';

const RestaurantOwnerContext = createContext(null);

// Scoped only to /restaurant/* routes (mounted by RestaurantOwnerLayout) — an
// owner may run more than one restaurant, so every dashboard page needs to know
// which one is currently selected without re-fetching "my restaurants" itself.
export function RestaurantOwnerProvider({ children }) {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  const refresh = useCallback(() => {
    setLoading(true);
    return restaurantService
      .listMine()
      .then((list) => {
        setRestaurants(list);
        setSelectedId((prev) => (prev && list.some((r) => r._id === prev) ? prev : list[0]?._id || null));
        return list;
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selectedRestaurant = restaurants.find((r) => r._id === selectedId) || null;

  return (
    <RestaurantOwnerContext.Provider
      value={{ restaurants, loading, selectedId, setSelectedId, selectedRestaurant, refresh }}
    >
      {children}
    </RestaurantOwnerContext.Provider>
  );
}

export function useRestaurantOwner() {
  const ctx = useContext(RestaurantOwnerContext);
  if (!ctx) throw new Error('useRestaurantOwner must be used within a RestaurantOwnerProvider');
  return ctx;
}
