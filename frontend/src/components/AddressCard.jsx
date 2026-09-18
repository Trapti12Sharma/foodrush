import { MapPin, Star, Pencil, Trash2 } from 'lucide-react';

export default function AddressCard({ address, selectable, selected, onSelect, onEdit, onDelete }) {
  return (
    <div
      onClick={selectable ? onSelect : undefined}
      className={`flex items-start gap-3 rounded-xl border p-4 ${
        selectable ? 'cursor-pointer' : ''
      } ${selected ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-white'}`}
    >
      <MapPin size={18} className="mt-0.5 shrink-0 text-gray-400" />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-gray-900">{address.label || 'Address'}</p>
          {address.isDefault && (
            <span className="flex items-center gap-0.5 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">
              <Star size={10} fill="currentColor" /> Default
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-600">
          {address.addressLine}, {address.city}
          {address.state ? `, ${address.state}` : ''} — {address.pincode}
        </p>
      </div>
      {(onEdit || onDelete) && (
        <div className="flex shrink-0 gap-2">
          {onEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="text-gray-400 hover:text-brand-600"
              aria-label="Edit address"
            >
              <Pencil size={16} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="text-gray-400 hover:text-red-600"
              aria-label="Delete address"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
