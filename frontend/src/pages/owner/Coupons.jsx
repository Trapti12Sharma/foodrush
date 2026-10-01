import { useEffect, useState } from 'react';
import toast from '@/utils/toast';
import { Plus, Tag } from 'lucide-react';
import { useRestaurantOwner } from '../../context/RestaurantOwnerContext';
import { restaurantService } from '../../services/restaurantService';
import OwnCouponForm from '../../components/OwnCouponForm';
import EmptyState from '../../components/EmptyState';

export default function Coupons() {
  const { selectedRestaurant } = useRestaurantOwner();
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  function load() {
    if (!selectedRestaurant) return;
    setLoading(true);
    restaurantService
      .listCoupons(selectedRestaurant._id, { limit: 100 })
      .then((res) => setCoupons(res.coupons))
      .catch((err) => toast.error(err.message || 'Could not load coupons'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [selectedRestaurant]);

  async function handleCreate(payload) {
    setSubmitting(true);
    try {
      await restaurantService.createCoupon(selectedRestaurant._id, payload);
      toast.success('Coupon created — customers will see it at checkout');
      setCreating(false);
      load();
    } catch (err) {
      toast.error(err.message || 'Could not create coupon');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(coupon) {
    setBusyId(coupon._id);
    try {
      await restaurantService.updateCoupon(selectedRestaurant._id, coupon._id, { isActive: !coupon.isActive });
      load();
    } catch (err) {
      toast.error(err.message || 'Could not update coupon');
    } finally {
      setBusyId(null);
    }
  }

  if (!selectedRestaurant) return null;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Coupons</h1>
          <p className="mt-1 text-sm text-gray-500">Discounts customers can apply at checkout — funded by you, for this restaurant only.</p>
        </div>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus size={16} /> Create coupon
          </button>
        )}
      </div>

      {creating && (
        <div className="mt-4">
          <OwnCouponForm onSubmit={handleCreate} submitting={submitting} />
          <button type="button" onClick={() => setCreating(false)} className="mt-2 text-xs text-gray-400 hover:text-gray-600">
            Cancel
          </button>
        </div>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-gray-400">Loading…</p>
      ) : coupons.length === 0 && !creating ? (
        <EmptyState icon={Tag} title="No coupons yet" description="Create one to offer a discount at your restaurant." />
      ) : (
        <div className="mt-6 space-y-3">
          {coupons.map((coupon) => (
            <div key={coupon._id} className="rounded-xl border border-gray-200 bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm font-semibold text-gray-900">{coupon.code}</p>
                  {coupon.description && <p className="mt-0.5 text-xs text-gray-400">{coupon.description}</p>}
                  <p className="mt-1.5 text-sm text-gray-600">
                    {coupon.discountType === 'PERCENTAGE' ? `${coupon.discountValue}% off` : `₹${coupon.discountValue} off`}
                    {coupon.minimumOrder > 0 ? ` · min order ₹${coupon.minimumOrder}` : ''}
                    {coupon.maximumDiscount ? ` · capped at ₹${coupon.maximumDiscount}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    Used {coupon.usedCount}{coupon.usageLimit ? ` / ${coupon.usageLimit}` : ' times'}
                    {coupon.perUserLimit ? ` · ${coupon.perUserLimit} per customer` : ''} · expires{' '}
                    {new Date(coupon.expiryDate).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                      coupon.isActive
                        ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'
                        : 'bg-white/10 text-gray-500 ring-white/15'
                    }`}
                  >
                    {coupon.isActive ? 'Active' : 'Inactive'}
                  </span>
                  <button
                    type="button"
                    disabled={busyId === coupon._id}
                    onClick={() => toggleActive(coupon)}
                    className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50"
                  >
                    {coupon.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
