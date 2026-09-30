import { useState } from 'react';
import { Plus, Award, Sparkles } from 'lucide-react';
import toast from '@/utils/toast';
import { useCart } from '../context/CartContext';
import QuantityStepper from './QuantityStepper';
import SmartImage from './SmartImage';

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
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState(
    () => food.variants?.find((v) => v.isAvailable)?._id || food.variants?.[0]?._id || ''
  );
  const [selectedAddonIds, setSelectedAddonIds] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const hasVariants = food.variants?.length > 0;
  const hasAddons = food.addons?.length > 0;
  const hasOptions = hasVariants || hasAddons;

  // A food with no variants/addons has one possible cart line, found by food id alone —
  // that's the only case the inline +/- stepper applies to.
  const simpleLine = !hasOptions ? cart.items.find((i) => i.food?._id === food._id && i.addons.length === 0 && !i.variantId) : null;

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

  async function handleAddWithOptions() {
    if (hasVariants && !selectedVariantId) {
      toast.error('Please choose an option');
      return;
    }
    setBusy(true);
    try {
      await requestAdd({
        foodId: food._id,
        quantity: 1,
        addons: selectedAddonIds.map((addonId) => ({ addonId })),
        variantId: selectedVariantId || undefined,
        note: note.trim() || undefined,
      });
      setOptionsOpen(false);
      setSelectedAddonIds([]);
      setNote('');
    } finally {
      setBusy(false);
    }
  }

  const selectedVariant = food.variants?.find((v) => v._id === selectedVariantId);
  const displayPrice = hasVariants
    ? selectedVariant
      ? (selectedVariant.discountPrice ?? selectedVariant.price)
      : food.displayPrice
    : food.discountPrice;

  return (
    <div className="flex items-start justify-between gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <VegDot isVeg={food.isVeg} />
          <p className="font-medium text-gray-900">{food.name}</p>
        </div>
        {(food.isBestseller || food.isRecommended) && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {food.isBestseller && (
              <span className="flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                <Award size={10} /> Bestseller
              </span>
            )}
            {food.isRecommended && (
              <span className="flex items-center gap-1 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
                <Sparkles size={10} /> Recommended
              </span>
            )}
          </div>
        )}
        {food.description && <p className="mt-1 text-sm text-gray-500">{food.description}</p>}
        <p className="mt-2 text-sm font-semibold text-gray-900">
          {hasVariants ? (
            `From ₹${food.displayPrice}`
          ) : displayPrice != null && displayPrice !== food.price ? (
            <>
              ₹{displayPrice} <span className="ml-1 text-xs font-normal text-gray-400 line-through">₹{food.price}</span>
            </>
          ) : (
            `₹${food.price}`
          )}
        </p>

        {hasOptions && !optionsOpen && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOptionsOpen(true)}
            className="mt-2 text-xs font-medium text-brand-600 hover:underline disabled:cursor-not-allowed disabled:text-gray-400"
          >
            {hasVariants ? 'Select options' : 'Customize & add'}
          </button>
        )}

        {hasOptions && optionsOpen && (
          <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
            {hasVariants && (
              <div className="mb-3">
                <p className="mb-1.5 text-xs font-medium text-gray-600">Choose an option</p>
                <div className="space-y-1">
                  {food.variants.map((variant) => (
                    <label
                      key={variant._id}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-sm ${
                        variant.isAvailable ? 'cursor-pointer border-gray-200 bg-surface' : 'cursor-not-allowed border-gray-100 bg-gray-100 text-gray-400'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`variant-${food._id}`}
                          disabled={!variant.isAvailable}
                          checked={selectedVariantId === variant._id}
                          onChange={() => setSelectedVariantId(variant._id)}
                        />
                        {variant.name}
                        {!variant.isAvailable && ' (unavailable)'}
                      </span>
                      <span className="text-gray-600">
                        {variant.discountPrice != null ? (
                          <>
                            ₹{variant.discountPrice} <span className="text-gray-400 line-through">₹{variant.price}</span>
                          </>
                        ) : (
                          `₹${variant.price}`
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {hasAddons && (
              <div className="mb-3">
                <p className="mb-1.5 text-xs font-medium text-gray-600">Add-ons</p>
                <div className="space-y-1">
                  {food.addons
                    .filter((a) => a.isAvailable)
                    .map((addon) => (
                      <label key={addon._id} className="flex items-center justify-between gap-2 text-sm text-gray-700">
                        <span className="flex items-center gap-2">
                          <input type="checkbox" checked={selectedAddonIds.includes(addon._id)} onChange={() => toggleAddon(addon._id)} />
                          {addon.name}
                        </span>
                        <span className="text-gray-400">+₹{addon.price}</span>
                      </label>
                    ))}
                </div>
              </div>
            )}

            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-gray-600">Cooking instructions (optional)</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 140))}
                placeholder="e.g. less spicy, no onions"
                maxLength={140}
                className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setOptionsOpen(false);
                  setSelectedAddonIds([]);
                  setNote('');
                }}
                className="flex-1 rounded-lg border border-gray-200 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddWithOptions}
                disabled={busy || (hasVariants && (!selectedVariantId || selectedVariant?.isAvailable === false))}
                className="flex-1 rounded-lg bg-brand-600 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Add to cart
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <SmartImage src={food.image} alt={food.name} widths={[160, 240]} sizes="80px" className="h-20 w-20 rounded-lg" />
        {!hasOptions &&
          (simpleLine ? (
            <QuantityStepper quantity={simpleLine.quantity} onIncrement={handleIncrement} onDecrement={handleDecrement} disabled={busy || disabled} />
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
