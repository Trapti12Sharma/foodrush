import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { restaurantService } from '../../services/restaurantService';
import ImageUploadField from '../../components/ImageUploadField';

// Kept separate from isApproved/isActive on purpose: this only tracks whether the
// restaurant's business paperwork has been reviewed, never whether it can take
// orders right now (see backend/src/services/admin.service.js#approveRestaurant).
const KYC_STYLES = {
  NOT_SUBMITTED: 'bg-gray-100 text-gray-600',
  SUBMITTED: 'bg-blue-100 text-blue-700',
  VERIFIED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
};

const KYC_LABELS = {
  NOT_SUBMITTED: 'Not submitted',
  SUBMITTED: 'Awaiting review',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
};

function Badge({ value }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${KYC_STYLES[value] || 'bg-gray-100 text-gray-600'}`}>{KYC_LABELS[value] || value}</span>;
}

export default function KycSection({ restaurant, onUpdated }) {
  const kycStatus = restaurant.kycStatus || 'NOT_SUBMITTED';
  const docs = restaurant.kycDocuments || {};
  const [editing, setEditing] = useState(kycStatus === 'NOT_SUBMITTED' || kycStatus === 'REJECTED');
  const [fssaiCertificateUrl, setFssaiCertificateUrl] = useState('');
  const [panCardUrl, setPanCardUrl] = useState('');
  const [gstCertificateUrl, setGstCertificateUrl] = useState('');
  const [ownerIdentityProofUrl, setOwnerIdentityProofUrl] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: { fssaiLicenseNumber: '', panNumber: '', gstNumber: '' },
  });

  useEffect(() => {
    setEditing(kycStatus === 'NOT_SUBMITTED' || kycStatus === 'REJECTED');
    setFssaiCertificateUrl(docs.fssaiCertificateUrl || '');
    setPanCardUrl(docs.panCardUrl || '');
    setGstCertificateUrl(docs.gstCertificateUrl || '');
    setOwnerIdentityProofUrl(docs.ownerIdentityProofUrl || '');
    reset({
      fssaiLicenseNumber: docs.fssaiLicenseNumber || '',
      panNumber: docs.panNumber || '',
      gstNumber: docs.gstNumber || '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant._id, kycStatus]);

  async function onSubmit(values) {
    if (!fssaiCertificateUrl || !panCardUrl || !ownerIdentityProofUrl) {
      toast.error('Please upload the FSSAI certificate, PAN card and identity proof');
      return;
    }
    try {
      await restaurantService.submitKyc(restaurant._id, {
        fssaiLicenseNumber: values.fssaiLicenseNumber,
        fssaiCertificateUrl,
        panNumber: values.panNumber,
        panCardUrl,
        ownerIdentityProofUrl,
        gstNumber: values.gstNumber || undefined,
        gstCertificateUrl: gstCertificateUrl || undefined,
      });
      toast.success('KYC documents submitted for review');
      onUpdated?.();
    } catch (err) {
      toast.error(err.message || 'Could not submit KYC documents');
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Business verification (KYC)</p>
          <p className="mt-0.5 text-xs text-gray-500">
            Separate from your live/approved status above — this only tracks review of your business documents.
          </p>
        </div>
        <Badge value={kycStatus} />
      </div>

      {kycStatus === 'REJECTED' && restaurant.kycRejectionReason && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Reason: {restaurant.kycRejectionReason}</p>
      )}
      {kycStatus === 'SUBMITTED' && (
        <p className="mt-3 text-sm text-gray-500">Your documents are awaiting admin review. You&apos;ll be notified once they&apos;ve been checked.</p>
      )}
      {kycStatus === 'VERIFIED' && !editing && (
        <div className="mt-3 flex items-center justify-between">
          <p className="text-sm text-gray-500">Your business documents have been verified.</p>
          <button type="button" onClick={() => setEditing(true)} className="text-sm font-medium text-brand-600 hover:underline">
            Update documents
          </button>
        </div>
      )}

      {editing && (kycStatus === 'NOT_SUBMITTED' || kycStatus === 'REJECTED' || kycStatus === 'VERIFIED') && (
        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3 border-t border-gray-100 pt-4">
          {kycStatus === 'VERIFIED' && (
            <p className="text-xs text-amber-600">
              Submitting new documents (e.g. renewing an expiring licence) won&apos;t take your restaurant offline — it stays live while under review.
            </p>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">FSSAI licence number</label>
            <input
              {...register('fssaiLicenseNumber', { required: true })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            {errors.fssaiLicenseNumber && <p className="mt-1 text-xs text-red-600">FSSAI licence number is required</p>}
          </div>
          <ImageUploadField label="FSSAI certificate" value={fssaiCertificateUrl} onChange={setFssaiCertificateUrl} purpose="restaurantkyc" />

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">PAN number</label>
            <input {...register('panNumber', { required: true })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            {errors.panNumber && <p className="mt-1 text-xs text-red-600">PAN number is required</p>}
          </div>
          <ImageUploadField label="PAN card" value={panCardUrl} onChange={setPanCardUrl} purpose="restaurantkyc" />

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">GST number (optional)</label>
            <input {...register('gstNumber')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <ImageUploadField label="GST certificate (optional)" value={gstCertificateUrl} onChange={setGstCertificateUrl} purpose="restaurantkyc" />

          <ImageUploadField label="Owner identity proof" value={ownerIdentityProofUrl} onChange={setOwnerIdentityProofUrl} purpose="restaurantkyc" />

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              Submit for review
            </button>
            {kycStatus === 'VERIFIED' && (
              <button type="button" onClick={() => setEditing(false)} className="text-sm font-medium text-gray-500 hover:underline">
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
