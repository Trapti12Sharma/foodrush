import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Tag } from 'lucide-react';
import { adminService } from '../../services/adminService';
import CouponForm from '../../components/CouponForm';
import EmptyState from '../../components/EmptyState';

export default function Coupons() {
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  function load() {
    setLoading(true);
    adminService
      .listCoupons({ limit: 100 })
      .then((res) => setCoupons(res.coupons))
      .catch((err) => toast.error(err.message || 'Could not load coupons'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCreate(payload) {
    setSubmitting(true);
    try {
      await adminService.createCoupon(payload);
      toast.success('Coupon created');
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
      await adminService.updateCoupon(coupon._id, { isActive: !coupon.isActive });
      load();
    } catch (err) {
      toast.error(err.message || 'Could not update coupon');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Coupons</h1>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus size={16} /> Create coupon
          </button>
        )}
      </div>

      {creating && (
        <div className="mt-4">
          <CouponForm onSubmit={handleCreate} submitting={submitting} />
        </div>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-gray-400">Loading…</p>
      ) : coupons.length === 0 && !creating ? (
        <EmptyState icon={Tag} title="No coupons yet" description="Create one to offer discounts at checkout." />
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 text-left text-xs uppercase text-gray-400">
              <tr>
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Discount</th>
                <th className="px-4 py-2">Min order</th>
                <th className="px-4 py-2">Usage</th>
                <th className="px-4 py-2">Expires</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {coupons.map((coupon) => (
                <tr key={coupon._id}>
                  <td className="px-4 py-2.5 font-medium text-gray-900">{coupon.code}</td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {coupon.discountType === 'PERCENTAGE' ? `${coupon.discountValue}%` : `₹${coupon.discountValue}`}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">₹{coupon.minimumOrder}</td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {coupon.usedCount}{coupon.usageLimit ? ` / ${coupon.usageLimit}` : ''}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{new Date(coupon.expiryDate).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${coupon.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {coupon.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      disabled={busyId === coupon._id}
                      onClick={() => toggleActive(coupon)}
                      className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50"
                    >
                      {coupon.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
