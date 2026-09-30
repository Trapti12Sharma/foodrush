import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from '@/utils/toast';
import { authService } from '../services/authService';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm();

  async function onSubmit({ password }) {
    try {
      const message = await authService.resetPassword({ token, password });
      toast.success(message || 'Password reset. Please log in.');
      navigate('/login', { replace: true });
    } catch (err) {
      toast.error(err.message || 'This reset link is invalid or has expired');
    }
  }

  if (!/^[a-f0-9]{64}$/.test(token)) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12 text-center">
        <h1 className="text-2xl font-bold text-gray-900">This reset link isn&apos;t valid</h1>
        <p className="mt-2 text-sm text-gray-500">It may be incomplete, already used, or expired. Request a new one.</p>
        <Link to="/forgot-password" className="mt-6 text-sm font-medium text-brand-600 hover:underline">
          Send me a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12">
      <h1 className="text-2xl font-bold text-gray-900">Choose a new password</h1>
      <p className="mt-1 text-sm text-gray-500">You&apos;ll be signed out everywhere and asked to log in again.</p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">New password</label>
          <input
            type="password"
            autoComplete="new-password"
            {...register('password', {
              required: 'Password is required',
              minLength: { value: 8, message: 'At least 8 characters' },
              maxLength: { value: 72, message: 'At most 72 characters' },
            })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Confirm new password</label>
          <input
            type="password"
            autoComplete="new-password"
            {...register('confirmPassword', {
              required: 'Please confirm your password',
              validate: (value) => value === watch('password') || 'Passwords do not match',
            })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          {errors.confirmPassword && <p className="mt-1 text-xs text-red-600">{errors.confirmPassword.message}</p>}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Saving…' : 'Reset password'}
        </button>
      </form>
    </div>
  );
}
