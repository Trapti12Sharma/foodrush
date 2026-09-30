const crypto = require('crypto');

// Delivery-completion OTP (M9). Encrypted, not hashed — see the long comment on
// Order.deliveryOtpCipher in models/Order.js for why: the customer must be able
// to re-view the exact code on demand, which a one-way hash cannot support.
// AES-256-GCM (authenticated encryption — tampering with the stored value is
// detected, not silently accepted) with a key derived from the existing
// JWT_SECRET, so no new secret needs provisioning and nothing new can leak.
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

const OTP_EXPIRY_MINUTES = Number(process.env.DELIVERY_OTP_EXPIRY_MINUTES) || 30;
const MAX_ATTEMPTS = Number(process.env.DELIVERY_OTP_MAX_ATTEMPTS) || 5;

function deriveKey() {
  // A fixed, deterministic 32-byte key from JWT_SECRET — env.js already requires
  // JWT_SECRET to be long and random (32+ chars in production), and the ":delivery-otp"
  // suffix domain-separates this from JWT signing so the two uses can never collide.
  return crypto.createHash('sha256').update(`${process.env.JWT_SECRET}:delivery-otp`).digest();
}

// A uniformly random 6-digit code, backed by the OS CSPRNG (crypto.randomInt),
// never Math.random(). Zero-padded so e.g. 42 reads as "000042", not "42".
function generatePlainOtp() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

// iv + authTag + ciphertext, base64, dot-joined into one string field.
function encryptOtp(plainOtp) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plainOtp, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((buf) => buf.toString('base64')).join('.');
}

// Returns null (never throws) on anything malformed or tampered — callers treat
// that identically to "no OTP", which is the correct, safe default.
function decryptOtp(stored) {
  if (!stored) return null;
  const [ivB64, tagB64, dataB64] = stored.split('.');
  if (!ivB64 || !tagB64 || !dataB64) return null;
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    return null;
  }
}

// Constant-time string comparison — a 6-digit OTP is low-entropy enough that
// even a small timing leak on "how many leading digits matched" is worth
// closing off, and it costs nothing to do properly.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false; // timingSafeEqual requires equal-length buffers
  return crypto.timingSafeEqual(bufA, bufB);
}

// The full set of fields a fresh OTP writes — used both by acceptAssignment (a
// $set inside its own atomic order-claim update) and nowhere else, since this is
// the only place a NEW delivery OTP is ever generated in this milestone (no
// resend/regenerate endpoint yet — see deliveryAssignment.service.js).
function freshOtpFields() {
  const otp = generatePlainOtp();
  return {
    otp, // returned only so a future email/SMS notification hook could use it — never logged, never returned by any HTTP response
    fields: {
      deliveryOtpCipher: encryptOtp(otp),
      deliveryOtpExpiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
      deliveryOtpAttempts: 0,
      deliveryOtpGeneratedAt: new Date(),
      deliveryOtpVerifiedAt: null,
    },
  };
}

module.exports = {
  OTP_EXPIRY_MINUTES,
  MAX_ATTEMPTS,
  freshOtpFields,
  decryptOtp,
  safeEqual,
};
