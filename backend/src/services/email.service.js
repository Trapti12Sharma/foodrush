const nodemailer = require('nodemailer');

// Provider-agnostic transactional email. Which provider is used is decided purely
// by environment variables, so switching (or adding one) never touches callers:
//
//   EMAIL_PROVIDER=smtp    SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, EMAIL_FROM
//   EMAIL_PROVIDER=resend  RESEND_API_KEY, EMAIL_FROM
//   EMAIL_PROVIDER=log     development/test only — prints the message to the console
//   EMAIL_PROVIDER=none    (default) email disabled
//
// Credentials are read from the environment at send time and never logged.
const PROVIDERS = ['none', 'log', 'smtp', 'resend'];

function getProvider(env = process.env) {
  return String(env.EMAIL_PROVIDER || 'none').trim().toLowerCase();
}

function isEmailConfigured(env = process.env) {
  return getProvider(env) !== 'none';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sendViaSmtp(message, env) {
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || 587,
    secure: String(env.SMTP_SECURE).toLowerCase() === 'true', // true = implicit TLS (port 465)
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  await transport.sendMail({ from: env.EMAIL_FROM, ...message });
}

async function sendViaResend(message, env) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
  });
  // Status only — the response body could echo request details.
  if (!response.ok) throw new Error(`Resend API responded with status ${response.status}`);
}

async function sendMail(message, env = process.env) {
  const provider = getProvider(env);

  switch (provider) {
    case 'smtp':
      return sendViaSmtp(message, env);
    case 'resend':
      return sendViaResend(message, env);
    case 'log':
      if (env.NODE_ENV === 'production') throw new Error('EMAIL_PROVIDER=log is not allowed in production');
      console.log(`[email:log] to=${message.to} subject="${message.subject}"\n${message.text}`);
      return undefined;
    case 'none':
      throw new Error('Email is not configured (EMAIL_PROVIDER is unset)');
    default:
      throw new Error(`Unknown EMAIL_PROVIDER "${provider}"`);
  }
}

// ---- Message templates -----------------------------------------------------------

function passwordResetEmail({ name, resetUrl, expiresInMinutes }) {
  return {
    subject: 'Reset your FoodRush password',
    text:
      `Hi ${name},\n\nWe received a request to reset your FoodRush password. ` +
      `Use the link below within ${expiresInMinutes} minutes:\n\n${resetUrl}\n\n` +
      'If you did not request this, you can ignore this email — your password will not change.',
    html:
      `<p>Hi ${escapeHtml(name)},</p>` +
      `<p>We received a request to reset your FoodRush password. Use the button below within ${expiresInMinutes} minutes.</p>` +
      `<p><a href="${escapeHtml(resetUrl)}" style="background:#ea580c;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Reset password</a></p>` +
      `<p style="color:#666;font-size:13px">If the button doesn't work, paste this link into your browser:<br>${escapeHtml(resetUrl)}</p>` +
      '<p style="color:#666;font-size:13px">If you did not request this, you can ignore this email — your password will not change.</p>',
  };
}

function passwordChangedEmail({ name }) {
  return {
    subject: 'Your FoodRush password was changed',
    text:
      `Hi ${name},\n\nThe password for your FoodRush account was just changed, and you were signed out of other devices. ` +
      'If this was not you, reset your password immediately and contact support.',
    html:
      `<p>Hi ${escapeHtml(name)},</p>` +
      '<p>The password for your FoodRush account was just changed, and you were signed out of other devices.</p>' +
      '<p>If this was not you, reset your password immediately and contact support.</p>',
  };
}

function orderDeliveredEmail({ name, orderNumber }) {
  return {
    subject: `Your FoodRush order ${orderNumber} has been delivered`,
    text: `Hi ${name},\n\nYour FoodRush order ${orderNumber} has been delivered. We hope you enjoy it!\n\nYou can rate your order and the restaurant from your order history.`,
    html:
      `<p>Hi ${escapeHtml(name)},</p>` +
      `<p>Your FoodRush order <strong>${escapeHtml(orderNumber)}</strong> has been delivered. We hope you enjoy it!</p>` +
      '<p>You can rate your order and the restaurant from your order history.</p>',
  };
}

module.exports = {
  PROVIDERS,
  getProvider,
  isEmailConfigured,
  sendMail,
  passwordResetEmail,
  passwordChangedEmail,
  orderDeliveredEmail,
  escapeHtml,
};
