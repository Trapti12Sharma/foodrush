import { Plus, Trash2 } from 'lucide-react';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// slots: [{ day, open: 'HH:MM', close: 'HH:MM' }] — the same shape the API accepts on
// create/update. The API returns them back as minutes since midnight, so the caller
// converts once (see owner/Profile.jsx) rather than this component knowing about that.
function minutesToHHMM(value) {
  if (typeof value !== 'number') return value; // already "HH:MM"
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export default function OpeningHoursEditor({ slots, onChange }) {
  function updateSlot(index, field, value) {
    onChange(slots.map((slot, i) => (i === index ? { ...slot, [field]: value } : slot)));
  }

  function addSlot() {
    onChange([...slots, { day: 1, open: '09:00', close: '22:00' }]);
  }

  function removeSlot(index) {
    onChange(slots.filter((_, i) => i !== index));
  }

  return (
    <div>
      {slots.length === 0 && (
        <p className="mb-2 text-xs text-gray-500">No schedule set — the restaurant is treated as always open (subject to the switch above).</p>
      )}
      <div className="space-y-2">
        {slots.map((slot, index) => {
          const open = minutesToHHMM(slot.open);
          const close = minutesToHHMM(slot.close);
          return (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <select
              value={slot.day}
              onChange={(e) => updateSlot(index, 'day', Number(e.target.value))}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            >
              {DAYS.map((label, day) => (
                <option key={day} value={day}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="time"
              value={open}
              onChange={(e) => updateSlot(index, 'open', e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
            <span className="text-xs text-gray-400">to</span>
            <input
              type="time"
              value={close}
              onChange={(e) => updateSlot(index, 'close', e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
            {open && close && close <= open && <span className="text-xs text-gray-400">(overnight)</span>}
            <button type="button" onClick={() => removeSlot(index)} className="ml-auto text-gray-400 hover:text-red-600" aria-label="Remove slot">
              <Trash2 size={14} />
            </button>
          </div>
          );
        })}
      </div>
      <button type="button" onClick={addSlot} className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600">
        <Plus size={12} /> Add a time slot
      </button>
    </div>
  );
}
