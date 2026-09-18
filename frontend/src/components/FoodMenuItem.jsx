import { useState } from 'react';
import { Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useCart } from '../context/CartContext';
import QuantityStepper from './QuantityStepper';

export function VegDot({ isVeg }) {
  return (
    <span
      className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center border ${
        isVeg ? 'border-green-600' : 'border-red-600'
      }`}
      title={isVeg ? 'Vegetarian' : 'Non-vegetarian'}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isVeg ? 'bg-green-600' : 'bg-red-600'}`} />
    </span>
  );
}

export default function FoodMenuItem({ food, requestAdd, disabled }) {
  const { cart, updateQuantity, removeItem } = useCart();
  const [showAddons, setShowAddons] = useState(false);
  const [selectedAddonIds, setSelectedAddonIds] = useState([]);
  const [busy, setBusy] = useState(false);

  const hasAddons = food.addons?.length > 0;
  const simpleLine = !hasAddons
    ? cart.items.find((i) => i.food?._id === food._id && i.addons.length === 0)
    : null;

  async function handleSimpleAdd() {
    setBusy(true);
    await requestAdd({ foodId: food._id, quantity: 1 });
    setBusy(false);
  }

  async function handleIncrement() {
    setBusy(true);
    try {
      if (simpleLine) await updateQuantity(simpleLine._id, simpleLine.quantity + 1);
      else await requestAdd({ foodId: food._id, quantity: 1 });
    } catch (err) {
      toast.error(err.message || 'Could not update cart');
    } finally {
      setBusy(false);
    }
  }

  async function handleDecrement() {
    if (!simpleLine) return;
    setBusy(true);
    try {
      if (simpleLine.quantity <= 1) await removeItem(simpleLine._id);
      else await updateQuantity(simpleLine._id, simpleLine.quantity - 1);
    } catch (err) {
      toast.error(err.message || 'Could not update cart');
    } finally {
      setBusy(false);
    }
  }

  function toggleAddon(addonId) {
    setSelectedAddonIds((prev) => (prev.includes(addonId) ? prev.filter((id) => id !== addonId) : [...prev, addonId]));
  }

  async function handleAddWithAddons() {
    setBusy(true);
    await requestAdd({ foodId: food._id, quantity: 1, addons: selectedAddonIds.map((addonId) => ({ addonId })) });
    setBusy(false);
    setShowAddons(false);
    setSelectedAddonIds([]);
  }

  return (
    <div className="flex items-start justify-between gap-4 p-4">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <VegDot isVeg={food.isVeg} />
          <p className="font-medium text-gray-900">{food.name}</p>
        </div>
        {food.description && <p className="mt-1 text-sm text-gray-500">{food.description}</p>}
        <p className="mt-2 text-sm font-semibold text-gray-900">
          {food.discountPrice != null ? (
            <>
              ₹{food.discountPrice}{' '}
              <span className="ml-1 text-xs font-normal text-gray-400 line-through">₹{food.price}</span>
            </>
          ) : (
            `₹${food.price}`
          )}
        </p>

        {hasAddons && !showAddons && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setShowAddons(true)}
            className="mt-2 text-xs font-medium text-brand-600 hover:underline disabled:cursor-not-allowed disabled:text-gray-400"
          >
            Customize &amp; add
          </button>
        )}

        {hasAddons && showAddons && (
          <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
            <p className="mb-2 text-xs font-medium text-gray-600">Add-ons</p>
            <div className="space-y-1">
              {food.addons
                .filter((a) => a.isAvailable)
                .map((addon) => (
                  <label key={addon._id} className="flex items-center justify-between gap-2 text-sm text-gray-700">
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedAddonIds.includes(addon._id)}
                        onChange={() => toggleAddon(addon._id)}
                      />
                      {addon.name}
                    </span>
                    <span className="text-gray-400">+₹{addon.price}</span>
                  </label>
                ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowAddons(false);
                  setSelectedAddonIds([]);
                }}
                className="flex-1 rounded-lg border border-gray-200 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddWithAddons}
                disabled={busy}
                className="flex-1 rounded-lg bg-brand-600 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                Add to cart
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        {food.image && <img src={food.image} alt={food.name} className="h-20 w-20 rounded-lg object-cover" />}
        {!hasAddons &&
          (simpleLine ? (
            <QuantityStepper
              quantity={simpleLine.quantity}
              onIncrement={handleIncrement}
              onDecrement={handleDecrement}
              disabled={busy || disabled}
            />
          ) : (
            <button
              type="button"
              onClick={handleSimpleAdd}
              disabled={busy || disabled}
              className="flex items-center gap-1 rounded-lg border border-brand-600 px-3 py-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
            >
              <Plus size={14} /> Add
            </button>
          ))}
      </div>
    </div>
  );
}
