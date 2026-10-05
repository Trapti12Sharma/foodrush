import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from '@/utils/toast';
import { useAuth } from '../context/AuthContext';
import { landingPathFor } from '../constants/roles';
import AnimatedBurger from '../components/food/AnimatedBurger';
import AnimatedFries from '../components/food/AnimatedFries';

const SIGNUP_ROLES = ['CUSTOMER', 'RESTAURANT_OWNER', 'DELIVERY_PARTNER'];

export default function Register() {
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();
  // Lets the "Deliver with us" / "Partner with us" pages drop people straight
  // into the right kind of sign-up. Ignored unless it names a real signup role,
  // so a hand-edited URL can't ask for, say, an admin account.
  const [searchParams] = useSearchParams();
  const requestedRole = searchParams.get('role');
  const defaultRole = SIGNUP_ROLES.includes(requestedRole) ? requestedRole : 'CUSTOMER';
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm();

  async function onSubmit(values) {
    try {
      const { confirmPassword, ...payload } = values;
      const newUser = await registerUser(payload);
      toast.success('Account created — welcome to FoodRush!');
      // Customers land on the storefront; owners and riders go straight to the
      // console where their next step (create a restaurant / submit rider
      // details) actually lives.
      navigate(landingPathFor(newUser), { replace: true });
    } catch (err) {
      toast.error(err.message || 'Could not create your account');
    }
  }

  return (
    <div className="relative flex min-h-[80vh] items-center justify-center overflow-hidden bg-gradient-to-br from-[#1a0f33] via-[#140d26] to-[#0f0b16] px-4 py-12">
      <AnimatedBurger size="md" className="absolute right-[8%] top-[12%] hidden opacity-70 lg:block" />
      <AnimatedFries size="sm" className="absolute bottom-[10%] left-[10%] hidden opacity-60 lg:block" />
      <div className="relative w-full max-w-md rounded-2xl border border-gray-100 bg-surface p-8 shadow-2xl shadow-black/40">
        <Link to="/" className="text-xl font-extrabold tracking-tight">
          <span className="bg-gradient-to-r from-brand-500 to-brand-700 bg-clip-text text-transparent">Food</span>
          <span className="text-gray-900">Rush</span>
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-gray-900">Create your account</h1>
        <p className="mt-1 text-sm text-gray-500">Order food, or list your restaurant on FoodRush.</p>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Full name</label>
            <input
              {...register('name', { required: 'Name is required' })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
          </div>

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
            <label className="mb-1 block text-sm font-medium text-gray-700">Phone (optional)</label>
            <input
              {...register('phone')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">I want to</label>
            <select
              {...register('role')}
              defaultValue={defaultRole}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              <option value="CUSTOMER">Order food</option>
              <option value="RESTAURANT_OWNER">List my restaurant</option>
              <option value="DELIVERY_PARTNER">Deliver for FoodRush</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Password</label>
            <input
              type="password"
              {...register('password', {
                required: 'Password is required',
                minLength: { value: 8, message: 'Password must be at least 8 characters' },
              })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Confirm password</label>
            <input
              type="password"
              {...register('confirmPassword', {
                required: 'Please confirm your password',
                validate: (value) => value === watch('password') || 'Passwords do not match',
              })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            {errors.confirmPassword && <p className="mt-1 text-xs text-red-600">{errors.confirmPassword.message}</p>}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-gradient-to-r from-brand-600 to-brand-700 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:shadow-md hover:shadow-brand-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
