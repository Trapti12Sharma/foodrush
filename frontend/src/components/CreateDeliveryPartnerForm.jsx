import { useState } from 'react';
import { useForm } from 'react-hook-form';
import ImageUploadField from './ImageUploadField';

const VEHICLE_TYPES = ['BICYCLE', 'SCOOTER', 'MOTORCYCLE', 'CAR'];

export default function CreateDeliveryPartnerForm({ onSubmit, submitting }) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({ defaultValues: { vehicleType: 'MOTORCYCLE' } });
  const vehicleType = watch('vehicleType');
  const needsVehicleDocs = vehicleType !== 'BICYCLE';

  const [documents, setDocuments] = useState({
    identityProofUrl: '',
    profilePhotoUrl: '',
    drivingLicenceUrl: '',
    vehicleRegistrationUrl: '',
  });

  function setDoc(field) {
    return (url) => setDocuments((prev) => ({ ...prev, [field]: url }));
  }

  const missingRequiredDocs =
    !documents.identityProofUrl || !documents.profilePhotoUrl || (needsVehicleDocs && (!documents.drivingLicenceUrl || !documents.vehicleRegistrationUrl));

  function submit(values) {
    onSubmit({
      fullName: values.fullName,
      phone: values.phone,
      dateOfBirth: values.dateOfBirth || undefined,
      address: { addressLine: values.addressLine, state: values.state, pincode: values.pincode },
      city: values.city,
      vehicleType: values.vehicleType,
      vehicleNumber: needsVehicleDocs ? values.vehicleNumber : undefined,
      drivingLicenceNumber: needsVehicleDocs ? values.drivingLicenceNumber : undefined,
      drivingLicenceExpiry: needsVehicleDocs ? values.drivingLicenceExpiry : undefined,
      emergencyContact: { name: values.emergencyContactName, phone: values.emergencyContactPhone },
      documents,
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="mx-auto max-w-lg space-y-4 rounded-xl border border-gray-200 bg-white p-6">
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Full name</label>
        <input {...register('fullName', { required: true })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        {errors.fullName && <p className="mt-1 text-xs text-red-600">Full name is required</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Phone</label>
          <input {...register('phone', { required: true })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          {errors.phone && <p className="mt-1 text-xs text-red-600">A valid phone number is required</p>}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Date of birth (optional)</label>
          <input type="date" {...register('dateOfBirth')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Address line</label>
        <input {...register('addressLine', { required: true })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
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

      {needsVehicleDocs && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Vehicle number</label>
            <input {...register('vehicleNumber', { required: needsVehicleDocs })} placeholder="MH12AB1234" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Driving licence number</label>
            <input {...register('drivingLicenceNumber', { required: needsVehicleDocs })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-700">Driving licence expiry</label>
            <input type="date" {...register('drivingLicenceExpiry', { required: needsVehicleDocs })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
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
            <ImageUploadField label="Vehicle registration photo" value={documents.vehicleRegistrationUrl} onChange={setDoc('vehicleRegistrationUrl')} purpose="kyc" />
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Emergency contact name (optional)</label>
          <input {...register('emergencyContactName')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Emergency contact phone (optional)</label>
          <input {...register('emergencyContactPhone')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting || missingRequiredDocs}
        className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Submitting…' : 'Submit for KYC review'}
      </button>
      {missingRequiredDocs && <p className="text-center text-xs text-amber-600">Upload every required document above to continue.</p>}
    </form>
  );
}
