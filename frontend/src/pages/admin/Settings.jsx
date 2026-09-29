import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, RotateCcw } from 'lucide-react';
import { adminService } from '../../services/adminService';

// M17 — the platform settings console (SUPER_ADMIN only).
//
// Two things this screen takes seriously, because it edits money:
//
// 1. CONCURRENCY. Every save sends the `version` that was loaded. If a colleague
//    saved in the meantime the server returns 409, and rather than silently
//    discarding either person's work the form reloads and says so. The version is
//    held in the loaded settings object, never in a separate piece of state that
//    could drift from what is on screen.
//
// 2. THE TAX RATE IS A FRACTION, NOT A PERCENTAGE. The API stores 0.05 for 5%, and
//    the single most likely catastrophic typo here is entering "5" and taxing every
//    customer 500%. So the input is a PERCENT field (labelled %, stepped in 0.1)
//    that converts on the way in and out, and the live preview below it shows the
//    actual rupees added to a sample order.

const PRESET_SAMPLE_SUBTOTAL = 500;

function Section({ title, description, children }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {description && <p className="mt-1 text-xs text-gray-500">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, hint, suffix, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        {children}
        {suffix && <span className="text-xs text-gray-400">{suffix}</span>}
      </div>
      {hint && <span className="mt-1 block text-xs text-gray-400">{hint}</span>}
    </label>
  );
}

function NumberInput({ value, onChange, min, max, step = 1, disabled, className = '' }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400 ${className}`}
    />
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-brand-600" />
      <span className="text-xs font-medium text-gray-700">{label}</span>
    </label>
  );
}

// An empty string (a cleared input) must stay empty while typing rather than
// snapping to 0, so the value is kept as a string in form state and only
// converted at submit. Returns undefined for "leave this field alone".
function toNumber(raw) {
  if (raw === '' || raw === null || raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export default function Settings() {
  const [settings, setSettings] = useState(null); // the server's version, as loaded
  const [form, setForm] = useState(null); // the edited copy
  const [saving, setSaving] = useState(false);

  function hydrate(loaded) {
    setSettings(loaded);
    setForm({
      taxPercent: String(round4(loaded.pricing.taxRate * 100)),
      baseEarning: String(loaded.delivery.baseEarning),
      perKmRate: String(loaded.delivery.perKmRate),
      minEarning: String(loaded.delivery.minEarning),
      capEnabled: loaded.delivery.maxEarning !== null && loaded.delivery.maxEarning !== undefined,
      maxEarning: loaded.delivery.maxEarning === null || loaded.delivery.maxEarning === undefined ? '' : String(loaded.delivery.maxEarning),
      longEnabled: loaded.delivery.incentives.longDistance.enabled,
      longThresholdKm: String(loaded.delivery.incentives.longDistance.thresholdKm),
      longBonus: String(loaded.delivery.incentives.longDistance.bonusAmount),
      peakEnabled: loaded.delivery.incentives.peakHour.enabled,
      peakBonus: String(loaded.delivery.incentives.peakHour.bonusAmount),
      windows: loaded.delivery.incentives.peakHour.windows.map((w) => ({ ...w })),
    });
  }

  function load() {
    adminService
      .getSettings()
      .then(hydrate)
      .catch((err) => toast.error(err.message || 'Could not load settings'));
  }

  useEffect(load, []);

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function addWindow() {
    setForm((prev) => ({ ...prev, windows: [...prev.windows, { startHour: 18, endHour: 21 }] }));
  }

  function updateWindow(index, key, raw) {
    const n = Number(raw);
    setForm((prev) => ({
      ...prev,
      windows: prev.windows.map((w, i) => (i === index ? { ...w, [key]: Number.isFinite(n) ? n : 0 } : w)),
    }));
  }

  function removeWindow(index) {
    setForm((prev) => ({ ...prev, windows: prev.windows.filter((_, i) => i !== index) }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      // Only `version` is mandatory. Everything else is sent as-is and the server
      // ignores whatever did not actually change, so this is a full-form submit
      // that behaves as a patch.
      const payload = {
        version: settings.version,
        pricing: { taxRate: percentToRate(form.taxPercent) },
        delivery: {
          baseEarning: toNumber(form.baseEarning),
          perKmRate: toNumber(form.perKmRate),
          minEarning: toNumber(form.minEarning),
          // null is how a cap is REMOVED — distinct from a cap of 0, which is a
          // real (if cruel) cap the API also accepts.
          maxEarning: form.capEnabled ? toNumber(form.maxEarning) : null,
          incentives: {
            longDistance: {
              enabled: form.longEnabled,
              thresholdKm: toNumber(form.longThresholdKm),
              bonusAmount: toNumber(form.longBonus),
            },
            peakHour: {
              enabled: form.peakEnabled,
              bonusAmount: toNumber(form.peakBonus),
              windows: form.windows,
            },
          },
        },
      };
      const updated = await adminService.updateSettings(payload);
      hydrate(updated);
      toast.success('Settings saved');
    } catch (err) {
      if (err.status === 409) {
        // Someone else saved first. Reload rather than offering a "force" button:
        // overwriting a colleague's rate change without seeing it is exactly the
        // accident the version check exists to prevent.
        toast.error(err.message || 'Someone else changed these settings — reloaded with their values');
        load();
      } else {
        toast.error(err.errors?.[0]?.msg || err.message || 'Could not save settings');
      }
    } finally {
      setSaving(false);
    }
  }

  if (!form) return <p className="text-sm text-gray-500">Loading settings…</p>;

  const taxRate = percentToRate(form.taxPercent) ?? 0;
  const sampleTax = round2(PRESET_SAMPLE_SUBTOTAL * taxRate);

  return (
    <form onSubmit={save} className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Platform settings</h1>
          <p className="mt-1 text-xs text-gray-500">
            Changes apply to new orders and new deliveries only — nothing already placed or already paid is recalculated.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">v{settings.version}</span>
          <button type="button" onClick={load} className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            <RotateCcw size={14} /> Discard
          </button>
          <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </header>

      <Section title="Tax" description="Applied to the order subtotal at checkout.">
        <Field
          label="Tax rate"
          suffix="%"
          hint={`A ₹${PRESET_SAMPLE_SUBTOTAL} order would have ₹${sampleTax} of tax added. Stored as a fraction (${round4(taxRate)}); the maximum allowed is 50%.`}
        >
          <NumberInput value={form.taxPercent} onChange={(v) => set('taxPercent', v)} min={0} max={50} step={0.1} />
        </Field>
      </Section>

      <Section
        title="Delivery partner earnings"
        description="What a rider is paid per completed delivery. Each amount is recorded on the rider's earning at the moment of delivery, so later changes never rewrite a past payslip."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Base per delivery" suffix="₹">
            <NumberInput value={form.baseEarning} onChange={(v) => set('baseEarning', v)} min={0} max={10000} step={1} />
          </Field>
          <Field label="Per kilometre" suffix="₹/km" hint="Only paid when the order has a known delivery distance.">
            <NumberInput value={form.perKmRate} onChange={(v) => set('perKmRate', v)} min={0} max={1000} step={0.5} />
          </Field>
          <Field label="Minimum per delivery" suffix="₹" hint="A floor applied after incentives are added.">
            <NumberInput value={form.minEarning} onChange={(v) => set('minEarning', v)} min={0} max={10000} step={1} />
          </Field>
          <div>
            <Toggle checked={form.capEnabled} onChange={(v) => set('capEnabled', v)} label="Cap the maximum per delivery" />
            <div className="mt-2">
              <NumberInput
                value={form.maxEarning}
                onChange={(v) => set('maxEarning', v)}
                min={0}
                max={100000}
                step={1}
                disabled={!form.capEnabled}
              />
              <span className="ml-2 text-xs text-gray-400">{form.capEnabled ? '₹ — applied last, after the floor and incentives' : 'No cap'}</span>
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Rider incentives"
        description="Both rules are flat bonuses that add together, so a long late delivery earns both. Both are off unless you turn them on."
      >
        <div className="rounded-lg border border-gray-200 p-4">
          <Toggle checked={form.longEnabled} onChange={(v) => set('longEnabled', v)} label="Long-distance bonus" />
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Applies from" suffix="km">
              <NumberInput value={form.longThresholdKm} onChange={(v) => set('longThresholdKm', v)} min={0} max={500} step={0.5} disabled={!form.longEnabled} />
            </Field>
            <Field label="Bonus" suffix="₹">
              <NumberInput value={form.longBonus} onChange={(v) => set('longBonus', v)} min={0} max={10000} step={1} disabled={!form.longEnabled} />
            </Field>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 p-4">
          <Toggle checked={form.peakEnabled} onChange={(v) => set('peakEnabled', v)} label="Peak-hour bonus" />
          <p className="mt-1 text-xs text-gray-400">
            Paid when the delivery is <strong>completed</strong> inside a window. Hours are UTC and the end hour is exclusive. A window may run past
            midnight — 22 to 2 means 22:00 until 01:59.
          </p>
          <div className="mt-3">
            <Field label="Bonus" suffix="₹">
              <NumberInput value={form.peakBonus} onChange={(v) => set('peakBonus', v)} min={0} max={10000} step={1} disabled={!form.peakEnabled} />
            </Field>
          </div>

          <div className="mt-4 space-y-2">
            {form.windows.length === 0 && (
              <p className="text-xs text-gray-400">
                No windows yet.{form.peakEnabled ? ' Add at least one — the bonus cannot be enabled without a window.' : ''}
              </p>
            )}
            {form.windows.map((w, i) => (
              <div key={i} className="flex items-center gap-2"> {/* eslint-disable-line react/no-array-index-key */}
                <NumberInput value={w.startHour} onChange={(v) => updateWindow(i, 'startHour', v)} min={0} max={23} step={1} disabled={!form.peakEnabled} className="w-20" />
                <span className="text-xs text-gray-400">to</span>
                <NumberInput value={w.endHour} onChange={(v) => updateWindow(i, 'endHour', v)} min={0} max={23} step={1} disabled={!form.peakEnabled} className="w-20" />
                <span className="text-xs text-gray-400">UTC{w.startHour === w.endHour ? ' — start and end must differ' : ''}</span>
                <button type="button" onClick={() => removeWindow(i)} className="ml-auto text-gray-400 hover:text-red-600" aria-label="Remove window">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {form.windows.length < 8 && (
              <button type="button" onClick={addWindow} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
                <Plus size={14} /> Add window
              </button>
            )}
          </div>
        </div>
      </Section>

      {settings.updatedAt && (
        <p className="text-xs text-gray-400">
          Last changed {new Date(settings.updatedAt).toLocaleString()}. Every change is recorded in the audit log.
        </p>
      )}
    </form>
  );
}

// Percent <-> fraction conversion, kept next to each other so the two can never
// drift. round4 exists because 8.1 / 100 is 0.08099999999999999 in floating point,
// which would then be stored and shown back as a subtly different rate.
function round2(n) {
  return Math.round(n * 100) / 100;
}
function round4(n) {
  return Math.round(n * 10000) / 10000;
}
function percentToRate(percent) {
  const n = Number(percent);
  if (percent === '' || !Number.isFinite(n)) return undefined;
  return round4(n / 100);
}
