import { useForm } from 'react-hook-form';

export default function AddressForm({ initialValues, onSubmit, onCancel, submitting }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ defaultValues: initialValues || { label: 'Home', addressLine: '', city: '', state: '', pincode: '' } });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Label</label>
          <select {...register('label')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none">
            <option>Home</option>
            <option>Work</option>
            <option>Other</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Pincode</label>
          <input
            {...register('pincode', { required: 'Pincode is required' })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none"
          />
          {errors.pincode && <p className="mt-1 text-xs text-red-600">{errors.pincode.message}</p>}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Address line</label>
        <input
          {...register('addressLine', { required: 'Address is required' })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none"
        />
        {errors.addressLine && <p className="mt-1 text-xs text-red-600">{errors.addressLine.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">City</label>
          <input
            {...register('city', { required: 'City is required' })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none"
          />
          {errors.city && <p className="mt-1 text-xs text-red-600">{errors.city.message}</p>}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">State (optional)</label>
          <input {...register('state')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none" />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {submitting ? 'Saving…' : 'Save address'}
        </button>
      </div>
    </form>
  );
}
