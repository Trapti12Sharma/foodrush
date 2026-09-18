import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, Tag, X } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { addressService } from '../services/addressService';
import { orderService } from '../services/orderService';
import { configService } from '../services/configService';
import AddressCard from '../components/AddressCard';
import AddressForm from '../components/AddressForm';
import EmptyState from '../components/EmptyState';

function Row({ label, value, emphasis }) {
  return (
    <div className={`flex justify-between text-sm ${emphasis ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
      <span>{label}</span>
      <span>₹{value.toFixed(2)}</span>
    </div>
  );
}

export default function Checkout() {
  const { cart, loading: cartLoading, applyCoupon, removeCoupon, refresh } = useCart();
  const navigate = useNavigate();

  const [addresses, setAddresses] = useState([]);
  const [addressesLoading, setAddressesLoading] = useState(true);
  const [selectedAddressId, setSelectedAddressId] = useState(null);
  const [addingAddress, setAddingAddress] = useState(false);
  const [addressSubmitting, setAddressSubmitting] = useState(false);

  const [couponInput, setCouponInput] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);

  const [onlinePaymentsEnabled, setOnlinePaymentsEnabled] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('COD');
  const [placing, setPlacing] = useState(false);

  function loadAddresses() {
    setAddressesLoading(true);
    addressService
      .list()
      .then((list) => {
        setAddresses(list);
        setSelectedAddressId((prev) => prev || list.find((a) => a.isDefault)?._id || list[0]?._id || null);
      })
      .catch((err) => toast.error(err.message || 'Could not load addresses'))
      .finally(() => setAddressesLoading(false));
  }

  useEffect(loadAddresses, []);
  useEffect(() => {
    configService
      .get()
      .then((cfg) => setOnlinePaymentsEnabled(cfg.onlinePaymentsEnabled))
      .catch(() => setOnlinePaymentsEnabled(false));
  }, []);

  useEffect(() => {
    if (!cartLoading && cart.items.length === 0) {
      navigate('/cart', { replace: true });
    }
  }, [cartLoading, cart.items.length, navigate]);

  async function handleAddAddress(values) {
    setAddressSubmitting(true);
    try {
      const created = await addressService.create(values);
      toast.success('Address added');
      setAddingAddress(false);
      loadAddresses();
      setSelectedAddressId(created._id);
    } catch (err) {
      toast.error(err.message || 'Could not add address');
    } finally {
      setAddressSubmitting(false);
    }
  }

  async function handleApplyCoupon() {
    if (!couponInput.trim()) return;
    setCouponBusy(true);
    try {
      await applyCoupon(couponInput.trim());
      toast.success('Coupon applied');
    } catch (err) {
      toast.error(err.message || 'Invalid coupon');
    } finally {
      setCouponBusy(false);
    }
  }

  async function handleRemoveCoupon() {
    setCouponBusy(true);
    try {
      await removeCoupon();
      setCouponInput('');
    } catch (err) {
      toast.error(err.message || 'Could not remove coupon');
    } finally {
      setCouponBusy(false);
    }
  }

  async function handlePlaceOrder() {
    if (!selectedAddressId) {
      toast.error('Please select a delivery address');
      return;
    }
    setPlacing(true);
    try {
      const order = await orderService.create({ addressId: selectedAddressId, paymentMethod });
      toast.success('Order placed successfully');
      // Navigate away first, THEN refresh the (now-empty) cart in the background.
      // Awaiting refresh() before navigating let this component re-render with an
      // empty cart while still mounted, which fires its own "cart is empty ->
      // redirect to /cart" effect — a race that could overwrite this navigation
      // to the order confirmation page with a bounce back to /cart.
      navigate(`/orders/${order._id}`);
      refresh();
    } catch (err) {
      toast.error(err.message || 'Could not place your order');
    } finally {
      setPlacing(false);
    }
  }

  if (cartLoading || cart.items.length === 0) {
    return <div className="py-24 text-center text-gray-400">Loading checkout…</div>;
  }

  const belowMinimum = cart.restaurant && cart.subtotal < cart.restaurant.minimumOrder;
  const restaurantClosed = cart.restaurant && !cart.restaurant.isOpen;
  const canPlaceOrder = !belowMinimum && !restaurantClosed && !!selectedAddressId && !placing;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Checkout</h1>

      {/* Step 1: Address */}
      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">1. Delivery address</h2>
        {addressesLoading ? (
          <p className="text-sm text-gray-400">Loading addresses…</p>
        ) : addresses.length === 0 && !addingAddress ? (
          <EmptyState title="No saved addresses" description="Add a delivery address to continue." />
        ) : (
          <div className="space-y-2">
            {addresses.map((address) => (
              <AddressCard
                key={address._id}
                address={address}
                selectable
                selected={selectedAddressId === address._id}
                onSelect={() => setSelectedAddressId(address._id)}
              />
            ))}
          </div>
        )}

        {addingAddress ? (
          <div className="mt-3">
            <AddressForm onSubmit={handleAddAddress} onCancel={() => setAddingAddress(false)} submitting={addressSubmitting} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingAddress(true)}
            className="mt-3 flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline"
          >
            <Plus size={14} /> Add a new address
          </button>
        )}
      </section>

      {/* Step 2: Review order */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">2. Review your order</h2>
        <p className="mb-2 text-sm text-gray-500">{cart.restaurant?.name}</p>
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
          {cart.items.map((item) => (
            <div key={item._id} className="flex items-center justify-between p-3 text-sm">
              <div>
                <p className="font-medium text-gray-900">
                  {item.quantity} × {item.food?.name}
                </p>
                {item.addons.length > 0 && <p className="text-xs text-gray-400">{item.addons.map((a) => a.name).join(', ')}</p>}
              </div>
              <p className="text-gray-700">₹{((item.price + item.addons.reduce((a, x) => a + x.price, 0)) * item.quantity).toFixed(2)}</p>
            </div>
          ))}
        </div>
        {restaurantClosed && (
          <p className="mt-2 text-sm font-medium text-red-600">This restaurant is currently closed and cannot accept orders right now.</p>
        )}
        {belowMinimum && (
          <p className="mt-2 text-sm text-amber-600">
            Minimum order is ₹{cart.restaurant.minimumOrder}. Add ₹{(cart.restaurant.minimumOrder - cart.subtotal).toFixed(2)} more.
          </p>
        )}
      </section>

      {/* Step 3: Coupon */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">3. Coupon</h2>
        {cart.couponCode ? (
          <div className="flex items-center justify-between rounded-lg bg-green-50 px-4 py-2.5 text-sm">
            <span className="flex items-center gap-2 font-medium text-green-700">
              <Tag size={14} /> {cart.couponCode} applied — saved ₹{cart.discount.toFixed(2)}
            </span>
            <button type="button" onClick={handleRemoveCoupon} disabled={couponBusy} className="text-green-700 hover:text-green-900">
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value)}
              placeholder="Enter coupon code"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-400"
            />
            <button
              type="button"
              onClick={handleApplyCoupon}
              disabled={couponBusy || !couponInput.trim()}
              className="rounded-lg border border-brand-600 px-4 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50 disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        )}
      </section>

      {/* Step 4: Payment method */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">4. Payment method</h2>
        <div className="space-y-2">
          <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm">
            <input type="radio" name="payment" checked={paymentMethod === 'COD'} onChange={() => setPaymentMethod('COD')} />
            Cash on Delivery
          </label>
          <label
            className={`flex items-center justify-between gap-3 rounded-xl border p-4 text-sm ${
              onlinePaymentsEnabled ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 text-gray-400'
            }`}
          >
            <span className="flex items-center gap-3">
              <input
                type="radio"
                name="payment"
                disabled={!onlinePaymentsEnabled}
                checked={paymentMethod === 'ONLINE'}
                onChange={() => setPaymentMethod('ONLINE')}
              />
              Online Payment
            </span>
            {!onlinePaymentsEnabled && <span className="text-xs">Not configured yet</span>}
          </label>
        </div>
      </section>

      {/* Totals + place order */}
      <section className="mt-8 space-y-2 rounded-xl border border-gray-100 bg-white p-4">
        <Row label="Subtotal" value={cart.subtotal} />
        <Row label="Delivery fee" value={cart.deliveryFee} />
        <Row label="Tax" value={cart.tax} />
        {cart.discount > 0 && <Row label="Discount" value={-cart.discount} />}
        <div className="border-t border-gray-100 pt-2">
          <Row label="Total" value={cart.total} emphasis />
        </div>
      </section>

      <button
        type="button"
        disabled={!canPlaceOrder}
        onClick={handlePlaceOrder}
        className="mt-4 w-full rounded-lg bg-brand-600 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {placing ? 'Placing order…' : `Place order · ₹${cart.total.toFixed(2)}`}
      </button>

      <Link to="/cart" className="mt-3 block text-center text-sm text-gray-500 hover:text-brand-600">
        Back to cart
      </Link>
    </div>
  );
}
