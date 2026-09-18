import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Upload, X } from 'lucide-react';
import { uploadService } from '../services/uploadService';

// Backend serves uploaded files from its own origin (http://localhost:5000/uploads/...),
// not the frontend's — the API base URL already carries that origin, minus the /api suffix.
const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/api\/?$/, '');

export function resolveImageUrl(url) {
  if (!url) return '';
  return url.startsWith('http') ? url : `${API_ORIGIN}${url}`;
}

export default function ImageUploadField({ label = 'Image', value, onChange }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadService.uploadImage(file);
      onChange(url);
    } catch (err) {
      toast.error(err.message || 'Could not upload image');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      <div className="flex items-center gap-3">
        {value ? (
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-gray-200">
            <img src={resolveImageUrl(value)} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onChange('')}
              className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
              aria-label="Remove image"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-300">
            <Upload size={20} />
          </div>
        )}
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : value ? 'Change image' : 'Upload image'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    </div>
  );
}
