import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, FolderTree } from 'lucide-react';
import { useRestaurantOwner } from '../../context/RestaurantOwnerContext';
import { categoryService } from '../../services/categoryService';
import CategoryForm from '../../components/CategoryForm';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/EmptyState';

export default function Categories() {
  const { selectedRestaurant } = useRestaurantOwner();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    if (!selectedRestaurant) return;
    setLoading(true);
    categoryService
      .list(selectedRestaurant._id)
      .then(setCategories)
      .catch((err) => toast.error(err.message || 'Could not load categories'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [selectedRestaurant]);

  async function handleCreate(values) {
    setSubmitting(true);
    try {
      await categoryService.create({ restaurant: selectedRestaurant._id, ...values });
      toast.success('Category added');
      setAdding(false);
      load();
    } catch (err) {
      toast.error(err.message || 'Could not add category');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(id, values) {
    setSubmitting(true);
    try {
      await categoryService.update(id, values);
      toast.success('Category updated');
      setEditingId(null);
      load();
    } catch (err) {
      toast.error(err.message || 'Could not update category');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(category) {
    try {
      await categoryService.update(category._id, { isActive: !category.isActive });
      load();
    } catch (err) {
      toast.error(err.message || 'Could not update category');
    }
  }

  async function handleDelete() {
    const id = deletingId;
    setDeletingId(null);
    try {
      await categoryService.remove(id);
      toast.success('Category deleted');
      load();
    } catch (err) {
      toast.error(err.message || 'Could not delete category');
    }
  }

  if (!selectedRestaurant) return null;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Categories</h1>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus size={16} /> Add category
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-4">
          <CategoryForm onSubmit={handleCreate} onCancel={() => setAdding(false)} submitting={submitting} />
        </div>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-gray-400">Loading…</p>
      ) : categories.length === 0 && !adding ? (
        <EmptyState icon={FolderTree} title="No categories yet" description="Add a category before adding food items." />
      ) : (
        <div className="mt-6 space-y-2">
          {categories.map((category) =>
            editingId === category._id ? (
              <CategoryForm
                key={category._id}
                initialValues={category}
                onSubmit={(values) => handleUpdate(category._id, values)}
                onCancel={() => setEditingId(null)}
                submitting={submitting}
              />
            ) : (
              <div key={category._id} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
                <div>
                  <p className="font-medium text-gray-900">{category.name}</p>
                  {category.description && <p className="text-sm text-gray-500">{category.description}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-gray-500">
                    <input type="checkbox" checked={category.isActive} onChange={() => toggleActive(category)} />
                    Active
                  </label>
                  <button type="button" onClick={() => setEditingId(category._id)} className="text-gray-400 hover:text-brand-600">
                    <Pencil size={16} />
                  </button>
                  <button type="button" onClick={() => setDeletingId(category._id)} className="text-gray-400 hover:text-red-600">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!deletingId}
        title="Delete this category?"
        description="You can't delete a category that still has food items in it."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeletingId(null)}
      />
    </div>
  );
}
