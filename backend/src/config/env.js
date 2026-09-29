// Boot-time configuration check. Called once from server.js so a misconfigured
// deployment refuses to start with a clear message, instead of booting "fine"
// and failing on the first login or the first browser request.
//
// Messages name the variable and the rule only — never the value, so a secret
// can't leak into logs through a validation error.
const { parseOrigins, toOrigin } = require('./cors');
const { PROVIDERS } = require('../services/email.service');

const PLACEHOLDER_SECRETS = new Set(['replace_with_a_long_random_string', 'changeme', 'secret', 'your_jwt_secret']);
const MIN_JWT_SECRET_LENGTH_PROD = 32;
const MIN_JWT_SECRET_LENGTH_DEV = 16;

function isLocalhostOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

// Pure function (env in, {errors, warnings} out) so it is unit-testable without
// touching process.env or exiting the process.
function validateEnv(env = process.env) {
  const errors = [];
  const warnings = [];
  const isProd = env.NODE_ENV === 'production';

  if (!env.MONGODB_URI) {
    errors.push('MONGODB_URI is required.');
  } else if (!/^mongodb(\+srv)?:\/\//.test(env.MONGODB_URI.trim())) {
    errors.push('MONGODB_URI must start with mongodb:// or mongodb+srv://.');
  }

  const secret = env.JWT_SECRET || '';
  if (!secret) {
    errors.push('JWT_SECRET is required.');
  } else if (PLACEHOLDER_SECRETS.has(secret.trim().toLowerCase())) {
    (isProd ? errors : warnings).push('JWT_SECRET is still a placeholder value — set a long random string.');
  } else if (secret.length < (isProd ? MIN_JWT_SECRET_LENGTH_PROD : MIN_JWT_SECRET_LENGTH_DEV)) {
    (isProd ? errors : warnings).push(
      `JWT_SECRET is too short (minimum ${isProd ? MIN_JWT_SECRET_LENGTH_PROD : MIN_JWT_SECRET_LENGTH_DEV} characters).`
    );
  }

  if (env.JWT_EXPIRES_IN && !/^\d+[smhd]$/.test(env.JWT_EXPIRES_IN.trim())) {
    // token.service.js silently falls back to 7d for the cookie on a bad value — catch it here.
    errors.push('JWT_EXPIRES_IN must look like 30m, 12h or 7d.');
  }

  if (env.MAX_UPLOAD_SIZE_MB && !(Number(env.MAX_UPLOAD_SIZE_MB) > 0)) {
    errors.push('MAX_UPLOAD_SIZE_MB must be a positive number.');
  }

  const configuredOrigins = [env.CLIENT_URL, ...(env.CLIENT_URLS || '').split(',')].filter((v) => v && v.trim());
  if (configuredOrigins.length === 0) {
    (isProd ? errors : warnings).push('CLIENT_URL (or CLIENT_URLS) is not set — the frontend origin will not be allowed by CORS.');
  } else {
    const parsed = parseOrigins(env);
    // M18 — validate each entry individually. This used to compare
    // parseOrigins().length against configuredOrigins.length, but parseOrigins
    // DE-DUPLICATES, so listing the same origin in both CLIENT_URL and
    // CLIENT_URLS made a valid configuration look like it contained a malformed
    // one and the server refused to boot — pointing at a typo that did not
    // exist. Naming the offending value also beats saying only that one exists.
    const invalid = configuredOrigins.filter((value) => !toOrigin(value));
    if (invalid.length > 0) {
      errors.push(`CLIENT_URL / CLIENT_URLS contains an entry that is not a valid http(s) URL: ${invalid.map((v) => JSON.stringify(String(v).trim())).join(', ')}.`);
    }
    if (isProd) {
      parsed
        .filter((origin) => !origin.startsWith('https://') && !isLocalhostOrigin(origin))
        .forEach(() => errors.push('In production, every CLIENT_URL / CLIENT_URLS entry must use https://.'));
    }
  }

  validateEmailConfig(env, isProd, errors, warnings);
  validateStorageConfig(env, isProd, errors, warnings);
  validateLocationConfig(env, isProd, errors, warnings);
  validatePaymentConfig(env, isProd, errors, warnings);
  validateDeliveryOtpConfig(env, errors);
  validateDeliveryEarningConfig(env, errors);
  validateNotificationConfig(env, errors);

  return { errors, warnings };
}

// Optional — notification.service.js defaults to 3 when unset. Only rejects a
// genuinely nonsensical value; email itself is governed entirely by the
// existing EMAIL_PROVIDER config validated below, nothing new to check there.
function validateNotificationConfig(env, errors) {
  if (env.NOTIFICATION_EMAIL_MAX_ATTEMPTS && !(Number.isInteger(Number(env.NOTIFICATION_EMAIL_MAX_ATTEMPTS)) && Number(env.NOTIFICATION_EMAIL_MAX_ATTEMPTS) > 0)) {
    errors.push('NOTIFICATION_EMAIL_MAX_ATTEMPTS must be a positive whole number.');
  }
}

// Both optional — deliveryOtp.service.js already has sensible defaults (30 minutes,
// 5 attempts) when unset. Only rejects a genuinely nonsensical value.
function validateDeliveryOtpConfig(env, errors) {
  if (env.DELIVERY_OTP_EXPIRY_MINUTES && !(Number(env.DELIVERY_OTP_EXPIRY_MINUTES) > 0)) {
    errors.push('DELIVERY_OTP_EXPIRY_MINUTES must be a positive number.');
  }
  if (env.DELIVERY_OTP_MAX_ATTEMPTS && !(Number.isInteger(Number(env.DELIVERY_OTP_MAX_ATTEMPTS)) && Number(env.DELIVERY_OTP_MAX_ATTEMPTS) > 0)) {
    errors.push('DELIVERY_OTP_MAX_ATTEMPTS must be a positive whole number.');
  }
}

// All optional. Since M17 these are SEED values only: PlatformSetting reads them
// the first time the settings row is created and never again, after which a
// SUPER_ADMIN edits the live rates at /admin/settings. Validating them still
// matters — a malformed seed would otherwise become a malformed stored rate on a
// brand-new deployment, where nobody has opened the settings screen yet.
// Only rejects a genuinely nonsensical value (never a business-rule opinion).
function validateDeliveryEarningConfig(env, errors) {
  const positiveIfSet = (key) => {
    if (env[key] && !(Number(env[key]) >= 0)) errors.push(`${key} must be a non-negative number.`);
  };
  ['DELIVERY_BASE_EARNING', 'DELIVERY_PER_KM_RATE', 'DELIVERY_MIN_EARNING', 'DELIVERY_MAX_EARNING'].forEach(positiveIfSet);
  if (env.DELIVERY_MIN_EARNING && env.DELIVERY_MAX_EARNING && Number(env.DELIVERY_MIN_EARNING) > Number(env.DELIVERY_MAX_EARNING)) {
    errors.push('DELIVERY_MIN_EARNING cannot be greater than DELIVERY_MAX_EARNING.');
  }
}

// Google Maps is optional: without a key the app still works (GPS + popular cities), address
// search is simply off. GEO_COUNTRY must be a two-letter country code. Names variables only.
function validateLocationConfig(env, isProd, errors, warnings) {
  if (env.GEO_COUNTRY && !/^[A-Za-z]{2}$/.test(env.GEO_COUNTRY.trim())) {
    errors.push('GEO_COUNTRY must be a two-letter country code, e.g. in.');
  }
  if (!env.GOOGLE_MAPS_API_KEY && isProd) {
    warnings.push('GOOGLE_MAPS_API_KEY is not set — address search is disabled (GPS and popular cities still work).');
  }
}

// Cloudinary needs all three settings; a partial set is almost certainly a mistake and would
// silently fall back to non-persistent local storage, so it is fatal. Names variables only.
function validateStorageConfig(env, isProd, errors, warnings) {
  const keys = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const missing = keys.filter((key) => !env[key]);
  if (missing.length > 0 && missing.length < keys.length) {
    errors.push(`Cloudinary is partially configured — also set: ${missing.join(', ')} (or clear the others).`);
  } else if (missing.length === keys.length && isProd) {
    warnings.push('Cloudinary is not configured — uploaded images will be lost on every restart or deploy.');
  }
}

// Razorpay is optional (COD still works without it) but a PARTIAL key pair is almost
// certainly a mistake and would otherwise fail confusingly on the first checkout —
// fatal, like Cloudinary's partial-config check. The webhook secret is checked
// separately: online payments still work without it (the synchronous verify-payment
// call is enough), it just loses the safety net for a customer who never calls back.
function validatePaymentConfig(env, isProd, errors, warnings) {
  const hasId = Boolean(env.RAZORPAY_KEY_ID);
  const hasSecret = Boolean(env.RAZORPAY_KEY_SECRET);
  if (hasId !== hasSecret) {
    errors.push('Razorpay is partially configured — set both RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (or clear both).');
    return;
  }
  if (hasId && hasSecret && !env.RAZORPAY_WEBHOOK_SECRET && isProd) {
    warnings.push('RAZORPAY_WEBHOOK_SECRET is not set — payment/refund confirmation relies only on the customer\'s browser calling back.');
  }
}

// Names the missing/invalid variable only — never a value.
function validateEmailConfig(env, isProd, errors, warnings) {
  const provider = String(env.EMAIL_PROVIDER || 'none').trim().toLowerCase();

  if (!PROVIDERS.includes(provider)) {
    errors.push(`EMAIL_PROVIDER must be one of: ${PROVIDERS.join(', ')}.`);
    return;
  }
  if (provider === 'none') {
    if (isProd) warnings.push('EMAIL_PROVIDER is not set — password-reset emails will not be delivered.');
    return;
  }
  if (provider === 'log' && isProd) {
    errors.push('EMAIL_PROVIDER=log is for development only and is not allowed in production.');
    return;
  }
  if (provider === 'log') return;

  if (!env.EMAIL_FROM) errors.push(`EMAIL_FROM is required when EMAIL_PROVIDER=${provider}.`);
  if (provider === 'smtp') {
    if (!env.SMTP_HOST) errors.push('SMTP_HOST is required when EMAIL_PROVIDER=smtp.');
    if (env.SMTP_PORT && !(Number(env.SMTP_PORT) > 0)) errors.push('SMTP_PORT must be a positive number.');
    if (env.SMTP_USER && !env.SMTP_PASS) errors.push('SMTP_PASS is required when SMTP_USER is set.');
  }
  if (provider === 'resend' && !env.RESEND_API_KEY) errors.push('RESEND_API_KEY is required when EMAIL_PROVIDER=resend.');
}

// Logs warnings, and exits the process with a readable list if anything is fatal.
function assertEnv(env = process.env) {
  const { errors, warnings } = validateEnv(env);
  warnings.forEach((w) => console.warn(`[config] warning: ${w}`));

  if (errors.length > 0) {
    console.error('[config] Refusing to start — fix these environment problems:');
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
}

module.exports = { validateEnv, assertEnv };
