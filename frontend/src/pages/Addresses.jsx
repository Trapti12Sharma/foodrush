import { useEffect, useState } from 'react';
import { Plus, MapPinOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { addressService } from '../services/addressService';
import AddressCard from '../components/AddressCard';
import AddressForm from '../components/AddressForm';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';

export default function Addresses() {
  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    addressService
      .list()
      .then(setAddresses)
      .catch((err) => toast.error(err.message || 'Could not load addresses'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCreate(values) {
    setSubmitting(true);
    try {
      await addressService.create(values);
      toast.success('Address added');
      setAdding(false);
      load();
    } catch (err) {
      toast.error(err.message || 'Could not add address');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(id, values) {
    setSubmitting(true);
    try {
      await addressService.update(id, values);
      toast.success('Address updated');
      setEditingId(null);
      load();
    } catch (err) {
      toast.error(err.message || 'Could not update address');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSetDefault(address) {
    try {
      await addressService.update(address._id, { isDefault: true });
      load();
    } catch (err) {
      toast.error(err.message || 'Could not set default address');
    }
  }

  async function handleDelete() {
    const id = deletingId;
    setDeletingId(null);
    try {
      await addressService.remove(id);
      toast.success('Address removed');
      load();
    } catch (err) {
      toast.error(err.message || 'Could not remove address');
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Saved addresses</h1>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus size={16} /> Add address
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-4">
          <AddressForm onSubmit={handleCreate} onCancel={() => setAdding(false)} submitting={submitting} />
        </div>
      )}

      {loading ? (
        <p className="mt-8 text-center text-gray-400">Loading…</p>
      ) : addresses.length === 0 && !adding ? (
        <EmptyState icon={MapPinOff} title="No saved addresses yet" description="Add one to speed up checkout." />
      ) : (
        <div className="mt-6 space-y-3">
          {addresses.map((address) =>
            editingId === address._id ? (
              <AddressForm
                key={address._id}
                initialValues={address}
                onSubmit={(values) => handleUpdate(address._id, values)}
                onCancel={() => setEditingId(null)}
                submitting={submitting}
              />
            ) : (
              <div key={address._id}>
                <AddressCard
                  address={address}
                  onEdit={() => setEditingId(address._id)}
                  onDelete={() => setDeletingId(address._id)}
                />
                {!address.isDefault && (
                  <button
                    type="button"
                    onClick={() => handleSetDefault(address)}
                    className="mt-1 text-xs font-medium text-brand-600 hover:underline"
                  >
                    Set as default
                  </button>
                )}
              </div>
            )
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!deletingId}
        title="Remove this address?"
        confirmLabel="Remove"
        onConfirm={handleDelete}
        onCancel={() => setDeletingId(null)}
      />
    </div>
  );
}
