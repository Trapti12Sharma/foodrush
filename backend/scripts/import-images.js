// Uploads photos from a local folder to Cloudinary and attaches them to existing
// restaurants and food items — the way to give the seeded catalog real pictures.
//
//   node scripts/import-images.js <folder>            # dry run: shows what would happen
//   node scripts/import-images.js <folder> --apply    # uploads and saves
//
// Folder layout — file names are matched to records by slug (lower-case name, every run
// of non-alphanumerics becomes "-"; "Napoli Wood Fire Pizza" -> napoli-wood-fire-pizza):
//
//   <folder>/restaurants/<restaurant-slug>.jpg         card thumbnail   -> restaurant.image
//   <folder>/covers/<restaurant-slug>.jpg              wide banner      -> restaurant.coverImage
//   <folder>/logos/<restaurant-slug>.png               logo             -> restaurant.logo
//   <folder>/foods/<restaurant-slug>/<food-slug>.jpg   dish photo       -> food.image
//
// Safe by design:
// - DRY RUN BY DEFAULT; nothing is uploaded or written until --apply.
// - Only fills fields that are EMPTY — an image that is already set is never overwritten,
//   so re-running is harmless and skips work already done.
// - Files must be real JPEG/PNG/WEBP within the upload size limit.
// - Requires CLOUDINARY_* (permanent storage); it refuses to fill the database with URLs
//   to local files. Uploads are filed under the restaurant owner's id, so the app's normal
//   "replace image" cleanup can later remove them.
// - Modifies only the image fields of matched records. Never deletes anything.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const { Restaurant, FoodItem } = require('../src/models');
const storageService = require('../src/services/storage.service');
const { detectImageType } = require('../src/utils/imageUrl');

const EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

const slugify = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function listImages(dir) {
  if (!fs.existsSync(dir)) return new Map();
  const files = new Map();
  fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && EXTENSIONS.includes(path.extname(entry.name).toLowerCase()))
    .forEach((entry) => files.set(slugify(path.basename(entry.name, path.extname(entry.name))), path.join(dir, entry.name)));
  return files;
}

async function importImages({ folder, apply = false, log = () => {} }) {
  if (!storageService.isCloudinaryConfigured()) {
    throw new Error('Cloudinary is not configured (CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET). Refusing to import — local files are not permanent.');
  }
  if (!folder || !fs.existsSync(folder)) throw new Error(`Folder not found: ${folder}`);

  const maxBytes = (Number(process.env.MAX_UPLOAD_SIZE_MB) || 5) * 1024 * 1024;
  const summary = { uploaded: 0, wouldUpload: 0, skippedExisting: 0, skippedInvalid: 0, unmatched: [] };
  const matchedFiles = new Set();

  async function attach({ file, doc, field, purpose, label }) {
    matchedFiles.add(file);
    if (doc[field]) {
      summary.skippedExisting += 1;
      return log(`  skip   ${label} — already has an image`);
    }
    const buffer = fs.readFileSync(file);
    const detectedType = detectImageType(buffer);
    if (!detectedType || buffer.length > maxBytes) {
      summary.skippedInvalid += 1;
      return log(`  INVALID ${label} — ${path.basename(file)} is not a valid JPEG/PNG/WEBP within the size limit`);
    }
    if (!apply) {
      summary.wouldUpload += 1;
      return log(`  would upload ${path.basename(file)} -> ${label}`);
    }
    const ownerId = doc.owner ? doc.owner.toString() : (await Restaurant.findById(doc.restaurant).select('owner')).owner.toString();
    const { url } = await storageService.saveUploadedFile({ buffer, detectedType }, { purpose, userId: ownerId });
    doc[field] = url;
    await doc.save();
    summary.uploaded += 1;
    log(`  uploaded ${path.basename(file)} -> ${label}`);
  }

  const restaurants = await Restaurant.find({});
  const bySlug = new Map(restaurants.map((r) => [slugify(r.name), r]));

  const groups = [
    { dir: 'restaurants', field: 'image' },
    { dir: 'covers', field: 'coverImage' },
    { dir: 'logos', field: 'logo' },
  ];
  for (const { dir, field } of groups) {
    const files = listImages(path.join(folder, dir));
    if (files.size) log(`\n${dir}/ (${files.size} file(s)) -> restaurant.${field}`);
    for (const [slug, file] of files) {
      const restaurant = bySlug.get(slug);
      if (!restaurant) {
        summary.unmatched.push(path.join(dir, path.basename(file)));
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await attach({ file, doc: restaurant, field, purpose: 'restaurant', label: `${restaurant.name} (${field})` });
    }
  }

  const foodsRoot = path.join(folder, 'foods');
  if (fs.existsSync(foodsRoot)) {
    for (const entry of fs.readdirSync(foodsRoot, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      const restaurant = bySlug.get(slugify(entry.name));
      const files = listImages(path.join(foodsRoot, entry.name));
      if (!restaurant) {
        files.forEach((file) => summary.unmatched.push(path.join('foods', entry.name, path.basename(file))));
        continue;
      }
      log(`\nfoods/${entry.name}/ (${files.size} file(s)) -> ${restaurant.name}`);
      // eslint-disable-next-line no-await-in-loop
      const foods = await FoodItem.find({ restaurant: restaurant._id });
      const foodBySlug = new Map(foods.map((f) => [slugify(f.name), f]));
      for (const [slug, file] of files) {
        const food = foodBySlug.get(slug);
        if (!food) {
          summary.unmatched.push(path.join('foods', entry.name, path.basename(file)));
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        await attach({ file, doc: food, field: 'image', purpose: 'food', label: `${restaurant.name} / ${food.name}` });
      }
    }
  }

  return summary;
}

async function main() {
  const folder = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!folder || folder.startsWith('--')) throw new Error('Usage: node scripts/import-images.js <folder> [--apply]');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set.');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to database "${mongoose.connection.name}". Mode: ${apply ? 'APPLY' : 'DRY RUN (nothing uploaded or saved)'}`);

  const s = await importImages({ folder: path.resolve(folder), apply, log: (line) => console.log(line) });

  console.log(`\n${apply ? 'Uploaded' : 'Would upload'}: ${apply ? s.uploaded : s.wouldUpload}   already had an image: ${s.skippedExisting}   invalid files: ${s.skippedInvalid}`);
  if (s.unmatched.length) console.log(`No matching record for ${s.unmatched.length} file(s):\n  ${s.unmatched.join('\n  ')}`);
  if (!apply) console.log('\nNothing was changed. Re-run with --apply to upload.');

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(`Import failed: ${err.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { importImages, slugify };
