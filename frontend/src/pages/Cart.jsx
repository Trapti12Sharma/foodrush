import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ShoppingCart, Trash2 } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import QuantityStepper from '../components/QuantityStepper';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { resolveImageUrl } from '../components/ImageUploadField';

function Row({ label, value, emphasis }) {
  return (
    <div className={`flex justify-between text-sm ${emphasis ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
      <span>{label}</span>
      <span>₹{value.toFixed(2)}</span>
    </div>
  );
}

export default function Cart() {
  const { user } = useAuth();
  const { cart, loading, updateQuantity, removeItem, clear } = useCart();
  const [confirmClear, setConfirmClear] = useState(false);
  const [busyItemId, setBusyItemId] = useState(null);
  const navigate = useNavigate();

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-24">
        <EmptyState
          icon={ShoppingCart}
          title="Log in to see your cart"
          description="Your cart is tied to your account."
          action={
            <Link to="/login" className="mt-2 text-sm font-medium text-brand-600 hover:underline">
              Log in
            </Link>
          }
        />
      </div>
    );
  }

  if (loading && cart.items.length === 0) {
    return <div className="py-24 text-center text-gray-400">Loading your cart…</div>;
  }

  if (cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-24">
        <EmptyState
          icon={ShoppingCart}
          title="Your cart is empty"
          description="Browse restaurants and add something delicious."
          action={
            <Link to="/restaurants" className="mt-2 text-sm font-medium text-brand-600 hover:underline">
              Browse restaurants
            </Link>
          }
        />
      </div>
    );
  }

  async function handleQuantity(item, nextQuantity) {
    setBusyItemId(item._id);
    try {
      if (nextQuantity < 1) await removeItem(item._id);
      else await updateQuantity(item._id, nextQuantity);
    } catch (err) {
      toast.error(err.message || 'Could not update cart');
    } finally {
      setBusyItemId(null);
    }
  }

  async function handleRemove(item) {
    setBusyItemId(item._id);
    try {
      await removeItem(item._id);
    } catch (err) {
      toast.error(err.message || 'Could not remove item');
    } finally {
      setBusyItemId(null);
    }
  }

  async function handleClear() {
    setConfirmClear(false);
    try {
      await clear();
      toast.success('Cart cleared');
    } catch (err) {
      toast.error(err.message || 'Could not clear cart');
    }
  }

  const belowMinimum = cart.restaurant && cart.subtotal < cart.restaurant.minimumOrder;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Your cart</h1>
        <button
          type="button"
          onClick={() => setConfirmClear(true)}
          className="flex items-center gap-1 text-sm font-medium text-red-600 hover:underline"
        >
          <Trash2 size={14} /> Clear cart
        </button>
      </div>

      {cart.restaurant && (
        <Link to={`/restaurants/${cart.restaurant._id}`} className="mt-1 inline-block text-sm text-gray-500 hover:text-brand-600">
          {cart.restaurant.name} {!cart.restaurant.isOpen && <span className="text-red-600">(currently closed)</span>}
        </Link>
      )}

      <div className="mt-6 divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
        {cart.items.map((item) => (
          <div key={item._id} className="flex items-center gap-4 p-4">
            {item.food?.image && <img src={resolveImageUrl(item.food.image)} alt={item.food.name} className="h-16 w-16 rounded-lg object-cover" />}
            <div className="flex-1">
              <p className="font-medium text-gray-900">{item.food?.name || 'Item no longer available'}</p>
              {item.addons.length > 0 && (
                <p className="text-xs text-gray-400">{item.addons.map((a) => a.name).join(', ')}</p>
              )}
              <p className="mt-1 text-sm text-gray-600">
                ₹{item.price}
                {item.addons.map((a) => ` + ₹${a.price}`).join('')} each
              </p>
            </div>
            <QuantityStepper
              quantity={item.quantity}
              disabled={busyItemId === item._id}
              onIncrement={() => handleQuantity(item, item.quantity + 1)}
              onDecrement={() => handleQuantity(item, item.quantity - 1)}
            />
            <button
              type="button"
              onClick={() => handleRemove(item)}
              disabled={busyItemId === item._id}
              className="text-gray-400 hover:text-red-600 disabled:opacity-50"
              aria-label="Remove item"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-2 rounded-xl border border-gray-100 bg-white p-4">
        <Row label="Subtotal" value={cart.subtotal} />
        <Row label="Delivery fee" value={cart.deliveryFee} />
        <Row label="Tax" value={cart.tax} />
        {cart.discount > 0 && <Row label="Discount" value={-cart.discount} />}
        <div className="border-t border-gray-100 pt-2">
          <Row label="Total" value={cart.total} emphasis />
        </div>
      </div>

      {belowMinimum && (
        <p className="mt-3 text-sm text-amber-600">
          Minimum order for this restaurant is ₹{cart.restaurant.minimumOrder}. Add ₹
          {(cart.restaurant.minimumOrder - cart.subtotal).toFixed(2)} more to check out.
        </p>
      )}

      <button
        type="button"
        disabled={belowMinimum || (cart.restaurant && !cart.restaurant.isOpen)}
        onClick={() => navigate('/checkout')}
        className="mt-4 w-full rounded-lg bg-brand-600 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Proceed to checkout
      </button>

      <ConfirmDialog
        open={confirmClear}
        title="Clear your cart?"
        description="This will remove all items from your cart."
        confirmLabel="Clear cart"
        onConfirm={handleClear}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
