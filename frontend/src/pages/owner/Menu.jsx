import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, UtensilsCrossed } from 'lucide-react';
import { useRestaurantOwner } from '../../context/RestaurantOwnerContext';
import { foodService } from '../../services/foodService';
import { categoryService } from '../../services/categoryService';
import FoodForm from '../../components/FoodForm';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/EmptyState';

export default function Menu() {
  const { selectedRestaurant } = useRestaurantOwner();
  const [foods, setFoods] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    if (!selectedRestaurant) return;
    setLoading(true);
    Promise.all([
      foodService.list({ restaurant: selectedRestaurant._id, limit: 200 }),
      categoryService.list(selectedRestaurant._id),
    ])
      .then(([foodRes, categoryList]) => {
        setFoods(foodRes.foods);
        setCategories(categoryList);
      })
      .catch((err) => toast.error(err.message || 'Could not load menu'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [selectedRestaurant]);

  async function handleCreate(values) {
    setSubmitting(true);
    try {
      await foodService.create({ restaurant: selectedRestaurant._id, ...values });
      toast.success('Food item added');
      setAdding(false);
      load();
    } catch (err) {
      toast.error(err.message || 'Could not add food item');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(id, values) {
    setSubmitting(true);
    try {
      await foodService.update(id, values);
      toast.success('Food item updated');
      setEditingId(null);
      load();
    } catch (err) {
      toast.error(err.message || 'Could not update food item');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleAvailability(food) {
    try {
      await foodService.update(food._id, { isAvailable: !food.isAvailable });
      load();
    } catch (err) {
      toast.error(err.message || 'Could not update item');
    }
  }

  async function handleDelete() {
    const id = deletingId;
    setDeletingId(null);
    try {
      await foodService.remove(id);
      toast.success('Food item deleted');
      load();
    } catch (err) {
      toast.error(err.message || 'Could not delete item');
    }
  }

  if (!selectedRestaurant) return null;

  if (!loading && categories.length === 0) {
    return (
      <EmptyState
        icon={UtensilsCrossed}
        title="Create a category first"
        description="Food items belong to a category — add one before building your menu."
        action={
          <Link to="/restaurant/categories" className="mt-2 text-sm font-medium text-brand-600 hover:underline">
            Go to categories
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Menu</h1>
        {!adding && categories.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus size={16} /> Add food item
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-4">
          <FoodForm categories={categories} onSubmit={handleCreate} onCancel={() => setAdding(false)} submitting={submitting} />
        </div>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-gray-400">Loading…</p>
      ) : foods.length === 0 && !adding ? (
        <EmptyState icon={UtensilsCrossed} title="No food items yet" description="Add your first menu item." />
      ) : (
        <div className="mt-6 space-y-2">
          {foods.map((food) =>
            editingId === food._id ? (
              <FoodForm
                key={food._id}
                categories={categories}
                initialValues={food}
                onSubmit={(values) => handleUpdate(food._id, values)}
                onCancel={() => setEditingId(null)}
                submitting={submitting}
              />
            ) : (
              <div key={food._id} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
                <div>
                  <p className="font-medium text-gray-900">{food.name}</p>
                  <p className="text-xs text-gray-400">{food.category?.name}</p>
                  <p className="mt-1 text-sm text-gray-700">
                    {food.discountPrice != null ? (
                      <>
                        ₹{food.discountPrice} <span className="text-xs text-gray-400 line-through">₹{food.price}</span>
                      </>
                    ) : (
                      `₹${food.price}`
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-gray-500">
                    <input type="checkbox" checked={food.isAvailable} onChange={() => toggleAvailability(food)} />
                    Available
                  </label>
                  <button type="button" onClick={() => setEditingId(food._id)} className="text-gray-400 hover:text-brand-600">
                    <Pencil size={16} />
                  </button>
                  <button type="button" onClick={() => setDeletingId(food._id)} className="text-gray-400 hover:text-red-600">
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
        title="Delete this food item?"
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeletingId(null)}
      />
    </div>
  );
}
