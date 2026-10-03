import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from '@/utils/toast';
import { useRestaurantOwner } from '../../context/RestaurantOwnerContext';
import { restaurantService } from '../../services/restaurantService';
import { CheckCircle2, LocateFixed } from 'lucide-react';
import ImageUploadField from '../../components/ImageUploadField';
import OpeningHoursEditor from '../../components/OpeningHoursEditor';
import PlaceSearch from '../../components/PlaceSearch';
import { useDeliveryLocation } from '../../context/LocationContext';
import { geoService } from '../../services/geoService';
import { getCurrentPosition, LocationError, tidyAddress } from '../../utils/geolocation';
import KycSection from './KycSection';

export default function Profile() {
  const { selectedRestaurant, refresh } = useRestaurantOwner();
  const [image, setImage] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [logo, setLogo] = useState('');
  const { locationSearchEnabled } = useDeliveryLocation();
  // Only set when the owner picks a new position; otherwise the stored one is left untouched.
  const [newLocation, setNewLocation] = useState(null);
  // The API returns slots as {day, open, close} with open/close in minutes since midnight;
  // <input type="time"> needs "HH:MM" strings, which OpeningHoursEditor converts on display —
  // but the values sent back to the API should be HH:MM strings too (what it accepts), so
  // this state always holds strings once edited.
  const [hoursSlots, setHoursSlots] = useState([]);

  useEffect(() => {
    setImage(selectedRestaurant?.image || '');
    setCoverImage(selectedRestaurant?.coverImage || '');
    setLogo(selectedRestaurant?.logo || '');
    setNewLocation(null);
    setHoursSlots(
      (selectedRestaurant?.openingHours || []).map((slot) => ({
        day: slot.day,
        open: typeof slot.open === 'number' ? `${String(Math.floor(slot.open / 60)).padStart(2, '0')}:${String(slot.open % 60).padStart(2, '0')}` : slot.open,
        close: typeof slot.close === 'number' ? `${String(Math.floor(slot.close / 60)).padStart(2, '0')}:${String(slot.close % 60).padStart(2, '0')}` : slot.close,
      }))
    );
  }, [selectedRestaurant]);

  const hasLocation = Boolean(newLocation || selectedRestaurant?.location?.coordinates);

  const {
    register,
    handleSubmit,
    setValue,
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
        deliveryRadiusKm: selectedRestaurant.deliveryRadiusKm ?? 5,
        isOpen: selectedRestaurant.isOpen,
      }
      : undefined,
  });

  function fillFromPlace(place) {
    setValue('addressLine', tidyAddress(place.formattedAddress), { shouldValidate: true });
    if (place.city) setValue('city', place.city, { shouldValidate: true });
    if (place.state) setValue('state', place.state);
    if (place.pincode) setValue('pincode', place.pincode);
    setNewLocation({ coordinates: [place.longitude, place.latitude] });
  }

  async function useMyLocation() {
    try {
      const { latitude, longitude } = await getCurrentPosition();
      setNewLocation({ coordinates: [longitude, latitude] });
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

  async function onSubmit(values) {
    try {
      await restaurantService.update(selectedRestaurant._id, {
        name: values.name,
        description: values.description,
        image,
        coverImage,
        logo,
        cuisine: values.cuisine.split(',').map((c) => c.trim()).filter(Boolean),
        address: { addressLine: values.addressLine, state: values.state, pincode: values.pincode },
        city: values.city,
        ...(newLocation ? { location: newLocation } : {}),
        deliveryRadiusKm: Number(values.deliveryRadiusKm) || 5,
        deliveryTime: Number(values.deliveryTime),
        deliveryFee: Number(values.deliveryFee),
        minimumOrder: Number(values.minimumOrder),
        isOpen: values.isOpen,
        openingHours: hoursSlots,
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

      {/* Was pinned to max-w-lg, which left this page as a narrow ribbon of
          controls down the left of a wide dashboard. The form now uses the
          available width and lays its short fields out side by side. */}
      <div className="mt-6">
        <KycSection restaurant={selectedRestaurant} onUpdated={refresh} />
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-6 space-y-5 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-6 shadow-lg shadow-black/20 backdrop-blur-xl"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <ImageUploadField label="Card image (shown in listings)" value={image} onChange={setImage} purpose="restaurant" />
          <ImageUploadField label="Cover banner (wide, e.g. 3:1)" value={coverImage} onChange={setCoverImage} purpose="restaurant" />
          <ImageUploadField label="Logo" value={logo} onChange={setLogo} purpose="restaurant" />
        </div>

        {/* Name + cuisine + open status */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
            <input {...register('name', { required: true })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Cuisine (comma separated)</label>
            <input {...register('cuisine', { required: true })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-col justify-end gap-1">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input type="checkbox" {...register('isOpen')} /> Open for orders right now
            </label>
            <p className="text-xs text-gray-500">
              Currently: <span className={selectedRestaurant.isOpenNow ? 'font-medium text-green-700' : 'font-medium text-red-600'}>{selectedRestaurant.isOpenNow ? 'Open' : 'Closed'}</span>
            </p>
          </div>
        </div>

        {/* Opening hours */}
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="mb-2 text-sm font-medium text-gray-700">Opening hours</p>
          <OpeningHoursEditor slots={hoursSlots} onChange={setHoursSlots} />
        </div>

        {/* Location */}
        <div className="space-y-2 rounded-lg bg-gray-50 p-3">
          <p className="text-sm font-medium text-gray-700">Restaurant location</p>
          <PlaceSearch onSelect={fillFromPlace} enabled={locationSearchEnabled} placeholder="Search to update your restaurant's address" />
          <button type="button" onClick={useMyLocation} className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
            <LocateFixed size={14} /> I&apos;m at the restaurant — use my current location
          </button>
          {hasLocation ? (
            <p className="flex items-center gap-1 text-xs font-medium text-green-700">
              <CheckCircle2 size={14} /> {newLocation ? 'New location set — save to apply it' : 'Location set — customers nearby can find you'}
            </p>
          ) : (
            <p className="text-xs text-amber-600">No location yet — customers can&apos;t find you in &ldquo;near me&rdquo; results. Set one above.</p>
          )}
        </div>

        {/* Address row */}
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-700">Address line</label>
            <input {...register('addressLine', { required: true })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">City</label>
            <input {...register('city', { required: true })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Pincode</label>
            <input {...register('pincode')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
        </div>

        {/* Delivery config row */}
        <div className="grid gap-3 sm:grid-cols-4">
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
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Delivery radius (km)</label>
            <input
              type="number"
              step="0.5"
              {...register('deliveryRadiusKm', { min: { value: 0.5, message: 'At least 0.5 km' }, max: { value: 50, message: 'At most 50 km' } })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            {errors.deliveryRadiusKm && <p className="mt-1 text-xs text-red-600">{errors.deliveryRadiusKm.message}</p>}
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
