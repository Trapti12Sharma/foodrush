import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import toast from '@/utils/toast';
import { useAuth } from '../context/AuthContext';
import { landingPathFor } from '../constants/roles';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm();

  async function onSubmit(values) {
    try {
      const user = await login(values);
      toast.success('Logged in successfully');
      // A deep link they were bounced off wins; otherwise send staff to their own
      // console rather than the customer storefront.
      navigate(location.state?.from?.pathname || landingPathFor(user), { replace: true });
    } catch (err) {
      toast.error(err.message || 'Invalid email or password');
    }
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center bg-gradient-to-br from-[#1a0f33] via-[#140d26] to-[#0f0b16] px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-surface p-8 shadow-2xl shadow-black/40">
        <Link to="/" className="text-xl font-extrabold tracking-tight">
          <span className="bg-gradient-to-r from-brand-500 to-brand-700 bg-clip-text text-transparent">Food</span>
          <span className="text-gray-900">Rush</span>
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-gray-900">Welcome back</h1>
        <p className="mt-1 text-sm text-gray-500">Log in to order from your favorite restaurants.</p>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              {...register('email', { required: 'Email is required' })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">Password</label>
              <Link to="/forgot-password" className="text-xs font-medium text-brand-600 hover:underline">
                Forgot password?
              </Link>
            </div>
            <input
              type="password"
              {...register('password', { required: 'Password is required' })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-gradient-to-r from-brand-600 to-brand-700 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:shadow-md hover:shadow-brand-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          New to FoodRush?{' '}
          <Link to="/register" className="font-medium text-brand-600 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
