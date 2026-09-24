import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { MapPinned } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authService } from '../services/authService';
import { notificationService } from '../services/notificationService';
import ImageUploadField from '../components/ImageUploadField';

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500 disabled:bg-gray-50';

function Field({ label, error, children }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error.message}</p>}
    </div>
  );
}

function ProfileForm() {
  const { user, updateUser } = useAuth();
  const [avatar, setAvatar] = useState(user.avatar || '');
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { name: user.name, phone: user.phone || '', email: user.email, currentPassword: '' } });

  const emailChanged = watch('email')?.trim().toLowerCase() !== user.email;

  async function onSubmit(values) {
    const payload = { name: values.name, phone: values.phone || '', avatar };
    if (emailChanged) {
      payload.email = values.email;
      payload.currentPassword = values.currentPassword;
    }
    try {
      const updated = await authService.updateProfile(payload);
      updateUser(updated);
      reset({ name: updated.name, phone: updated.phone || '', email: updated.email, currentPassword: '' });
      toast.success('Profile updated');
    } catch (err) {
      toast.error(err.message || 'Could not update your profile');
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">Your details</h2>

      <ImageUploadField label="Profile photo" value={avatar} onChange={setAvatar} purpose="avatar" />

      <Field label="Full name" error={errors.name}>
        <input
          {...register('name', { required: 'Name is required', maxLength: { value: 100, message: 'At most 100 characters' } })}
          className={inputClass}
        />
      </Field>

      <Field label="Phone" error={errors.phone}>
        <input
          type="tel"
          placeholder="+91 98765 43210"
          {...register('phone', { pattern: { value: /^(\+?[0-9][0-9\s-]{6,14})?$/, message: 'Enter a valid phone number' } })}
          className={inputClass}
        />
      </Field>

      <Field label="Email" error={errors.email}>
        <input
          type="email"
          {...register('email', { required: 'Email is required' })}
          className={inputClass}
        />
      </Field>

      {emailChanged && (
        <Field label="Current password (needed to change your email)" error={errors.currentPassword}>
          <input
            type="password"
            autoComplete="current-password"
            {...register('currentPassword', { required: 'Enter your current password' })}
            className={inputClass}
          />
        </Field>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}

function PasswordForm() {
  const { updateUser } = useAuth();
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm();

  async function onSubmit({ currentPassword, newPassword }) {
    try {
      // The server signs out every other device and re-issues this device's session.
      updateUser(await authService.changePassword({ currentPassword, newPassword }));
      reset();
      toast.success('Password changed. Other devices were signed out.');
    } catch (err) {
      toast.error(err.message || 'Could not change your password');
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">Change password</h2>

      <Field label="Current password" error={errors.currentPassword}>
        <input
          type="password"
          autoComplete="current-password"
          {...register('currentPassword', { required: 'Enter your current password' })}
          className={inputClass}
        />
      </Field>

      <Field label="New password" error={errors.newPassword}>
        <input
          type="password"
          autoComplete="new-password"
          {...register('newPassword', {
            required: 'Enter a new password',
            minLength: { value: 8, message: 'At least 8 characters' },
            maxLength: { value: 72, message: 'At most 72 characters' },
          })}
          className={inputClass}
        />
      </Field>

      <Field label="Confirm new password" error={errors.confirmPassword}>
        <input
          type="password"
          autoComplete="new-password"
          {...register('confirmPassword', {
            required: 'Please confirm your new password',
            validate: (value) => value === watch('newPassword') || 'Passwords do not match',
          })}
          className={inputClass}
        />
      </Field>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Updating…' : 'Update password'}
        </button>
        <Link to="/forgot-password" className="text-xs font-medium text-brand-600 hover:underline">
          Forgot your current password?
        </Link>
      </div>
    </form>
  );
}

const PREFERENCE_LABELS = [
  { key: 'orderUpdates', label: 'Order updates', description: 'Placed, confirmed, ready, out for delivery, delivered' },
  { key: 'paymentUpdates', label: 'Payment & refund updates', description: 'Payment success/failure, refund progress' },
  { key: 'deliveryUpdates', label: 'Delivery updates', description: 'Assignment, delivery OTP, earnings & settlements' },
  { key: 'supportUpdates', label: 'Support ticket updates', description: 'Replies, assignment, resolution' },
  { key: 'marketing', label: 'Marketing', description: 'Off by default — FoodRush does not send marketing email yet' },
];

// Controls the EMAIL channel only — in-app notifications (the bell) are always
// on, and ACCOUNT_SECURITY/SYSTEM notifications are never affected by any of
// these (see backend/src/utils/constants.js NOTIFICATION_PREFERENCE_FIELD).
function NotificationPreferencesForm() {
  const [preferences, setPreferences] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    notificationService
      .getPreferences()
      .then(setPreferences)
      .catch(() => toast.error('Could not load notification preferences'));
  }, []);

  async function toggle(key) {
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next); // optimistic
    setSaving(true);
    try {
      await notificationService.updatePreferences({ [key]: next[key] });
    } catch (err) {
      setPreferences(preferences); // revert
      toast.error(err.message || 'Could not update preference');
    } finally {
      setSaving(false);
    }
  }

  if (!preferences) return null;

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">Email notifications</h2>
      <p className="text-xs text-gray-500">You'll always see these in your notification bell — this only controls what's also emailed to you.</p>
      <div className="divide-y divide-gray-100">
        {PREFERENCE_LABELS.map(({ key, label, description }) => (
          <div key={key} className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium text-gray-800">{label}</p>
              <p className="text-xs text-gray-400">{description}</p>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() => toggle(key)}
              aria-label={`Toggle ${label}`}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${preferences[key] ? 'bg-brand-600' : 'bg-gray-200'}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${preferences[key] ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Profile() {
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Your profile</h1>
        <p className="mt-1 text-sm capitalize text-gray-500">{user.role.replace(/_/g, ' ').toLowerCase()}</p>
      </div>

      <ProfileForm />
      <PasswordForm />
      <NotificationPreferencesForm />

      <Link
        to="/profile/addresses"
        className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-4 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
      >
        <MapPinned size={16} className="text-brand-600" /> Manage saved addresses
      </Link>
    </div>
  );
}
