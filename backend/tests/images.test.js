require('./setup');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { v2: cloudinary } = require('cloudinary');
const { app, registerAndLogin, uniqueEmail, createUserWithRole, setupOrderable } = require('./helpers');
const { isSafeImageUrl, detectImageType, parseCloudinaryUrl } = require('../src/utils/imageUrl');
const storageService = require('../src/services/storage.service');
const { validateEnv } = require('../src/config/env');
const { createReviewValidator } = require('../src/validators/review.validator');
const { importImages, slugify } = require('../scripts/import-images');
const Restaurant = require('../src/models/Restaurant');
const FoodItem = require('../src/models/FoodItem');
const FoodCategory = require('../src/models/FoodCategory');
const User = require('../src/models/User');

// Real (decodable-header) sample bytes.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20, 1)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(8, 1)]);
const GIF = Buffer.from('GIF89a' + 'x'.repeat(20), 'latin1');

const CLOUD_KEYS = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
const savedEnv = {};
CLOUD_KEYS.forEach((k) => { savedEnv[k] = process.env[k]; });

function useCloudinary(name = 'democloud') {
  process.env.CLOUDINARY_CLOUD_NAME = name;
  process.env.CLOUDINARY_API_KEY = 'test-key-123';
  process.env.CLOUDINARY_API_SECRET = 'test-secret-XYZ-789';
}

beforeEach(() => CLOUD_KEYS.forEach((k) => delete process.env[k])); // default: local storage
afterEach(() => {
  jest.restoreAllMocks();
  CLOUD_KEYS.forEach((k) => {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  });
});

const uploadsDir = path.join(__dirname, '..', 'uploads');
const listUploads = () => (fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir).filter((f) => f !== '.gitkeep') : []);
const testFiles = new Set();
afterAll(() => testFiles.forEach((url) => { const f = path.join(__dirname, '..', url); if (fs.existsSync(f)) fs.unlinkSync(f); }));

const cloudUrl = (ownerId, purpose = 'food', id = 'abcdef0123456789abcdef01', ext = 'jpg') =>
  `https://res.cloudinary.com/democloud/image/upload/v1700000000/foodrush/${purpose}/${ownerId}/${id}.${ext}`;

describe('image utilities', () => {
  it('isSafeImageUrl allows empty, /uploads/ paths and https URLs only', () => {
    ['', null, '/uploads/a-1.png', 'https://res.cloudinary.com/x/a.jpg'].forEach((v) => expect(isSafeImageUrl(v)).toBe(true));
    ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://x.com/a.png', '//evil.com/a.png', '/uploads/../a.png', '/etc/passwd', 42, 'https://' + 'a'.repeat(600)]
      .forEach((v) => expect(isSafeImageUrl(v)).toBe(false));
  });

  it('detectImageType reads the real bytes', () => {
    expect(detectImageType(PNG)).toBe('png');
    expect(detectImageType(JPEG)).toBe('jpeg');
    expect(detectImageType(WEBP)).toBe('webp');
    expect(detectImageType(GIF)).toBeNull();
    expect(detectImageType(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(detectImageType(Buffer.alloc(4))).toBeNull();
    expect(detectImageType(undefined)).toBeNull();
  });

  it('parseCloudinaryUrl extracts owner and public id, tolerating transformations, versions and extensions', () => {
    const owner = 'a'.repeat(24);
    const expected = { cloudName: 'democloud', publicId: `foodrush/food/${owner}/abcdef0123456789abcdef01`, purpose: 'food', ownerId: owner };
    expect(parseCloudinaryUrl(cloudUrl(owner))).toEqual(expected);
    expect(parseCloudinaryUrl(`https://res.cloudinary.com/democloud/image/upload/f_auto,q_auto,w_400,c_fill/v1/foodrush/food/${owner}/abcdef0123456789abcdef01.webp`)).toEqual(expected);
    expect(parseCloudinaryUrl(`https://res.cloudinary.com/democloud/image/upload/foodrush/food/${owner}/abcdef0123456789abcdef01`)).toEqual(expected);
  });

  it('parseCloudinaryUrl rejects anything that is not one of our uploads', () => {
    const owner = 'a'.repeat(24);
    [
      `http://res.cloudinary.com/democloud/image/upload/v1/foodrush/food/${owner}/x.jpg`,
      `https://evil.example.com/image/upload/v1/foodrush/food/${owner}/x.jpg`,
      `https://res.cloudinary.com/democloud/image/upload/v1/other-folder/food/${owner}/x.jpg`,
      'https://res.cloudinary.com/democloud/image/upload/v1/foodrush/food/not-an-object-id/x.jpg',
      `https://res.cloudinary.com/democloud/image/upload/v1/foodrush/food/${owner}/../../x.jpg`,
      '/uploads/a.png', '', null, undefined,
    ].forEach((v) => expect(parseCloudinaryUrl(v)).toBeNull());
  });
});

describe('upload API — local storage (development)', () => {
  it('rejects unauthenticated, non-image and fake-image uploads', async () => {
    expect((await request(app).post('/api/uploads/image').attach('image', PNG, 'a.png')).status).toBe(401);
    const user = await registerAndLogin({ name: 'U', email: uniqueEmail('im-u'), role: 'CUSTOMER' });
    expect((await user.post('/api/uploads/image').attach('image', Buffer.from('hello'), 'note.txt')).status).toBe(400);
    // Right Content-Type and extension, wrong bytes: HTML pretending to be a PNG.
    const fake = await user.post('/api/uploads/image').attach('image', Buffer.from('<html><script>alert(1)</script></html> padding'), { filename: 'evil.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
    expect(fake.body.message).toMatch(/not a valid/i);
    // A real GIF, which we don't accept.
    expect((await user.post('/api/uploads/image').attach('image', GIF, { filename: 'a.png', contentType: 'image/png' })).status).toBe(400);
  });

  it('stores accepted images with an extension from their real type, never from the client filename (no stored XSS)', async () => {
    const user = await registerAndLogin({ name: 'U', email: uniqueEmail('im-xss'), role: 'CUSTOMER' });
    const res = await user.post('/api/uploads/image').attach('image', PNG, { filename: 'evil.html', contentType: 'image/png' });
    expect(res.status).toBe(201);
    testFiles.add(res.body.data.url);
    expect(res.body.data.url).toMatch(/^\/uploads\/\d+-[a-f0-9]{12}\.png$/);
    const served = await request(app).get(res.body.data.url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toMatch(/^image\/png/);
  });

  it('accepts JPEG and WEBP too, with the matching extension', async () => {
    const user = await registerAndLogin({ name: 'U', email: uniqueEmail('im-fmt'), role: 'CUSTOMER' });
    const jpg = await user.post('/api/uploads/image').attach('image', JPEG, { filename: 'a.jpeg', contentType: 'image/jpeg' });
    const webp = await user.post('/api/uploads/image').attach('image', WEBP, { filename: 'a.webp', contentType: 'image/webp' });
    [jpg, webp].forEach((r) => { expect(r.status).toBe(201); testFiles.add(r.body.data.url); });
    expect(jpg.body.data.url).toMatch(/\.jpg$/);
    expect(webp.body.data.url).toMatch(/\.webp$/);
  });

  it('gates catalog-image purposes by role, while avatars stay open to any signed-in user', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('im-c'), role: 'CUSTOMER' });
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('im-o'), role: 'RESTAURANT_OWNER' });
    const { agent: manager } = await createUserWithRole('RESTAURANT_MANAGER');
    const { agent: support } = await createUserWithRole('SUPPORT_AGENT');
    const send = (agent, purpose) => agent.post(`/api/uploads/image${purpose ? `?purpose=${purpose}` : ''}`).attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });

    const created = [];
    for (const [agent, purpose, expected] of [
      [customer, undefined, 201], [customer, 'avatar', 201],
      [customer, 'food', 403], [customer, 'restaurant', 403], [customer, 'category', 403],
      [support, 'food', 403],
      [owner, 'food', 201], [owner, 'restaurant', 201], [owner, 'category', 201],
      [manager, 'restaurant', 201],
      [customer, 'nonsense', 400],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await send(agent, purpose);
      expect([purpose, res.status]).toEqual([purpose, expected]);
      if (res.status === 201) created.push(res.body.data.url);
    }
    created.forEach((u) => testFiles.add(u));
  });

  it('does not buffer or store anything for an unauthorised purpose', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('im-nb'), role: 'CUSTOMER' });
    const before = listUploads().length;
    await customer.post('/api/uploads/image?purpose=food').attach('image', PNG, { filename: 'a.png', contentType: 'image/png' }).expect(403);
    expect(listUploads().length).toBe(before);
  });
});

describe('upload API — Cloudinary storage', () => {
  it('streams to Cloudinary under foodrush/<purpose>/<userId>/ and never writes to local disk', async () => {
    useCloudinary();
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('im-cl'), role: 'RESTAURANT_OWNER' });
    const ownerId = (await User.findOne({ role: 'RESTAURANT_OWNER' }))._id.toString();

    let captured;
    jest.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation((options, callback) => {
      captured = options;
      return { end: (buffer) => { captured.bytes = buffer.length; callback(null, { secure_url: `https://res.cloudinary.com/democloud/image/upload/v1/${options.public_id}.png`, public_id: options.public_id }); } };
    });

    const before = listUploads().length;
    const res = await owner.post('/api/uploads/image?purpose=food').attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.data.url).toMatch(new RegExp(`^https://res\\.cloudinary\\.com/democloud/image/upload/v1/foodrush/food/${ownerId}/[a-f0-9]{24}\\.png$`));
    expect(captured.public_id).toMatch(new RegExp(`^foodrush/food/${ownerId}/[a-f0-9]{24}$`));
    expect(captured).toMatchObject({ resource_type: 'image', overwrite: false, allowed_formats: ['jpg', 'png', 'webp'] });
    expect(captured.bytes).toBe(PNG.length);
    expect(listUploads().length).toBe(before); // nothing written to Render's disk
  });

  it('reports a provider failure as a generic 502 and never leaks credentials into the response or the log', async () => {
    useCloudinary();
    const user = await registerAndLogin({ name: 'U', email: uniqueEmail('im-fail'), role: 'CUSTOMER' });
    jest.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation((options, callback) => ({ end: () => callback(new Error('Invalid api_key test-key-123')) }));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await user.post('/api/uploads/image').attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });

    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/temporarily unavailable/i);
    expect(JSON.stringify(res.body)).not.toMatch(/test-key-123|test-secret/);
    expect(JSON.stringify(errSpy.mock.calls)).not.toMatch(/test-secret-XYZ-789/);
  });
});

describe('image URL validation on catalog records', () => {
  it('rejects unsafe image URLs and accepts uploads / https on restaurants, foods and categories', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('iv-o'), role: 'RESTAURANT_OWNER' });
    const base = { name: 'R', cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20 };

    expect((await owner.post('/api/restaurants').send({ ...base, image: 'javascript:alert(1)' })).status).toBe(422);
    expect((await owner.post('/api/restaurants').send({ ...base, coverImage: 'http://insecure.example.com/a.jpg' })).status).toBe(422);
    expect((await owner.post('/api/restaurants').send({ ...base, logo: 'data:image/png;base64,AAA' })).status).toBe(422);
    const ok = await owner.post('/api/restaurants').send({ ...base, image: '/uploads/a.png', coverImage: 'https://cdn.example.com/c.jpg', logo: 'https://cdn.example.com/l.png' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.restaurant).toMatchObject({ image: '/uploads/a.png', coverImage: 'https://cdn.example.com/c.jpg', logo: 'https://cdn.example.com/l.png' });

    const restaurantId = ok.body.data.restaurant._id;
    await Restaurant.findByIdAndUpdate(restaurantId, { isApproved: true });
    const category = await owner.post('/api/categories').send({ restaurant: restaurantId, name: 'Mains', image: 'javascript:1' });
    expect(category.status).toBe(422);
    const goodCategory = await owner.post('/api/categories').send({ restaurant: restaurantId, name: 'Mains', image: 'https://cdn.example.com/m.jpg' });
    expect(goodCategory.status).toBe(201);

    const food = { restaurant: restaurantId, category: goodCategory.body.data.category._id, name: 'Dish', price: 10, isVeg: true };
    expect((await owner.post('/api/foods').send({ ...food, image: 'http://x.com/a.jpg' })).status).toBe(422);
    expect((await owner.post('/api/foods').send({ ...food, image: 'https://cdn.example.com/d.jpg' })).status).toBe(201);
  });

  it('validates review images too (max 5, safe URLs only)', async () => {
    const run = async (images) => {
      const req = { body: { restaurant: '507f1f77bcf86cd799439011', order: '507f1f77bcf86cd799439012', rating: 5, images } };
      await Promise.all(createReviewValidator.map((rule) => rule.run(req)));
      return require('express-validator').validationResult(req).array().map((e) => e.path);
    };
    expect(await run(['https://cdn.example.com/a.jpg', '/uploads/b.png'])).toEqual([]);
    expect(await run(['javascript:alert(1)'])).toContain('images');
    expect(await run(['https://cdn.example.com/a.jpg', ''])).toContain('images');
    expect(await run(Array(6).fill('https://cdn.example.com/a.jpg'))).toContain('images');
  });

  it('lets owners set and clear cover images and logos through the normal update endpoint', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('iv-up'), role: 'RESTAURANT_OWNER' });
    const { restaurant } = await setupOrderable(owner);
    const res = await owner.put(`/api/restaurants/${restaurant._id}`).send({ coverImage: 'https://cdn.example.com/c.jpg', logo: '/uploads/l.png' });
    expect(res.status).toBe(200);
    expect(res.body.data.restaurant).toMatchObject({ coverImage: 'https://cdn.example.com/c.jpg', logo: '/uploads/l.png' });
    const cleared = await owner.put(`/api/restaurants/${restaurant._id}`).send({ coverImage: '' });
    expect(cleared.body.data.restaurant.coverImage).toBe('');
  });
});

describe('cleanup of replaced / deleted Cloudinary images', () => {
  let destroy;
  beforeEach(() => {
    useCloudinary();
    destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
  });

  async function ownerWithFood(imageFor) {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('cu-o'), role: 'RESTAURANT_OWNER' });
    const ownerId = (await User.findOne({ role: 'RESTAURANT_OWNER' }))._id.toString();
    const { restaurant, food } = await setupOrderable(owner);
    if (imageFor) await FoodItem.findByIdAndUpdate(food._id, { image: imageFor(ownerId) });
    return { owner, ownerId, restaurant, food };
  }

  it('deletes the old asset when a food image is replaced, but only the owner\'s own upload', async () => {
    const { owner, ownerId, food } = await ownerWithFood((id) => cloudUrl(id));
    await owner.put(`/api/foods/${food._id}`).send({ image: 'https://cdn.example.com/new.jpg' }).expect(200);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledWith(`foodrush/food/${ownerId}/abcdef0123456789abcdef01`, { resource_type: 'image', invalidate: true });
  });

  it('never deletes an asset that belongs to someone else, is on another cloud, or is external', async () => {
    const stranger = 'b'.repeat(24);
    for (const oldImage of [cloudUrl(stranger), 'https://res.cloudinary.com/othercloud/image/upload/v1/foodrush/food/' + 'c'.repeat(24) + '/x.jpg', 'https://cdn.example.com/photo.jpg', '/uploads/local.png']) {
      // eslint-disable-next-line no-await-in-loop
      const { owner, food } = await ownerWithFood(() => oldImage);
      // eslint-disable-next-line no-await-in-loop
      await owner.put(`/api/foods/${food._id}`).send({ image: 'https://cdn.example.com/new.jpg' }).expect(200);
    }
    expect(destroy).not.toHaveBeenCalled();
  });

  it('does not delete when the image did not change, or when Cloudinary is not configured', async () => {
    const { owner, food, ownerId } = await ownerWithFood((id) => cloudUrl(id));
    await owner.put(`/api/foods/${food._id}`).send({ name: 'Renamed', image: cloudUrl(ownerId) }).expect(200);
    expect(destroy).not.toHaveBeenCalled();

    CLOUD_KEYS.forEach((k) => delete process.env[k]);
    await owner.put(`/api/foods/${food._id}`).send({ image: '' }).expect(200);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('deletes the asset when the food item, or its category, is deleted', async () => {
    const { owner, ownerId, restaurant, food } = await ownerWithFood((id) => cloudUrl(id));
    await owner.delete(`/api/foods/${food._id}`).expect(200);
    expect(destroy).toHaveBeenCalledWith(`foodrush/food/${ownerId}/abcdef0123456789abcdef01`, expect.any(Object));

    const cat = await FoodCategory.create({ restaurant: restaurant._id, name: 'Temp', image: cloudUrl(ownerId, 'category', '111111111111111111111111') });
    await owner.delete(`/api/categories/${cat._id}`).expect(200);
    expect(destroy).toHaveBeenCalledWith(`foodrush/category/${ownerId}/111111111111111111111111`, expect.any(Object));
    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it('cleans up each replaced restaurant image field, and a replaced avatar', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('cu-r'), role: 'RESTAURANT_OWNER' });
    const ownerId = (await User.findOne({ role: 'RESTAURANT_OWNER' }))._id.toString();
    const { restaurant } = await setupOrderable(owner);
    await Restaurant.findByIdAndUpdate(restaurant._id, {
      image: cloudUrl(ownerId, 'restaurant', '111111111111111111111111'),
      coverImage: cloudUrl(ownerId, 'restaurant', '222222222222222222222222'),
      logo: cloudUrl(ownerId, 'restaurant', '333333333333333333333333'),
    });
    await owner.put(`/api/restaurants/${restaurant._id}`).send({ image: '', coverImage: 'https://cdn.example.com/c.jpg' }).expect(200);
    const destroyed = destroy.mock.calls.map((c) => c[0]).sort();
    expect(destroyed).toEqual([
      `foodrush/restaurant/${ownerId}/111111111111111111111111`,
      `foodrush/restaurant/${ownerId}/222222222222222222222222`,
    ]); // logo untouched

    destroy.mockClear();
    await User.updateOne({ _id: ownerId }, { avatar: cloudUrl(ownerId, 'avatar', '444444444444444444444444') });
    await owner.put('/api/auth/me').send({ avatar: '' }).expect(200);
    expect(destroy).toHaveBeenCalledWith(`foodrush/avatar/${ownerId}/444444444444444444444444`, expect.any(Object));
  });

  it('does not fail the edit when the cleanup call itself fails', async () => {
    const { owner, food } = await ownerWithFood((id) => cloudUrl(id));
    destroy.mockRejectedValue(new Error('cloudinary down'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await owner.put(`/api/foods/${food._id}`).send({ image: 'https://cdn.example.com/new.jpg' });
    expect(res.status).toBe(200);
    expect(res.body.data.food.image).toBe('https://cdn.example.com/new.jpg');
    expect(errSpy).toHaveBeenCalled();
    expect(JSON.stringify(errSpy.mock.calls)).not.toMatch(/test-secret/);
  });
});

describe('storage configuration', () => {
  it('reports persistence: local dev is fine, production needs Cloudinary', () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    expect(storageService.isPersistentStorage()).toBe(true);
    process.env.NODE_ENV = 'production';
    expect(storageService.isPersistentStorage()).toBe(false);
    useCloudinary();
    expect(storageService.isPersistentStorage()).toBe(true);
    process.env.NODE_ENV = saved;
  });

  it('exposes it on /api/config for the UI', async () => {
    const res = await request(app).get('/api/config');
    expect(res.body.data).toMatchObject({ imageStoragePersistent: true });
  });

  describe('boot validation', () => {
    const base = { NODE_ENV: 'production', MONGODB_URI: 'mongodb+srv://u:p@c.example.mongodb.net/db', JWT_SECRET: 'a'.repeat(40), CLIENT_URL: 'https://foodrush.example.com' };
    it('rejects a partial Cloudinary configuration, naming only the missing variables', () => {
      const { errors } = validateEnv({ ...base, CLOUDINARY_CLOUD_NAME: 'x' });
      expect(errors.join(' ')).toMatch(/CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET/);
      expect(errors.join(' ')).not.toMatch(/=|CLOUDINARY_CLOUD_NAME,/);
    });
    it('accepts none or all, warning in production when none', () => {
      const all = validateEnv({ ...base, CLOUDINARY_CLOUD_NAME: 'x', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' });
      expect(all.errors).toEqual([]);
      expect(all.warnings.join(' ')).not.toMatch(/Cloudinary/);
      const none = validateEnv(base);
      expect(none.errors).toEqual([]);
      expect(none.warnings.join(' ')).toMatch(/Cloudinary is not configured/);
      expect(validateEnv({ ...base, NODE_ENV: 'development' }).warnings.join(' ')).not.toMatch(/Cloudinary/);
    });
  });
});

describe('scripts/import-images', () => {
  let dir;
  let saveSpy;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foodrush-img-'));
    ['restaurants', 'covers', 'logos', 'foods/napoli-pizza'].forEach((d) => fs.mkdirSync(path.join(dir, d), { recursive: true }));
    useCloudinary();
    let n = 0;
    saveSpy = jest.spyOn(storageService, 'saveUploadedFile').mockImplementation(async (file, { purpose, userId }) => ({ url: `https://res.cloudinary.com/democloud/image/upload/v1/foodrush/${purpose}/${userId}/${String(++n).padStart(24, '0')}.jpg` }));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  async function seedCatalog() {
    const owner = await User.create({ name: 'Owner', email: uniqueEmail('imp'), password: 'password123', role: 'RESTAURANT_OWNER' });
    const restaurant = await Restaurant.create({ name: 'Napoli Pizza', owner: owner._id, cuisine: ['Italian'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20, isApproved: true });
    const category = await FoodCategory.create({ restaurant: restaurant._id, name: 'Pizzas' });
    const margherita = await FoodItem.create({ restaurant: restaurant._id, category: category._id, name: 'Margherita Pizza', price: 100, isVeg: true });
    const pepperoni = await FoodItem.create({ restaurant: restaurant._id, category: category._id, name: 'Pepperoni Pizza', price: 120, isVeg: false, image: 'https://cdn.example.com/existing.jpg' });
    return { owner, restaurant, margherita, pepperoni };
  }
  const put = (rel, buffer) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), buffer);
  };

  it('slugifies names predictably', () => {
    expect(slugify('Napoli Wood Fire Pizza')).toBe('napoli-wood-fire-pizza');
    expect(slugify("  Brew & Bites Café!! ")).toBe('brew-bites-caf');
  });

  it('refuses to run without Cloudinary, and on a missing folder', async () => {
    CLOUD_KEYS.forEach((k) => delete process.env[k]);
    await expect(importImages({ folder: dir })).rejects.toThrow(/Cloudinary is not configured/);
    useCloudinary();
    await expect(importImages({ folder: path.join(dir, 'nope') })).rejects.toThrow(/Folder not found/);
  });

  it('changes nothing in a dry run', async () => {
    const { restaurant, margherita } = await seedCatalog();
    put('restaurants/napoli-pizza.jpg', JPEG);
    put('foods/napoli-pizza/margherita-pizza.png', PNG);

    const summary = await importImages({ folder: dir, apply: false });
    expect(summary).toMatchObject({ wouldUpload: 2, uploaded: 0 });
    expect(saveSpy).not.toHaveBeenCalled();
    expect((await Restaurant.findById(restaurant._id)).image).toBe('');
    expect((await FoodItem.findById(margherita._id)).image).toBe('');
  });

  it('uploads under the restaurant owner and fills only empty fields — never overwriting', async () => {
    const { owner, restaurant, margherita, pepperoni } = await seedCatalog();
    put('restaurants/napoli-pizza.jpg', JPEG);
    put('covers/napoli-pizza.png', PNG);
    put('logos/napoli-pizza.webp', WEBP);
    put('foods/napoli-pizza/margherita-pizza.jpg', JPEG);
    put('foods/napoli-pizza/pepperoni-pizza.jpg', JPEG); // already has an image

    const summary = await importImages({ folder: dir, apply: true });

    expect(summary).toMatchObject({ uploaded: 4, skippedExisting: 1, skippedInvalid: 0, unmatched: [] });
    const r = await Restaurant.findById(restaurant._id);
    [r.image, r.coverImage, r.logo].forEach((url) => expect(parseCloudinaryUrl(url).ownerId).toBe(owner._id.toString()));
    expect(parseCloudinaryUrl((await FoodItem.findById(margherita._id)).image).purpose).toBe('food');
    expect((await FoodItem.findById(pepperoni._id)).image).toBe('https://cdn.example.com/existing.jpg'); // untouched
    saveSpy.mock.calls.forEach(([, options]) => expect(options.userId).toBe(owner._id.toString()));
  });

  it('is idempotent: a second run uploads nothing', async () => {
    await seedCatalog();
    put('restaurants/napoli-pizza.jpg', JPEG);
    await importImages({ folder: dir, apply: true });
    saveSpy.mockClear();
    const again = await importImages({ folder: dir, apply: true });
    expect(again).toMatchObject({ uploaded: 0, skippedExisting: 1 });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('skips invalid files and reports files that match no record', async () => {
    await seedCatalog();
    put('restaurants/napoli-pizza.jpg', Buffer.from('<html>not an image</html> padding padding'));
    put('restaurants/unknown-place.jpg', JPEG);
    put('foods/napoli-pizza/no-such-dish.jpg', JPEG);
    put('foods/ghost-restaurant/dish.jpg', JPEG);
    put('restaurants/notes.txt', Buffer.from('ignore me'));

    const summary = await importImages({ folder: dir, apply: true });
    expect(summary.skippedInvalid).toBe(1);
    expect(summary.uploaded).toBe(0);
    expect(summary.unmatched.map((p) => p.replace(/\\/g, '/')).sort()).toEqual([
      'foods/ghost-restaurant/dish.jpg', 'foods/napoli-pizza/no-such-dish.jpg', 'restaurants/unknown-place.jpg',
    ]);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

// M13 — dedicated one-request "upload and attach" / "delete" endpoints per image
// slot, storing the real Cloudinary public_id (never client-supplied — see
// restaurant.service.js#derivePublicId) so replace/delete no longer depends on
// re-deriving ownership from the URL and can act reliably even when the
// original uploader and the record's owner differ (e.g. an admin editing on
// behalf of an owner) — the one real gap in the pre-M13 design.
describe('M13 — dedicated restaurant/food image endpoints', () => {
  let uploadStream;
  let destroy;

  function mockSuccessfulUpload() {
    uploadStream = jest.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation((options, callback) => ({
      end: () => callback(null, { secure_url: `https://res.cloudinary.com/democloud/image/upload/v1/${options.public_id}.png`, public_id: options.public_id }),
    }));
  }

  beforeEach(() => {
    useCloudinary();
    mockSuccessfulUpload();
    destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
  });

  describe('restaurant images', () => {
    it('uploads and persists both the URL and the real Cloudinary public_id', async () => {
      const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('m13-r-up'), role: 'RESTAURANT_OWNER' });
      const { restaurant } = await setupOrderable(owner);

      const res = await owner.post(`/api/restaurants/${restaurant._id}/images/logo`).attach('image', PNG, { filename: 'logo.png', contentType: 'image/png' });
      expect(res.status).toBe(201);
      expect(res.body.data.restaurant.logo).toMatch(/^https:\/\/res\.cloudinary\.com/);

      const stored = await Restaurant.findById(restaurant._id);
      expect(stored.logoPublicId).toBe(uploadStream.mock.calls[0][0].public_id);
      expect(stored.logo).toBe(res.body.data.restaurant.logo);
    });

    it('rejects a bogus type param, a non-image file, and an oversized file, matching the existing upload validation', async () => {
      const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('m13-r-bad'), role: 'RESTAURANT_OWNER' });
      const { restaurant } = await setupOrderable(owner);

      expect((await owner.post(`/api/restaurants/${restaurant._id}/images/banner`).attach('image', PNG, 'a.png')).status).toBe(400);
      expect((await owner.post(`/api/restaurants/${restaurant._id}/images/logo`).attach('image', Buffer.from('not an image'), { filename: 'a.png', contentType: 'image/png' })).status).toBe(400);

      // MAX_UPLOAD_SIZE_MB is read into a module-level constant at require time
      // (upload.middleware.js), so it can't be changed per-test — exceed the
      // real default (5MB) instead of trying to lower the limit at runtime.
      const big = await owner.post(`/api/restaurants/${restaurant._id}/images/logo`).attach('image', Buffer.concat([JPEG, Buffer.alloc(6 * 1024 * 1024)]), { filename: 'a.jpg', contentType: 'image/jpeg' });
      expect(big.status).toBe(400);
      expect(big.body.message).toMatch(/too large/i);
    });

    it('rejects an unauthenticated caller (401), a customer (403), and a different restaurant owner (403)', async () => {
      const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('m13-r-rbac'), role: 'RESTAURANT_OWNER' });
      const stranger = await registerAndLogin({ name: 'S', email: uniqueEmail('m13-r-stranger'), role: 'RESTAURANT_OWNER' });
      const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('m13-r-cust'), role: 'CUSTOMER' });
      const { restaurant } = await setupOrderable(owner);

      expect((await request(app).post(`/api/restaurants/${restaurant._id}/images/logo`).attach('image', PNG, 'a.png')).status).toBe(401);
      expect((await customer.post(`/api/restaurants/${restaurant._id}/images/logo`).attach('image', PNG, 'a.png')).status).toBe(403);
      expect((await stranger.post(`/api/restaurants/${restaurant._id}/images/logo`).attach('image', PNG, 'a.png')).status).toBe(403);
      expect((await customer.delete(`/api/restaurants/${restaurant._id}/images/logo`)).status).toBe(403);
      expect((await stranger.delete(`/api/restaurants/${restaurant._id}/images/logo`)).status).toBe(403);
    });

    it('returns 404 for an unknown restaurant id', async () => {
      const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('m13-r-404'), role: 'RESTAURANT_OWNER' });
      const fakeId = '507f1f77bcf86cd799439011';
      expect((await owner.post(`/api/restaurants/${fakeId}/images/logo`).attach('image', PNG, 'a.png')).status).toBe(404);
      expect((await owner.delete(`/api/restaurants/${fakeId}/images/logo`)).status).toBe(404);
    });

    it('lets an admin manage ANY restaurant\'s images, and reliably cleans up even though the admin is not the original uploader', async () => {
      const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('m13-r-admin-o'), role: 'RESTAURANT_OWNER' });
      const { agent: admin } = await createUserWithRole('ADMIN');
      const { restaurant } = await setupOrderable(owner);

      // The owner uploads first — this asset's public_id embeds the OWNER's user id.
      await owner.post(`/api/restaurants/${restaurant._id}/images/logo`).attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });
      const firstPublicId = (await Restaurant.findById(restaurant._id)).logoPublicId;

      // The admin (a DIFFERENT user) replaces it. The old pre-M13 design would have
      // silently failed to clean this up (the URL's embedded owner id is the
      // restaurant owner's, not the admin's) — the stored publicId fixes this.
      const res = await admin.post(`/api/restaurants/${restaurant._id}/images/logo`).attach('image', PNG, { filename: 'b.png', contentType: 'image/png' });
      expect(res.status).toBe(201);
      expect(destroy).toHaveBeenCalledWith(firstPublicId, expect.any(Object));

      const del = await admin.delete(`/api/restaurants/${restaurant._id}/images/logo`);
      expect(del.status).toBe(200);
      expect(del.body.data.restaurant.logo).toBe('');
    });

    it('replace: the new asset is persisted, and ONLY THEN is the old one removed', async () => {
      const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('m13-r-replace'), role: 'RESTAURANT_OWNER' });
      const { restaurant } = await setupOrderable(owner);

      await owner.post(`/api/restaurants/${restaurant._id}/images/image`).attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });
      const first = await Restaurant.findById(restaurant._id);
      expect(destroy).not.toHaveBeenCalled(); // nothing to clean up on the very first upload

      const res = await owner.post(`/api/restaurants/${restaurant._id}/images/image`).attach('image', PNG, { filename: 'b.png', contentType: 'image/png' });
      expect(res.status).toBe(201);
      expect(res.body.data.restaurant.image).not.toBe(first.image);
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(destroy).toHaveBeenCalledWith(first.imagePublicId, expect.any(Object));
    });

    it('a failed upload leaves the existing image completely intact (nothing touched yet)', async () => {
      const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('m13-r-upfail'), role: 'RESTAURANT_OWNER' });
      const { restaurant } = await setupOrderable(owner);
      await owner.post(`/api/restaurants/${restaurant._id}/images/logo`).attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });
      const before = await Restaurant.findById(restaurant._id);

      uploadStream.mockImplementation((options, callback) => ({ end: () => callback(new Error('cloudinary down')) }));
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const res = await owner.post(`/api/restaurants/${restaurant._id}/images/logo`).attach('image', PNG, { filename: 'b.png', contentType: 'image/png' });

      expect(res.status).toBe(502);
      const after = await Restaurant.findById(restaurant._id);
      expect(after.logo).toBe(before.logo);
      expect(after.logoPublicId).toBe(before.logoPublicId);
      expect(destroy).not.toHaveBeenCalled(); // the (still current) old image was never touched
      errSpy.mockRestore();
    });

    it('delete: removes the Cloudinary asset first, and only updates the record once that succeeds', async () => {
      const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('m13-r-del'), role: 'RESTAURANT_OWNER' });
      const { restaurant } = await setupOrderable(owner);
      await owner.post(`/api/restaurants/${restaurant._id}/images/coverImage`).attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });
      const publicId = (await Restaurant.findById(restaurant._id)).coverImagePublicId;

      const res = await owner.delete(`/api/restaurants/${restaurant._id}/images/coverImage`);
      expect(res.status).toBe(200);
      expect(destroy).toHaveBeenCalledWith(publicId, { resource_type: 'image', invalidate: true });
      expect(res.body.data.restaurant.coverImage).toBe('');
      expect((await Restaurant.findById(restaurant._id)).coverImagePublicId).toBeNull();
    });

    it('delete: a genuine Cloudinary failure is reported (502) and the record is left unchanged — never pretends success', async () => {
      const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('m13-r-delfail'), role: 'RESTAURANT_OWNER' });
      const { restaurant } = await setupOrderable(owner);
      await owner.post(`/api/restaurants/${restaurant._id}/images/logo`).attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });
      const before = await Restaurant.findById(restaurant._id);

      destroy.mockRejectedValueOnce(new Error('cloudinary down'));
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const res = await owner.delete(`/api/restaurants/${restaurant._id}/images/logo`);

      expect(res.status).toBe(502);
      const after = await Restaurant.findById(restaurant._id);
      expect(after.logo).toBe(before.logo);
      expect(after.logoPublicId).toBe(before.logoPublicId);
      errSpy.mockRestore();
    });

    it('delete: refuses with 400 when there is no image of that type to delete', async () => {
      const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('m13-r-delnone'), role: 'RESTAURANT_OWNER' });
      const { restaurant } = await setupOrderable(owner);
      expect((await owner.delete(`/api/restaurants/${restaurant._id}/images/logo`)).status).toBe(400);
    });

    it('delete: a legacy record with a URL but no stored publicId still clears the field (best-effort URL-based cleanup)', async () => {
      const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('m13-r-legacy'), role: 'RESTAURANT_OWNER' });
      const ownerId = (await User.findOne({ email: (await owner.get('/api/auth/me')).body.data.user.email }))._id.toString();
      const { restaurant } = await setupOrderable(owner);
      // Simulate a pre-M13 record: a real Cloudinary URL with no publicId ever stored.
      await Restaurant.findByIdAndUpdate(restaurant._id, { logo: cloudUrl(ownerId, 'restaurant', 'aaaaaaaaaaaaaaaaaaaaaaaa'), logoPublicId: null });

      const res = await owner.delete(`/api/restaurants/${restaurant._id}/images/logo`);
      expect(res.status).toBe(200);
      expect(res.body.data.restaurant.logo).toBe('');
      expect(destroy).toHaveBeenCalledWith(`foodrush/restaurant/${ownerId}/aaaaaaaaaaaaaaaaaaaaaaaa`, expect.any(Object));
    });

    it('never trusts a client-supplied publicId on the generic update endpoint — it is always re-derived from the URL', async () => {
      const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('m13-r-notrust'), role: 'RESTAURANT_OWNER' });
      const { restaurant } = await setupOrderable(owner);

      const res = await owner.put(`/api/restaurants/${restaurant._id}`).send({
        logo: 'https://cdn.example.com/not-cloudinary.jpg',
        logoPublicId: 'foodrush/restaurant/someone-elses-id/evil', // must be ignored entirely
      });
      expect(res.status).toBe(200);
      // An external, non-Cloudinary URL correctly derives to null — never the injected value.
      expect((await Restaurant.findById(restaurant._id)).logoPublicId).toBeNull();
    });
  });

  describe('food item image', () => {
    async function ownerWithFood() {
      const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('m13-f-o'), role: 'RESTAURANT_OWNER' });
      const { restaurant, food } = await setupOrderable(owner);
      return { owner, restaurant, food };
    }

    it('uploads and persists both the URL and the real Cloudinary public_id', async () => {
      const { owner, food } = await ownerWithFood();
      const res = await owner.post(`/api/foods/${food._id}/image`).attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });
      expect(res.status).toBe(201);
      const stored = await FoodItem.findById(food._id);
      expect(stored.imagePublicId).toBe(uploadStream.mock.calls[0][0].public_id);
      expect(stored.image).toBe(res.body.data.food.image);
    });

    it('rejects a different restaurant\'s owner (403), a customer (403), and unauthenticated (401)', async () => {
      const { food } = await ownerWithFood();
      const stranger = await registerAndLogin({ name: 'S', email: uniqueEmail('m13-f-stranger'), role: 'RESTAURANT_OWNER' });
      const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('m13-f-cust'), role: 'CUSTOMER' });

      expect((await request(app).post(`/api/foods/${food._id}/image`).attach('image', PNG, 'a.png')).status).toBe(401);
      expect((await customer.post(`/api/foods/${food._id}/image`).attach('image', PNG, 'a.png')).status).toBe(403);
      expect((await stranger.post(`/api/foods/${food._id}/image`).attach('image', PNG, 'a.png')).status).toBe(403);
      expect((await customer.delete(`/api/foods/${food._id}/image`)).status).toBe(403);
    });

    it('returns 404 for an unknown food id', async () => {
      const { owner } = await ownerWithFood();
      const fakeId = '507f1f77bcf86cd799439011';
      expect((await owner.post(`/api/foods/${fakeId}/image`).attach('image', PNG, 'a.png')).status).toBe(404);
      expect((await owner.delete(`/api/foods/${fakeId}/image`)).status).toBe(404);
    });

    it('lets an admin manage any food item\'s image, and reliably cleans up despite not being the original uploader', async () => {
      const { owner, food } = await ownerWithFood();
      const { agent: admin } = await createUserWithRole('ADMIN');
      await owner.post(`/api/foods/${food._id}/image`).attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });
      const firstPublicId = (await FoodItem.findById(food._id)).imagePublicId;

      const res = await admin.post(`/api/foods/${food._id}/image`).attach('image', PNG, { filename: 'b.png', contentType: 'image/png' });
      expect(res.status).toBe(201);
      expect(destroy).toHaveBeenCalledWith(firstPublicId, expect.any(Object));
    });

    it('replace persists the new image before removing the old one; delete removes the asset before clearing the field', async () => {
      const { owner, food } = await ownerWithFood();
      await owner.post(`/api/foods/${food._id}/image`).attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });
      const first = await FoodItem.findById(food._id);

      const replaced = await owner.post(`/api/foods/${food._id}/image`).attach('image', PNG, { filename: 'b.png', contentType: 'image/png' });
      expect(replaced.status).toBe(201);
      expect(destroy).toHaveBeenCalledWith(first.imagePublicId, expect.any(Object));

      const secondPublicId = (await FoodItem.findById(food._id)).imagePublicId;
      const deleted = await owner.delete(`/api/foods/${food._id}/image`);
      expect(deleted.status).toBe(200);
      expect(destroy).toHaveBeenCalledWith(secondPublicId, expect.any(Object));
      expect(deleted.body.data.food.image).toBe('');
    });

    it('delete refuses with 400 when the food item has no image', async () => {
      const { owner, food } = await ownerWithFood();
      expect((await owner.delete(`/api/foods/${food._id}/image`)).status).toBe(400);
    });

    it('a genuine Cloudinary failure during delete is reported (502) and the food item is left unchanged', async () => {
      const { owner, food } = await ownerWithFood();
      await owner.post(`/api/foods/${food._id}/image`).attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });
      const before = await FoodItem.findById(food._id);

      destroy.mockRejectedValueOnce(new Error('cloudinary down'));
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const res = await owner.delete(`/api/foods/${food._id}/image`);

      expect(res.status).toBe(502);
      const after = await FoodItem.findById(food._id);
      expect(after.image).toBe(before.image);
      expect(after.imagePublicId).toBe(before.imagePublicId);
      errSpy.mockRestore();
    });
  });

  describe('backward compatibility and concurrency', () => {
    it('an existing restaurant/food record with no images at all still loads and behaves normally', async () => {
      const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('m13-compat-o'), role: 'RESTAURANT_OWNER' });
      const { restaurant, food } = await setupOrderable(owner);
      const r = await owner.get(`/api/restaurants/${restaurant._id}`);
      expect(r.status).toBe(200);
      expect(r.body.data.restaurant).toMatchObject({ image: '', coverImage: '', logo: '', imagePublicId: null, coverImagePublicId: null, logoPublicId: null });
      const f = await owner.get(`/api/foods/${food._id}`);
      expect(f.body.data.food).toMatchObject({ image: '', imagePublicId: null });
    });

    it('two concurrent replace requests for the same slot both succeed without crashing or corrupting the record', async () => {
      const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('m13-race'), role: 'RESTAURANT_OWNER' });
      const { restaurant } = await setupOrderable(owner);
      await owner.post(`/api/restaurants/${restaurant._id}/images/logo`).attach('image', PNG, { filename: 'seed.png', contentType: 'image/png' });

      // No distributed-transaction guarantee is claimed here — only that neither
      // request crashes and the record ends up in ONE of the two valid end states
      // (whichever write reached MongoDB last), never a corrupted mix.
      const [a, b] = await Promise.all([
        owner.post(`/api/restaurants/${restaurant._id}/images/logo`).attach('image', PNG, { filename: 'a.png', contentType: 'image/png' }),
        owner.post(`/api/restaurants/${restaurant._id}/images/logo`).attach('image', PNG, { filename: 'b.png', contentType: 'image/png' }),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);

      const final = await Restaurant.findById(restaurant._id);
      expect([a.body.data.restaurant.logo, b.body.data.restaurant.logo]).toContain(final.logo);
      expect(final.logoPublicId).toBeTruthy();
    });
  });
});
