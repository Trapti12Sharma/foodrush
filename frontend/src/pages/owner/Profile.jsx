import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useRestaurantOwner } from '../../context/RestaurantOwnerContext';
import { restaurantService } from '../../services/restaurantService';
import ImageUploadField from '../../components/ImageUploadField';

export default function Profile() {
  const { selectedRestaurant, refresh } = useRestaurantOwner();
  const [image, setImage] = useState('');

  useEffect(() => {
    setImage(selectedRestaurant?.image || '');
  }, [selectedRestaurant]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    values: selectedRestaurant
      ? {
          name: selectedRestaurant.name,
          description: selectedRestaurant.description,
          cuisine: selectedRestaurant.cuisine.join(', '),
          addressLine: selectedRestaurant.address?.addressLine,
          state: selectedRestaurant.address?.state,
          pincode: selectedRestaurant.address?.pincode,
          city: selectedRestaurant.city,
          deliveryTime: selectedRestaurant.deliveryTime,
          deliveryFee: selectedRestaurant.deliveryFee,
          minimumOrder: selectedRestaurant.minimumOrder,
          isOpen: selectedRestaurant.isOpen,
        }
      : undefined,
  });

  async function onSubmit(values) {
    try {
      await restaurantService.update(selectedRestaurant._id, {
        name: values.name,
        description: values.description,
        image,
        cuisine: values.cuisine.split(',').map((c) => c.trim()).filter(Boolean),
        address: { addressLine: values.addressLine, state: values.state, pincode: values.pincode },
        city: values.city,
        deliveryTime: Number(values.deliveryTime),
        deliveryFee: Number(values.deliveryFee),
        minimumOrder: Number(values.minimumOrder),
        isOpen: values.isOpen,
      });
      toast.success('Restaurant profile updated');
      refresh();
    } catch (err) {
      toast.error(err.message || 'Could not update profile');
    }
  }

  if (!selectedRestaurant) return null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Restaurant profile</h1>
      <p className="mt-1 text-sm text-gray-500">
        Status: {selectedRestaurant.isApproved ? 'Approved' : 'Pending admin approval'} (admin-controlled)
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 max-w-lg space-y-4">
        <ImageUploadField label="Restaurant image" value={image} onChange={setImage} />
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input type="checkbox" {...register('isOpen')} /> Open for orders right now
        </label>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
          <input {...register('name', { required: true })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Cuisine (comma separated)</label>
          <input {...register('cuisine', { required: true })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
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
            <label className="mb-1 block text-sm font-medium text-gray-700">Delivery time</label>
            <input type="number" {...register('deliveryTime', { required: true, min: 0 })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Delivery fee</label>
            <input type="number" {...register('deliveryFee', { min: 0 })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Min order</label>
            <input type="number" {...register('minimumOrder', { min: 0 })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
          <textarea {...register('description')} rows={3} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        {errors.name && <p className="text-xs text-red-600">Name is required</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          Save changes
        </button>
      </form>
    </div>
  );
}
