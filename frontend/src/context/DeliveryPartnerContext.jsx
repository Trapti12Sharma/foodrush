import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { deliveryPartnerService } from '../services/deliveryPartnerService';

const DeliveryPartnerContext = createContext(null);

// Scoped only to /delivery/* routes (mounted by DeliveryPartnerLayout) — mirrors
// RestaurantOwnerContext. `profile` is null both while loading and when the
// signed-in delivery partner hasn't created a profile yet (GET /me returns 404);
// the layout tells those two apart with `loading`.
export function DeliveryPartnerProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    return deliveryPartnerService
      .getMe()
      .then((p) => {
        setProfile(p);
        return p;
      })
      .catch((err) => {
        if (err.status === 404) {
          setProfile(null);
          return null;
        }
        throw err;
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <DeliveryPartnerContext.Provider value={{ profile, loading, refresh, setProfile }}>
      {children}
    </DeliveryPartnerContext.Provider>
  );
}

export function useDeliveryPartner() {
  const ctx = useContext(DeliveryPartnerContext);
  if (!ctx) throw new Error('useDeliveryPartner must be used within a DeliveryPartnerProvider');
  return ctx;
}
