import { Link } from 'react-router-dom';
import { Bike, IndianRupee, Clock, ShieldCheck, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const BENEFITS = [
  { icon: IndianRupee, title: 'Earn per delivery', body: 'Every completed trip is recorded, with settlements you can track from your dashboard.' },
  { icon: Clock, title: 'Ride when you want', body: 'Go online and offline yourself — offers only reach you while you are available.' },
  { icon: Bike, title: 'Deliveries come to you', body: 'Orders are offered to nearby riders automatically when a kitchen marks food ready.' },
];

const STEPS = [
  { n: 1, title: 'Create your rider account', body: 'Sign up and pick "Deliver for FoodRush" as your role.' },
  { n: 2, title: 'Submit your details', body: 'Your name, vehicle type and number, plus your KYC documents.' },
  { n: 3, title: 'We verify you', body: 'Our team reviews your documents and approves your account.' },
  { n: 4, title: 'Go online and earn', body: 'Once verified, switch yourself online and start accepting delivery offers.' },
];

// Public entry point for riders. Deliberately a funnel, NOT a second application
// form: the real one already exists behind sign-in (DeliveryPartnerLayout's
// onboarding step), it posts to POST /delivery-partners, and what it creates is
// exactly what admins review under Admin -> Delivery partners. Duplicating it
// here would create a second, unreviewed intake path for the same data.
export default function DeliverWithUs() {
  const { user } = useAuth();

  // Riders who already signed up are sent to the real form rather than being
  // asked to "register" a second time.
  const isRider = user?.role === 'DELIVERY_PARTNER';
  const ctaTo = isRider ? '/delivery/dashboard' : '/register?role=DELIVERY_PARTNER';
  const ctaLabel = isRider ? 'Go to your rider dashboard' : 'Start your application';

  return (
    <div>
      <section className="relative overflow-hidden bg-gradient-to-br from-[#1a0f33] via-[#140d26] to-[#0f0b16]">
        <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand-600/25 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -right-20 top-6 h-64 w-64 rounded-full bg-accent-500/15 blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto max-w-4xl px-4 py-16 text-center sm:py-20">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-gray-500">
            <Bike size={13} /> Delivery partners
          </span>
          <h1 className="mt-4 text-3xl font-extrabold text-white sm:text-4xl">
            Ride with{' '}
            <span className="bg-gradient-to-r from-brand-500 to-accent-400 bg-clip-text text-transparent">FoodRush</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-gray-500">
            Deliver food in your city on your own schedule. Sign up, get verified, and start accepting orders.
          </p>
          <Link
            to={ctaTo}
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-600 to-brand-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:shadow-md hover:shadow-brand-600/30"
          >
            {ctaLabel} <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-10">
        <div className="grid gap-4 sm:grid-cols-3">
          {BENEFITS.map(({ icon: Icon, title, body }) => (
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

      <section className="mx-auto max-w-3xl px-4 pb-16">
        <h2 className="text-lg font-bold text-gray-900">How it works</h2>
        <ol className="mt-4 space-y-3">
          {STEPS.map((step) => (
            <li
              key={step.n}
              className="flex gap-4 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-4 shadow-lg shadow-black/20 backdrop-blur-xl"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
                {step.n}
              </span>
              <div>
                <p className="font-semibold text-gray-900">{step.title}</p>
                <p className="mt-0.5 text-sm text-gray-500">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-6 flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm text-gray-500">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-brand-500" />
          <p>
            You&apos;ll be asked for KYC documents during sign-up. They&apos;re reviewed by our operations team and are
            only used to verify your identity and vehicle.
          </p>
        </div>

        <div className="mt-8 text-center">
          <Link
            to={ctaTo}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-600 to-brand-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:shadow-md hover:shadow-brand-600/30"
          >
            {ctaLabel} <ArrowRight size={16} />
          </Link>
          <p className="mt-3 text-xs text-gray-400">
            Already a partner?{' '}
            <Link to="/login" className="font-medium text-brand-600 hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
