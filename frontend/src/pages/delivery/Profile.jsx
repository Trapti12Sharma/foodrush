import { useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from '@/utils/toast';
import { useDeliveryPartner } from '../../context/DeliveryPartnerContext';
import { deliveryPartnerService } from '../../services/deliveryPartnerService';
import ImageUploadField from '../../components/ImageUploadField';

const VEHICLE_TYPES = ['BICYCLE', 'SCOOTER', 'MOTORCYCLE', 'CAR'];

export default function Profile() {
  const { profile, setProfile } = useDeliveryPartner();
  const [documents, setDocuments] = useState(profile.documents || {});
  const needsVehicleDocs = profile.vehicleType !== 'BICYCLE';

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    values: {
      fullName: profile.fullName,
      phone: profile.phone,
      addressLine: profile.address?.addressLine,
      state: profile.address?.state,
      pincode: profile.address?.pincode,
      city: profile.city,
      vehicleType: profile.vehicleType,
      vehicleNumber: profile.vehicleNumber,
      drivingLicenceNumber: profile.drivingLicenceNumber,
      drivingLicenceExpiry: profile.drivingLicenceExpiry ? profile.drivingLicenceExpiry.slice(0, 10) : '',
      emergencyContactName: profile.emergencyContact?.name,
      emergencyContactPhone: profile.emergencyContact?.phone,
    },
  });
  const watchedVehicleType = watch('vehicleType');

  function setDoc(field) {
    return (url) => setDocuments((prev) => ({ ...prev, [field]: url }));
  }

  async function onSubmit(values) {
    try {
      const updated = await deliveryPartnerService.updateMe({
        fullName: values.fullName,
        phone: values.phone,
        address: { addressLine: values.addressLine, state: values.state, pincode: values.pincode },
        city: values.city,
        vehicleType: values.vehicleType,
        vehicleNumber: values.vehicleNumber,
        drivingLicenceNumber: values.drivingLicenceNumber,
        drivingLicenceExpiry: values.drivingLicenceExpiry || undefined,
        emergencyContact: { name: values.emergencyContactName, phone: values.emergencyContactPhone },
        documents,
      });
      setProfile(updated);
      toast.success('Profile updated');
    } catch (err) {
      toast.error(err.message || 'Could not update profile');
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Your profile</h1>
      <p className="mt-1 text-sm text-gray-500">
        Editing here does not re-trigger KYC review. Changing your vehicle type or documents after approval may require a fresh review in a
        future update.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 max-w-lg space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Full name</label>
          <input {...register('fullName', { required: true })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          {errors.fullName && <p className="mt-1 text-xs text-red-600">Full name is required</p>}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Phone</label>
          <input {...register('phone', { required: true })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
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

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Vehicle type</label>
          <select {...register('vehicleType')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
            {VEHICLE_TYPES.map((v) => (
              <option key={v} value={v}>
                {v.charAt(0) + v.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>

        {watchedVehicleType !== 'BICYCLE' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Vehicle number</label>
              <input {...register('vehicleNumber')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Driving licence number</label>
              <input {...register('drivingLicenceNumber')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Driving licence expiry</label>
              <input type="date" {...register('drivingLicenceExpiry')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
          </div>
        )}

        <div className="space-y-3 rounded-lg bg-gray-50 p-3">
          <p className="text-sm font-medium text-gray-700">KYC documents</p>
          <ImageUploadField label="Identity proof" value={documents.identityProofUrl} onChange={setDoc('identityProofUrl')} purpose="kyc" />
          <ImageUploadField label="Profile photo" value={documents.profilePhotoUrl} onChange={setDoc('profilePhotoUrl')} purpose="kyc" />
          {needsVehicleDocs && (
            <>
              <ImageUploadField label="Driving licence photo" value={documents.drivingLicenceUrl} onChange={setDoc('drivingLicenceUrl')} purpose="kyc" />
              <ImageUploadField
                label="Vehicle registration photo"
                value={documents.vehicleRegistrationUrl}
                onChange={setDoc('vehicleRegistrationUrl')}
                purpose="kyc"
              />
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Emergency contact name</label>
            <input {...register('emergencyContactName')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Emergency contact phone</label>
            <input {...register('emergencyContactPhone')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
        </div>

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
