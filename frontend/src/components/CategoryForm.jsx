import { useState } from 'react';
import { useForm } from 'react-hook-form';
import ImageUploadField from './ImageUploadField';

export default function CategoryForm({ initialValues, onSubmit, onCancel, submitting }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ defaultValues: initialValues || { name: '', description: '' } });
  const [image, setImage] = useState(initialValues?.image || '');

  function submit(values) {
    onSubmit({ ...values, image });
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <ImageUploadField label="Category image (optional)" value={image} onChange={setImage} />
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Category name</label>
        <input
          {...register('name', { required: 'Name is required' })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none"
        />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Description (optional)</label>
        <input {...register('description')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none" />
      </div>
      <div className="flex justify-end gap-2">
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
          {submitting ? 'Saving…' : 'Save category'}
        </button>
      </div>
    </form>
  );
}
