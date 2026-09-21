import { useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { CheckCircle2, LocateFixed, Loader2 } from 'lucide-react';
import { useDeliveryLocation } from '../context/LocationContext';
import { geoService } from '../services/geoService';
import { getCurrentPosition, LocationError, tidyAddress } from '../utils/geolocation';
import PlaceSearch from './PlaceSearch';

const inputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500';

export default function AddressForm({ initialValues, onSubmit, onCancel, submitting }) {
  const { locationSearchEnabled } = useDeliveryLocation();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm({
    defaultValues: {
      label: 'Home', name: '', phone: '', addressLine: '', addressLine2: '', landmark: '', city: '', state: '', pincode: '',
      ...initialValues,
    },
  });
  // The confirmed point on the map. Present when the address was found by search or GPS —
  // it is what lets us check that a restaurant really delivers here.
  const [coords, setCoords] = useState(
    initialValues?.latitude != null && initialValues?.longitude != null ? { latitude: initialValues.latitude, longitude: initialValues.longitude } : null
  );
  const [gpsBusy, setGpsBusy] = useState(false);

  function fillFromPlace(place) {
    setValue('addressLine', tidyAddress(place.formattedAddress), { shouldValidate: true });
    if (place.city) setValue('city', place.city, { shouldValidate: true });
    if (place.state) setValue('state', place.state);
    if (place.pincode) setValue('pincode', place.pincode, { shouldValidate: true });
    setCoords({ latitude: place.latitude, longitude: place.longitude });
  }

  async function useMyLocation() {
    setGpsBusy(true);
    try {
      const { latitude, longitude } = await getCurrentPosition();
      setCoords({ latitude, longitude });
      if (locationSearchEnabled) {
        try {
          fillFromPlace(await geoService.reverse(latitude, longitude));
          return;
        } catch {
          toast('Pinned your location, but couldn’t look up the address — please type it in.', { icon: '📍' });
          return;
        }
      }
      toast('Pinned your location. Please type your address details.', { icon: '📍' });
    } catch (err) {
      toast.error(err instanceof LocationError ? err.message : 'Could not get your location.');
    } finally {
      setGpsBusy(false);
    }
  }

  function submit(values) {
    const payload = { ...values };
    if (coords) Object.assign(payload, coords);
    onSubmit(payload);
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="space-y-2">
        <PlaceSearch onSelect={fillFromPlace} enabled={locationSearchEnabled} placeholder="Search to find your address" />
        <button
          type="button"
          onClick={useMyLocation}
          disabled={gpsBusy}
          className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline disabled:opacity-60"
        >
          {gpsBusy ? <Loader2 size={14} className="animate-spin" /> : <LocateFixed size={14} />} Use my current location
        </button>
        {coords ? (
          <p className="flex items-center gap-1 text-xs font-medium text-green-700">
            <CheckCircle2 size={14} /> Location confirmed — we can check delivery to this address
          </p>
        ) : (
          <p className="text-xs text-amber-600">
            Location not confirmed. Search or use your current location so we can check that restaurants deliver here.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Save as</label>
          <select {...register('label')} className={inputClass}>
            <option>Home</option>
            <option>Work</option>
            <option>Other</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Pincode</label>
          <input {...register('pincode', { required: 'Pincode is required' })} className={inputClass} />
          {errors.pincode && <p className="mt-1 text-xs text-red-600">{errors.pincode.message}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Receiver&apos;s name</label>
          <input {...register('name', { required: 'Name is required', maxLength: { value: 100, message: 'Too long' } })} className={inputClass} />
          {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Phone</label>
          <input
            type="tel"
            {...register('phone', {
              required: 'Phone is required so the rider can reach you',
              pattern: { value: /^\+?[0-9][0-9\s-]{6,14}$/, message: 'Enter a valid phone number' },
            })}
            className={inputClass}
          />
          {errors.phone && <p className="mt-1 text-xs text-red-600">{errors.phone.message}</p>}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Address</label>
        <input {...register('addressLine', { required: 'Address is required' })} className={inputClass} />
        {errors.addressLine && <p className="mt-1 text-xs text-red-600">{errors.addressLine.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Flat / floor / building (optional)</label>
          <input {...register('addressLine2', { maxLength: { value: 200, message: 'Too long' } })} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Landmark (optional)</label>
          <input {...register('landmark', { maxLength: { value: 150, message: 'Too long' } })} placeholder="e.g. Opposite the metro" className={inputClass} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">City</label>
          <input {...register('city', { required: 'City is required' })} className={inputClass} />
          {errors.city && <p className="mt-1 text-xs text-red-600">{errors.city.message}</p>}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">State (optional)</label>
          <input {...register('state')} className={inputClass} />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
        )}
        <button type="submit" disabled={submitting} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
          {submitting ? 'Saving…' : 'Save address'}
        </button>
      </div>
    </form>
  );
}
