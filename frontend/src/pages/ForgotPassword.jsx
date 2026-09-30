import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import toast from '@/utils/toast';
import { MailCheck } from 'lucide-react';
import { authService } from '../services/authService';

export default function ForgotPassword() {
  const [sentMessage, setSentMessage] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm();

  async function onSubmit({ email }) {
    try {
      // The server answers identically whether or not the email is registered, and so does this page.
      setSentMessage(await authService.forgotPassword(email));
    } catch (err) {
      toast.error(err.message || 'Could not send the reset link. Please try again.');
    }
  }

  if (sentMessage) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12 text-center">
        <MailCheck size={40} className="mx-auto text-brand-600" />
        <h1 className="mt-4 text-2xl font-bold text-gray-900">Check your email</h1>
        <p className="mt-2 text-sm text-gray-500">{sentMessage}</p>
        <p className="mt-1 text-sm text-gray-500">The link works for 30 minutes and can be used once.</p>
        <Link to="/login" className="mt-6 text-sm font-medium text-brand-600 hover:underline">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12">
      <h1 className="text-2xl font-bold text-gray-900">Forgot your password?</h1>
      <p className="mt-1 text-sm text-gray-500">Enter your account email and we&apos;ll send you a link to reset it.</p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
          <input
            type="email"
            autoComplete="email"
            {...register('email', { required: 'Email is required' })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Sending…' : 'Send reset link'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        Remembered it?{' '}
        <Link to="/login" className="font-medium text-brand-600 hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
