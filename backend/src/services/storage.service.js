const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { v2: cloudinary } = require('cloudinary');
const ApiError = require('../utils/ApiError');
const { parseCloudinaryUrl } = require('../utils/imageUrl');

// Abstraction boundary for file storage. Callers only ever see a {url} back and never
// know which backend holds the bytes:
//   - Cloudinary when CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET are all set —
//     permanent, and the right choice for any deployment (Render's disk is ephemeral).
//   - Local disk otherwise (multer.diskStorage, served from /uploads) — development only.
function isCloudinaryConfigured() {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

// True when an uploaded image will still exist after the next restart/deploy.
function isPersistentStorage() {
  return isCloudinaryConfigured() || process.env.NODE_ENV !== 'production';
}

function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

// The uploader's user id is part of the public_id so a later delete can prove the
// asset belongs to the entity's owner (see deleteIfOwned) without a lookup table.
function uploadToCloudinary(buffer, { purpose, userId }) {
  configureCloudinary();
  const publicId = `foodrush/${purpose}/${userId}/${crypto.randomBytes(12).toString('hex')}`;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, resource_type: 'image', overwrite: false, allowed_formats: ['jpg', 'png', 'webp'] },
      (error, result) => {
        if (error || !result) {
          // Log the provider's message only — never credentials — and give the client a generic error.
          console.error('Cloudinary upload failed:', error?.message || 'no result');
          return reject(new ApiError(502, 'Image storage is temporarily unavailable. Please try again.'));
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
}

// The file's extension comes from its DETECTED type (upload.middleware sets
// `detectedType` from the real bytes), never from the client-supplied filename — a
// file named "x.html" must not be stored, and later served, as HTML.
const LOCAL_EXTENSION = { jpeg: 'jpg', png: 'png', webp: 'webp' };

async function saveLocally(file) {
  const extension = LOCAL_EXTENSION[file.detectedType];
  if (!extension) throw ApiError.badRequest('Only JPEG, PNG, and WEBP images are allowed');
  const dir = process.env.UPLOAD_DIR || 'uploads';
  await fs.promises.mkdir(dir, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extension}`;
  await fs.promises.writeFile(path.join(dir, filename), file.buffer);
  return { url: `/uploads/${filename}` };
}

// `file` is multer's in-memory file object: {buffer, detectedType}.
async function saveUploadedFile(file, { purpose, userId } = {}) {
  if (isCloudinaryConfigured()) {
    return uploadToCloudinary(file.buffer, { purpose, userId });
  }
  return saveLocally(file);
}

// Deletes a Cloudinary asset ONLY if it is provably ours and provably the owner's:
// the URL must be on our own cloud and its public_id must sit under the owner's id.
// So a user can never cause someone else's image (or an external URL) to be deleted by
// pasting it into their own record. Best-effort: never throws, because a failed cleanup
// must not fail the edit that triggered it. Local /uploads files are left alone.
async function deleteIfOwned(url, ownerId) {
  if (!url || !ownerId || !isCloudinaryConfigured()) return false;

  const parsed = parseCloudinaryUrl(url);
  if (!parsed) return false;
  if (parsed.cloudName !== process.env.CLOUDINARY_CLOUD_NAME) return false;
  if (parsed.ownerId !== String(ownerId)) return false;

  try {
    configureCloudinary();
    await cloudinary.uploader.destroy(parsed.publicId, { resource_type: 'image', invalidate: true });
    return true;
  } catch (error) {
    console.error('Image cleanup failed:', error.message);
    return false;
  }
}

// After a field's value changes, remove the image it used to point at.
async function cleanupReplaced(oldUrl, newUrl, ownerId) {
  if (!oldUrl || oldUrl === newUrl) return false;
  return deleteIfOwned(oldUrl, ownerId);
}

module.exports = { isCloudinaryConfigured, isPersistentStorage, saveUploadedFile, deleteIfOwned, cleanupReplaced };
