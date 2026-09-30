import { useEffect, useState } from 'react';
import { Bike, MapPin, Radio } from 'lucide-react';
import { useOrderTracking } from '../hooks/useOrderTracking';
import { configService } from '../services/configService';

const STATUS_TEXT = {
  connecting: 'Connecting…',
  live: 'Live',
  unavailable: 'Location unavailable',
  ended: 'Tracking ended',
};
const STATUS_STYLE = {
  connecting: 'bg-amber-100 text-amber-700',
  live: 'bg-green-100 text-green-700',
  unavailable: 'bg-gray-100 text-gray-500',
  ended: 'bg-gray-100 text-gray-500',
};

function useSecondsAgo(timestamp) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!timestamp) return undefined;
    const interval = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [timestamp]);
  if (!timestamp) return null;
  return Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 1000));
}

function apiOrigin() {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
  try {
    return new URL(apiUrl).origin;
  } catch {
    return 'http://localhost:5000';
  }
}

// Shown on the customer/owner order-detail page once an order is OUT_FOR_DELIVERY
// with an assigned rider. Renders nothing fake: no map, no coordinates, and no
// "Live" claim until a real one has actually arrived.
export default function DeliveryTracker({ orderId, onDelivered }) {
  const { status, location, rider } = useOrderTracking(orderId, true, onDelivered);
  const [mapsEnabled, setMapsEnabled] = useState(false);
  const secondsAgo = useSecondsAgo(location?.updatedAt);

  useEffect(() => {
    configService
      .get()
      .then((cfg) => setMapsEnabled(Boolean(cfg.locationSearchEnabled)))
      .catch(() => setMapsEnabled(false));
  }, []);

  const mapSrc =
    mapsEnabled && location
      ? `${apiOrigin()}/api/geo/static-map?lat=${location.latitude}&lng=${location.longitude}&zoom=16&width=400&height=220`
      : null;

  return (
    <div className="mt-6 rounded-xl border border-gray-100 bg-surface p-4 text-sm">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 font-semibold text-gray-700">
          <Bike size={16} /> Track delivery
        </p>
        <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[status]}`}>
          <Radio size={11} /> {STATUS_TEXT[status]}
        </span>
      </div>

      {rider && (
        <p className="mt-2 text-xs text-gray-500">
          {rider.fullName} · {rider.vehicleType}
          {rider.vehicleNumber ? ` (${rider.vehicleNumber})` : ''}
        </p>
      )}

      {location ? (
        <div className="mt-3">
          {mapSrc ? (
            <img src={mapSrc} alt="Rider location" className="w-full rounded-lg border border-gray-100 object-cover" style={{ maxHeight: 220 }} />
          ) : (
            <div className="flex items-center gap-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
              <MapPin size={14} /> {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
              {!mapsEnabled && <span className="text-gray-400">(map not configured)</span>}
            </div>
          )}
          <p className="mt-2 text-xs text-gray-400">
            {secondsAgo != null ? `Last updated ${secondsAgo}s ago` : 'Waiting for rider location…'}
          </p>
        </div>
      ) : status === 'ended' ? (
        <p className="mt-3 text-xs text-gray-400">This delivery has ended.</p>
      ) : (
        <p className="mt-3 text-xs text-gray-400">
          {status === 'unavailable' ? 'Location unavailable right now.' : 'Waiting for the rider to start sharing their location…'}
        </p>
      )}
    </div>
  );
}
