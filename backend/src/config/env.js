// Boot-time configuration check. Called once from server.js so a misconfigured
// deployment refuses to start with a clear message, instead of booting "fine"
// and failing on the first login or the first browser request.
//
// Messages name the variable and the rule only — never the value, so a secret
// can't leak into logs through a validation error.
const { parseOrigins } = require('./cors');
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
    if (parsed.length < configuredOrigins.length) {
      errors.push('CLIENT_URL / CLIENT_URLS contains an entry that is not a valid http(s) URL.');
    }
    if (isProd) {
      parsed
        .filter((origin) => !origin.startsWith('https://') && !isLocalhostOrigin(origin))
        .forEach(() => errors.push('In production, every CLIENT_URL / CLIENT_URLS entry must use https://.'));
    }
  }

  validateEmailConfig(env, isProd, errors, warnings);

  return { errors, warnings };
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
