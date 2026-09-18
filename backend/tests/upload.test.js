require('./setup');
const fs = require('fs');
const path = require('path');
const { app, registerAndLogin, uniqueEmail } = require('./helpers');
const request = require('supertest');

// A genuinely decodable 1x1 PNG, not just bytes with the right extension.
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

describe('Image upload', () => {
  const uploadedFiles = [];

  afterAll(() => {
    uploadedFiles.forEach((url) => {
      const filePath = path.join(__dirname, '..', url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
  });

  it('rejects an unauthenticated upload', async () => {
    const res = await request(app).post('/api/uploads/image').attach('image', PNG_BUFFER, 'test.png');
    expect(res.status).toBe(401);
  });

  it('rejects a non-image file', async () => {
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('up-cust'), role: 'CUSTOMER' });
    const res = await customer.post('/api/uploads/image').attach('image', Buffer.from('hello'), 'note.txt');
    expect(res.status).toBe(400);
  });

  it('accepts a valid image and serves it back statically', async () => {
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('up-cust2'), role: 'CUSTOMER' });
    const res = await customer.post('/api/uploads/image').attach('image', PNG_BUFFER, 'test.png');
    expect(res.status).toBe(201);
    expect(res.body.data.url).toMatch(/^\/uploads\//);
    uploadedFiles.push(res.body.data.url);

    const staticRes = await request(app).get(res.body.data.url);
    expect(staticRes.status).toBe(200);
    expect(staticRes.headers['content-type']).toMatch(/^image\//);
  });

  it('rejects a file larger than the configured limit', async () => {
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('up-cust3'), role: 'CUSTOMER' });
    const bigBuffer = Buffer.alloc(6 * 1024 * 1024, 0); // over the 5MB default
    const res = await customer.post('/api/uploads/image').attach('image', bigBuffer, 'big.png');
    expect(res.status).toBe(400);
  });
});
