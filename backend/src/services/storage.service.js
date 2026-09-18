// Abstraction boundary for file storage. Every caller goes through
// saveUploadedFile() and only ever sees back a {url} — swapping local disk for
// Cloudinary/S3 later means implementing the guarded branch below, nothing else
// in the app changes.
//
// Cloudinary requires CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY /
// CLOUDINARY_API_SECRET (see backend/.env.example). Without them, uploads are
// written to local disk by multer.diskStorage (upload.middleware.js) and served
// back via the static /uploads route already registered in app.js.
function isCloudinaryConfigured() {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

async function saveUploadedFile(file) {
  if (isCloudinaryConfigured()) {
    // NOT IMPLEMENTED: this app has never run against real Cloudinary
    // credentials, so rather than ship an unverified SDK call, it fails loudly
    // here — the same honesty rule as payment.service.js's ONLINE branch.
    // To implement: `cloudinary.uploader.upload(file.path, {folder: 'foodrush'})`
    // and return { url: result.secure_url }, then delete the local temp file.
    throw new Error(
      'Cloudinary credentials are set but the Cloudinary upload integration is not implemented. ' +
        'Remove CLOUDINARY_* from .env to use local disk storage, or implement the upload call in storage.service.js.'
    );
  }

  return { url: `/uploads/${file.filename}` };
}

module.exports = { saveUploadedFile, isCloudinaryConfigured };
