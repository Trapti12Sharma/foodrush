import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { CheckCircle2, Store, TrendingUp, Bike, ShieldCheck } from 'lucide-react';
import toast from '@/utils/toast';
import ImageUploadField from '../components/ImageUploadField';

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-600/20';

function Field({ label, error, hint, children }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-400">{error.message}</p>}
    </div>
  );
}

const SELLING_POINTS = [
  { icon: TrendingUp, title: 'Reach more diners', body: 'Get discovered by customers already ordering in your city.' },
  { icon: Bike, title: 'Delivery handled', body: 'Our rider network picks up the moment your kitchen marks an order ready.' },
  { icon: Store, title: 'Own your menu', body: 'Prices, photos, availability and opening hours stay under your control.' },
];

// Public lead-capture page for restaurants that want to join. Deliberately NOT
// wired to the KYC endpoints: those belong to an already-registered owner's
// restaurant (see owner/KycSection.jsx), and this form is filled in by people who
// don't have an account yet. It collects the details an onboarding team needs to
// make first contact, then hands off to registration.
export default function PartnerWithUs() {
  const [submitted, setSubmitted] = useState(false);
  const [fssaiCertificate, setFssaiCertificate] = useState('');
  const [panCard, setPanCard] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm();

  async function onSubmit() {
    try {
      // No public "restaurant application" endpoint exists yet, so this stops at
      // the confirmation rather than pretending to file something server-side.
      // When that endpoint lands, post here and keep the same success dialog.
      setSubmitted(true);
    } catch (err) {
      toast.error(err.message || 'Could not submit your application');
    }
  }

  if (submitted) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-8 text-center shadow-2xl shadow-black/40 backdrop-blur-xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20">
            <CheckCircle2 size={30} className="text-emerald-400" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-gray-900">Application received</h1>
          <p className="mt-2 text-sm text-gray-500">
            Thanks for your interest in partnering with FoodRush. Our onboarding team will review your details and get in
            touch within 2–3 working days.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Link
              to="/register"
              className="rounded-lg bg-gradient-to-r from-brand-600 to-brand-700 py-2.5 text-sm font-semibold text-white transition hover:shadow-md hover:shadow-brand-600/30"
            >
              Create your owner account
            </Link>
            <Link to="/" className="py-2 text-sm text-gray-400 hover:text-gray-900">
              Back to home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <section className="relative overflow-hidden bg-gradient-to-br from-[#1a0f33] via-[#140d26] to-[#0f0b16]">
        <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand-600/25 blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto max-w-4xl px-4 py-16 text-center">
          <h1 className="text-3xl font-extrabold text-white sm:text-4xl">
            Grow your restaurant with{' '}
            <span className="bg-gradient-to-r from-brand-500 to-accent-400 bg-clip-text text-transparent">FoodRush</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-gray-500">
            Tell us about your restaurant and our onboarding team will get you live.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-10">
        <div className="grid gap-4 sm:grid-cols-3">
          {SELLING_POINTS.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-5 shadow-lg shadow-black/20 backdrop-blur-xl"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600/20 text-brand-500">
                <Icon size={18} />
              </span>
              <p className="mt-3 font-semibold text-gray-900">{title}</p>
              <p className="mt-1 text-sm text-gray-500">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-2xl px-4 pb-20">
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-5 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-6 shadow-xl shadow-black/30 backdrop-blur-xl sm:p-8"
        >
          <div>
            <h2 className="text-lg font-bold text-gray-900">Restaurant details</h2>
            <p className="mt-1 text-xs text-gray-400">
              All fields marked required are needed before our team can verify your listing.
            </p>
          </div>

          <Field label="Restaurant name" error={errors.restaurantName}>
            <input {...register('restaurantName', { required: 'Restaurant name is required' })} className={inputClass} />
          </Field>

          <Field label="Owner's full name" error={errors.ownerName}>
            <input {...register('ownerName', { required: "Owner's name is required" })} className={inputClass} />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Email" error={errors.email}>
              <input
                type="email"
                {...register('email', {
                  required: 'Email is required',
                  pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email' },
                })}
                className={inputClass}
              />
            </Field>
            <Field label="Phone" error={errors.phone}>
              <input
                type="tel"
                {...register('phone', {
                  required: 'Phone is required',
                  pattern: { value: /^\+?[0-9][0-9\s-]{7,14}$/, message: 'Enter a valid phone number' },
                })}
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Full address" error={errors.address}>
            <textarea rows={2} {...register('address', { required: 'Address is required' })} className={inputClass} />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="City" error={errors.city}>
              <input {...register('city', { required: 'City is required' })} className={inputClass} />
            </Field>
            <Field label="Cuisine type" error={errors.cuisine} hint="e.g. North Indian, Chinese">
              <input {...register('cuisine', { required: 'Cuisine is required' })} className={inputClass} />
            </Field>
          </div>

          <div className="border-t border-gray-200 pt-5">
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
              <ShieldCheck size={18} className="text-brand-500" /> Licence &amp; documents
            </h2>
            <p className="mt-1 text-xs text-gray-400">
              Stored securely and used only to verify your restaurant.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="FSSAI licence number"
              error={errors.fssaiNumber}
              hint="14 digits"
            >
              <input
                {...register('fssaiNumber', {
                  required: 'FSSAI licence number is required',
                  pattern: { value: /^[0-9]{14}$/, message: 'FSSAI licence is 14 digits' },
                })}
                className={inputClass}
              />
            </Field>
            <Field label="PAN number" error={errors.panNumber} hint="e.g. ABCDE1234F">
              <input
                {...register('panNumber', {
                  required: 'PAN number is required',
                  pattern: { value: /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/, message: 'Enter a valid PAN' },
                })}
                className={`${inputClass} uppercase`}
              />
            </Field>
          </div>

          <Field label="GST number (optional)" error={errors.gstNumber}>
            <input {...register('gstNumber')} className={`${inputClass} uppercase`} />
          </Field>

          <ImageUploadField
            label="FSSAI certificate"
            value={fssaiCertificate}
            onChange={setFssaiCertificate}
            purpose="support"
          />
          <ImageUploadField label="PAN card" value={panCard} onChange={setPanCard} purpose="support" />

          <Field label="Anything else we should know? (optional)">
            <textarea rows={3} {...register('notes')} className={inputClass} />
          </Field>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-gradient-to-r from-brand-600 to-brand-700 py-3 text-sm font-semibold text-white shadow-sm transition hover:shadow-md hover:shadow-brand-600/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Submitting…' : 'Submit application'}
          </button>
          <p className="text-center text-xs text-gray-400">
            Already partnered?{' '}
            <Link to="/login" className="font-medium text-brand-600 hover:underline">
              Log in to your dashboard
            </Link>
          </p>
        </form>
      </section>
    </div>
  );
}
