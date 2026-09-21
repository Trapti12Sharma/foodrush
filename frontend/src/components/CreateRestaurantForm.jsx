import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { CheckCircle2, LocateFixed } from 'lucide-react';
import toast from 'react-hot-toast';
import ImageUploadField from './ImageUploadField';
import PlaceSearch from './PlaceSearch';
import { useDeliveryLocation } from '../context/LocationContext';
import { geoService } from '../services/geoService';
import { getCurrentPosition, LocationError, tidyAddress } from '../utils/geolocation';

export default function CreateRestaurantForm({ onSubmit, submitting }) {
  const { locationSearchEnabled } = useDeliveryLocation();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm({ defaultValues: { deliveryRadiusKm: 5 } });
  const [image, setImage] = useState('');
  // GeoJSON [longitude, latitude] of the restaurant — without it the restaurant can't appear in
  // "near me" results, so the form makes its absence obvious.
  const [location, setLocation] = useState(null);

  function fillFromPlace(place) {
    setValue('addressLine', tidyAddress(place.formattedAddress), { shouldValidate: true });
    if (place.city) setValue('city', place.city, { shouldValidate: true });
    if (place.state) setValue('state', place.state);
    if (place.pincode) setValue('pincode', place.pincode);
    setLocation({ coordinates: [place.longitude, place.latitude] });
  }

  async function useMyLocation() {
    try {
      const { latitude, longitude } = await getCurrentPosition();
      setLocation({ coordinates: [longitude, latitude] });
      if (locationSearchEnabled) {
        try {
          fillFromPlace(await geoService.reverse(latitude, longitude));
        } catch {
          toast('Pinned this spot, but couldn’t look up the address — please type it in.', { icon: '📍' });
        }
      } else {
        toast('Pinned this spot. Please type the address details.', { icon: '📍' });
      }
    } catch (err) {
      toast.error(err instanceof LocationError ? err.message : 'Could not get your location.');
    }
  }

  function submit(values) {
    onSubmit({
      name: values.name,
      description: values.description,
      image,
      cuisine: values.cuisine.split(',').map((c) => c.trim()).filter(Boolean),
      address: { addressLine: values.addressLine, state: values.state, pincode: values.pincode },
      city: values.city,
      ...(location ? { location } : {}),
      deliveryRadiusKm: Number(values.deliveryRadiusKm) || 5,
      deliveryTime: Number(values.deliveryTime),
      deliveryFee: Number(values.deliveryFee) || 0,
      minimumOrder: Number(values.minimumOrder) || 0,
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="mx-auto max-w-lg space-y-4 rounded-xl border border-gray-200 bg-white p-6">
      <ImageUploadField label="Restaurant image" value={image} onChange={setImage} purpose="restaurant" />
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
      <div className="space-y-2 rounded-lg bg-gray-50 p-3">
        <p className="text-sm font-medium text-gray-700">Where is your restaurant?</p>
        <PlaceSearch onSelect={fillFromPlace} enabled={locationSearchEnabled} placeholder="Search for your restaurant's address" />
        <button type="button" onClick={useMyLocation} className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
          <LocateFixed size={14} /> I&apos;m at the restaurant — use my current location
        </button>
        {location ? (
          <p className="flex items-center gap-1 text-xs font-medium text-green-700">
            <CheckCircle2 size={14} /> Location set — customers nearby will find you
          </p>
        ) : (
          <p className="text-xs text-amber-600">No location yet. Without one, customers can&apos;t find you in &ldquo;near me&rdquo; results.</p>
        )}
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
        <label className="mb-1 block text-sm font-medium text-gray-700">Delivery radius (km)</label>
        <input
          type="number"
          step="0.5"
          {...register('deliveryRadiusKm', { min: { value: 0.5, message: 'At least 0.5 km' }, max: { value: 50, message: 'At most 50 km' } })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        {errors.deliveryRadiusKm && <p className="mt-1 text-xs text-red-600">{errors.deliveryRadiusKm.message}</p>}
        <p className="mt-1 text-xs text-gray-500">Customers farther than this from your restaurant can&apos;t order from you.</p>
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
