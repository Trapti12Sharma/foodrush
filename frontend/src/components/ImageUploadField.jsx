import { useEffect, useRef, useState } from 'react';
import toast from '@/utils/toast';
import { Upload, X } from 'lucide-react';
import { uploadService } from '../services/uploadService';
import { configService } from '../services/configService';
import { optimizedUrl, resolveImageUrl } from '../utils/images';

// Kept as a re-export: several components import it from here.
export { resolveImageUrl };

// One request per page load, shared by every upload field on it.
let persistenceCheck;
function checkStoragePersistence() {
  if (!persistenceCheck) {
    persistenceCheck = configService
      .get()
      .then((config) => config.imageStoragePersistent !== false)
      .catch(() => true); // if we can't tell, don't cry wolf
  }
  return persistenceCheck;
}

// `purpose` tells the backend what the picture is for (avatar | restaurant | food | category),
// which decides who is allowed to upload it.
export default function ImageUploadField({ label = 'Image', value, onChange, purpose = 'avatar' }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [persistent, setPersistent] = useState(true);

  useEffect(() => {
    checkStoragePersistence().then(setPersistent);
  }, []);

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadService.uploadImage(file, purpose);
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
            <img src={optimizedUrl(value, { width: 128, height: 128 })} alt="" className="h-full w-full object-cover" />
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
      {!persistent && (
        <p className="mt-1 text-xs text-amber-600">
          Heads up: this server stores images temporarily — they will disappear on the next restart until permanent image storage is set up.
        </p>
      )}
    </div>
  );
}
