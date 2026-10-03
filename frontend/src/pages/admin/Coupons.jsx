import { useEffect, useState } from 'react';
import toast from '@/utils/toast';
import { Plus, Tag } from 'lucide-react';
import { adminService } from '../../services/adminService';
import CouponForm from '../../components/CouponForm';
import EmptyState from '../../components/EmptyState';
import Pagination from '../../components/Pagination';

const PAGE_SIZE = 10;

export default function Coupons() {
  const [coupons, setCoupons] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  function load() {
    setLoading(true);
    adminService
      .listCoupons({ page, limit: PAGE_SIZE })
      .then((res) => {
        setCoupons(res.coupons);
        setPagination(res.pagination || null);
      })
      .catch((err) => toast.error(err.message || 'Could not load coupons'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(payload) {
    setSubmitting(true);
    try {
      await adminService.createCoupon(payload);
      toast.success('Coupon created');
      setCreating(false);
      setPage(1);
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
        <div className="mt-6 overflow-hidden rounded-2xl border border-brand-300/20 shadow-xl shadow-black/30">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Discount</th>
                  <th>Min order</th>
                  <th>Scope</th>
                  <th>Usage</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {coupons.map((coupon) => (
                  <tr key={coupon._id}>
                    <td className="font-bold tracking-wide text-gray-900">{coupon.code}</td>
                    <td>
                      {coupon.discountType === 'PERCENTAGE' ? `${coupon.discountValue}%` : `₹${coupon.discountValue}`}
                    </td>
                    <td>₹{coupon.minimumOrder}</td>
                    <td>
                      {coupon.restaurant ? 'One restaurant' : coupon.city ? coupon.city : 'All'}
                      {coupon.perUserLimit ? ` · ${coupon.perUserLimit}/user` : ''}
                    </td>
                    <td>
                      {coupon.usedCount}{coupon.usageLimit ? ` / ${coupon.usageLimit}` : ''}
                    </td>
                    <td>{new Date(coupon.expiryDate).toLocaleDateString()}</td>
                    <td>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${coupon.isActive ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' : 'bg-white/10 text-gray-500 ring-white/15'}`}>
                        {coupon.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        disabled={busyId === coupon._id}
                        onClick={() => toggleActive(coupon)}
                        className={coupon.isActive ? 'table-action-btn-danger' : 'table-action-btn-success'}
                      >
                        {coupon.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination meta={pagination} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
