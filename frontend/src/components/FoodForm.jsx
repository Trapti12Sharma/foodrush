import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import ImageUploadField from './ImageUploadField';

export default function FoodForm({ categories, initialValues, onSubmit, onCancel, submitting }) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm({
    defaultValues: initialValues
      ? { ...initialValues, category: initialValues.category?._id || initialValues.category, variants: initialValues.variants || [] }
      : {
          name: '', description: '', category: categories[0]?._id || '', price: '', isVeg: true, preparationTime: 15,
          addons: [], variants: [], isRecommended: false, isBestseller: false,
        },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'addons' });
  const { fields: variantFields, append: appendVariant, remove: removeVariant } = useFieldArray({ control, name: 'variants' });
  const [image, setImage] = useState(initialValues?.image || '');

  function submit(values) {
    onSubmit({
      ...values,
      image,
      price: Number(values.price),
      discountPrice: values.discountPrice ? Number(values.discountPrice) : undefined,
      preparationTime: Number(values.preparationTime) || undefined,
      addons: values.addons.map((a) => ({ name: a.name, price: Number(a.price) })),
      variants: values.variants.map((v) => ({
        name: v.name, price: Number(v.price), discountPrice: v.discountPrice ? Number(v.discountPrice) : undefined, isAvailable: v.isAvailable !== false,
      })),
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <ImageUploadField label="Food image (optional)" value={image} onChange={setImage} purpose="food" />
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Name</label>
        <input {...register('name', { required: 'Name is required' })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Description (optional)</label>
        <textarea {...register('description')} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Category</label>
        <select {...register('category', { required: true })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
          {categories.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Price (₹)</label>
          <input type="number" {...register('price', { required: true, min: 0 })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Discount price (optional)</label>
          <input type="number" {...register('discountPrice', { min: 0 })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Prep time (min)</label>
          <input type="number" {...register('preparationTime', { min: 0 })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" {...register('isVeg')} /> Vegetarian
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" {...register('isRecommended')} /> Recommended
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" {...register('isBestseller')} /> Bestseller
        </label>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs font-medium text-gray-600">Options / sizes (optional — e.g. Small, Medium, Large)</label>
          <button type="button" onClick={() => appendVariant({ name: '', price: 0, isAvailable: true })} className="flex items-center gap-1 text-xs font-medium text-brand-600">
            <Plus size={12} /> Add option
          </button>
        </div>
        {variantFields.length > 0 && (
          <p className="mb-2 text-xs text-gray-500">When this item has options, a customer must pick one — the base price above is then shown only until they do.</p>
        )}
        <div className="space-y-2">
          {variantFields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-2">
              <input
                {...register(`variants.${index}.name`, { required: true })}
                placeholder="e.g. Large"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
              <input
                type="number"
                {...register(`variants.${index}.price`, { required: true, min: 0 })}
                placeholder="Price"
                className="w-20 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
              <input
                type="number"
                {...register(`variants.${index}.discountPrice`, { min: 0 })}
                placeholder="Discount (optional)"
                className="w-28 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
              <label className="flex shrink-0 items-center gap-1 text-xs text-gray-600">
                <input type="checkbox" defaultChecked {...register(`variants.${index}.isAvailable`)} /> Available
              </label>
              <button type="button" onClick={() => removeVariant(index)} className="text-gray-400 hover:text-red-600">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs font-medium text-gray-600">Add-ons (optional)</label>
          <button type="button" onClick={() => append({ name: '', price: 0 })} className="flex items-center gap-1 text-xs font-medium text-brand-600">
            <Plus size={12} /> Add
          </button>
        </div>
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-2">
              <input
                {...register(`addons.${index}.name`, { required: true })}
                placeholder="Addon name"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
              <input
                type="number"
                {...register(`addons.${index}.price`, { required: true, min: 0 })}
                placeholder="Price"
                className="w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
              <button type="button" onClick={() => remove(index)} className="text-gray-400 hover:text-red-600">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {submitting ? 'Saving…' : 'Save food item'}
        </button>
      </div>
    </form>
  );
}
