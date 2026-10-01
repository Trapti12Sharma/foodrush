import { useForm } from 'react-hook-form';

// The restaurant-owner counterpart to CouponForm (admin's version). Deliberately
// does NOT expose `city` or `fundedBy` — a coupon an owner creates is always
// scoped to their own restaurant and always funded by them (enforced server-side
// in coupon.service.js#createForRestaurant regardless of what a client sends),
// so showing those fields here would just invite an owner to configure
// something the server silently overrides.
export default function OwnCouponForm({ onSubmit, submitting }) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({ defaultValues: { discountType: 'PERCENTAGE' } });
  const discountType = watch('discountType');

  function submit(values) {
    onSubmit({
      code: values.code,
      description: values.description,
      discountType: values.discountType,
      discountValue: Number(values.discountValue),
      minimumOrder: Number(values.minimumOrder) || 0,
      maximumDiscount: values.maximumDiscount ? Number(values.maximumDiscount) : undefined,
      expiryDate: new Date(values.expiryDate).toISOString(),
      usageLimit: values.usageLimit ? Number(values.usageLimit) : undefined,
      perUserLimit: values.perUserLimit ? Number(values.perUserLimit) : undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-3 rounded-xl border border-gray-200 bg-surface p-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Code</label>
          <input {...register('code', { required: true })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm uppercase" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Expiry date</label>
          <input type="date" {...register('expiryDate', { required: true })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Description (optional)</label>
        <input {...register('description')} placeholder="Shown to customers alongside the code" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Discount type</label>
          <select {...register('discountType')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="PERCENTAGE">Percentage</option>
            <option value="FLAT">Flat amount</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Discount value {discountType === 'PERCENTAGE' ? '(%)' : '(₹)'}</label>
          <input type="number" {...register('discountValue', { required: true, min: 0 })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Min order (₹)</label>
          <input type="number" {...register('minimumOrder', { min: 0 })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        {discountType === 'PERCENTAGE' && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Max discount (₹)</label>
            <input type="number" {...register('maximumDiscount', { min: 0 })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Usage limit</label>
          <input type="number" {...register('usageLimit', { min: 1 })} placeholder="Unlimited" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Per-customer limit</label>
        <input
          type="number"
          {...register('perUserLimit', { min: 1 })}
          placeholder="Unlimited"
          className="w-full max-w-[12rem] rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <p className="text-xs text-gray-400">
        This coupon will only ever apply at your own restaurant, and the discount comes out of your own margin, not the platform's.
      </p>
      {(errors.code || errors.discountValue || errors.expiryDate) && (
        <p className="text-xs text-red-600">Please fill in code, discount value, and a future expiry date.</p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {submitting ? 'Creating…' : 'Create coupon'}
      </button>
    </form>
  );
}
