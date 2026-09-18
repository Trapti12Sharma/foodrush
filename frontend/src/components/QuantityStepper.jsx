import { Minus, Plus } from 'lucide-react';

export default function QuantityStepper({ quantity, onIncrement, onDecrement, disabled }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-1 py-1">
      <button
        type="button"
        onClick={onDecrement}
        disabled={disabled}
        className="flex h-6 w-6 items-center justify-center rounded text-brand-700 hover:bg-brand-100 disabled:opacity-50"
        aria-label="Decrease quantity"
      >
        <Minus size={14} />
      </button>
      <span className="w-4 text-center text-sm font-medium text-brand-700">{quantity}</span>
      <button
        type="button"
        onClick={onIncrement}
        disabled={disabled}
        className="flex h-6 w-6 items-center justify-center rounded text-brand-700 hover:bg-brand-100 disabled:opacity-50"
        aria-label="Increase quantity"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
