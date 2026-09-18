import { useState } from 'react';
import { useForm } from 'react-hook-form';
import ImageUploadField from './ImageUploadField';

export default function CreateRestaurantForm({ onSubmit, submitting }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm();
  const [image, setImage] = useState('');

  function submit(values) {
    onSubmit({
      name: values.name,
      description: values.description,
      image,
      cuisine: values.cuisine.split(',').map((c) => c.trim()).filter(Boolean),
      address: { addressLine: values.addressLine, state: values.state, pincode: values.pincode },
      city: values.city,
      deliveryTime: Number(values.deliveryTime),
      deliveryFee: Number(values.deliveryFee) || 0,
      minimumOrder: Number(values.minimumOrder) || 0,
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="mx-auto max-w-lg space-y-4 rounded-xl border border-gray-200 bg-white p-6">
      <ImageUploadField label="Restaurant image" value={image} onChange={setImage} />
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Restaurant name</label>
        <input {...register('name', { required: true })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        {errors.name && <p className="mt-1 text-xs text-red-600">Name is required</p>}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Cuisine (comma separated)</label>
        <input
          {...register('cuisine', { required: true })}
          placeholder="Indian, Chinese"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        {errors.cuisine && <p className="mt-1 text-xs text-red-600">At least one cuisine is required</p>}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Address line</label>
        <input {...register('addressLine', { required: true })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">City</label>
          <input {...register('city', { required: true })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Pincode</label>
          <input {...register('pincode')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Delivery time (min)</label>
          <input type="number" {...register('deliveryTime', { required: true, min: 0 })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Delivery fee (₹)</label>
          <input type="number" {...register('deliveryFee', { min: 0 })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Min order (₹)</label>
          <input type="number" {...register('minimumOrder', { min: 0 })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Description (optional)</label>
        <textarea {...register('description')} rows={3} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {submitting ? 'Creating…' : 'Create restaurant'}
      </button>
    </form>
  );
}
