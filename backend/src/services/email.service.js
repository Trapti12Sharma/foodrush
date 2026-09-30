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

// ---- M12 notification templates --------------------------------------------
// Same shape as every template above: {subject, text, html}. Deliberately plain
// — a short, factual line plus the one relevant number/id, never anything
// credential- or OTP-shaped (see notification.service.js, which decides WHETHER
// to call these; this file only ever decides HOW the email reads).

function orderPlacedEmail({ name, orderNumber, totalAmount }) {
  return {
    subject: `Order ${orderNumber} placed — FoodRush`,
    text: `Hi ${name},\n\nYour FoodRush order ${orderNumber} (₹${totalAmount}) has been placed. We'll notify you as it progresses.`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>Your FoodRush order <strong>${escapeHtml(orderNumber)}</strong> (₹${totalAmount}) has been placed. We'll notify you as it progresses.</p>`,
  };
}

function orderConfirmedEmail({ name, orderNumber }) {
  return {
    subject: `Order ${orderNumber} confirmed — FoodRush`,
    text: `Hi ${name},\n\nThe restaurant has confirmed your FoodRush order ${orderNumber} and is preparing it.`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>The restaurant has confirmed your FoodRush order <strong>${escapeHtml(orderNumber)}</strong> and is preparing it.</p>`,
  };
}

function orderRejectedEmail({ name, orderNumber, reason }) {
  return {
    subject: `Order ${orderNumber} was rejected — FoodRush`,
    text: `Hi ${name},\n\nWe're sorry — your FoodRush order ${orderNumber} was rejected by the restaurant${reason ? ` (${reason})` : ''}. If you paid online, a refund has been started automatically.`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>We're sorry — your FoodRush order <strong>${escapeHtml(orderNumber)}</strong> was rejected by the restaurant${reason ? ` (${escapeHtml(reason)})` : ''}. If you paid online, a refund has been started automatically.</p>`,
  };
}

function orderCancelledEmail({ name, orderNumber, reason }) {
  return {
    subject: `Order ${orderNumber} cancelled — FoodRush`,
    text: `Hi ${name},\n\nYour FoodRush order ${orderNumber} has been cancelled${reason ? ` (${reason})` : ''}. If you paid online, a refund has been started automatically.`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>Your FoodRush order <strong>${escapeHtml(orderNumber)}</strong> has been cancelled${reason ? ` (${escapeHtml(reason)})` : ''}. If you paid online, a refund has been started automatically.</p>`,
  };
}

function paymentSuccessEmail({ name, orderNumber, amount }) {
  return {
    subject: `Payment received for order ${orderNumber} — FoodRush`,
    text: `Hi ${name},\n\nWe've received your payment of ₹${amount} for FoodRush order ${orderNumber}.`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>We've received your payment of ₹${amount} for FoodRush order <strong>${escapeHtml(orderNumber)}</strong>.</p>`,
  };
}

function paymentFailedEmail({ name, orderNumber }) {
  return {
    subject: `Payment failed for order ${orderNumber} — FoodRush`,
    text: `Hi ${name},\n\nYour payment for FoodRush order ${orderNumber} could not be completed. No amount has been charged.`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>Your payment for FoodRush order <strong>${escapeHtml(orderNumber)}</strong> could not be completed. No amount has been charged.</p>`,
  };
}

function paymentRetryRequiredEmail({ name, orderNumber }) {
  return {
    subject: `Complete payment for order ${orderNumber} — FoodRush`,
    text: `Hi ${name},\n\nYour payment for FoodRush order ${orderNumber} didn't go through. You can retry payment from your order page.`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>Your payment for FoodRush order <strong>${escapeHtml(orderNumber)}</strong> didn't go through. You can retry payment from your order page.</p>`,
  };
}

function refundCreatedEmail({ name, orderNumber, amount }) {
  return {
    subject: `Refund started for order ${orderNumber} — FoodRush`,
    text: `Hi ${name},\n\nA refund of ₹${amount} for FoodRush order ${orderNumber} has been started. It can take a few days to reflect in your account.`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>A refund of ₹${amount} for FoodRush order <strong>${escapeHtml(orderNumber)}</strong> has been started. It can take a few days to reflect in your account.</p>`,
  };
}

function refundFailedEmail({ name, orderNumber, amount }) {
  return {
    subject: `Refund issue for order ${orderNumber} — FoodRush`,
    text: `Hi ${name},\n\nWe ran into an issue processing your ₹${amount} refund for FoodRush order ${orderNumber}. Our team has been notified and will follow up.`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>We ran into an issue processing your ₹${amount} refund for FoodRush order <strong>${escapeHtml(orderNumber)}</strong>. Our team has been notified and will follow up.</p>`,
  };
}

function refundCompletedEmail({ name, orderNumber, amount }) {
  return {
    subject: `Refund completed for order ${orderNumber} — FoodRush`,
    text: `Hi ${name},\n\nYour refund of ₹${amount} for FoodRush order ${orderNumber} is complete.`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>Your refund of ₹${amount} for FoodRush order <strong>${escapeHtml(orderNumber)}</strong> is complete.</p>`,
  };
}

function deliveryAssignedEmail({ name, orderNumber }) {
  return {
    subject: `New delivery offer — FoodRush`,
    text: `Hi ${name},\n\nYou have a new delivery offer for order ${orderNumber}. Open the FoodRush app to accept or decline.`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>You have a new delivery offer for order <strong>${escapeHtml(orderNumber)}</strong>. Open the FoodRush app to accept or decline.</p>`,
  };
}

function orderOutForDeliveryEmail({ name, orderNumber }) {
  return {
    subject: `Order ${orderNumber} is out for delivery — FoodRush`,
    text: `Hi ${name},\n\nYour FoodRush order ${orderNumber} is on its way!`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>Your FoodRush order <strong>${escapeHtml(orderNumber)}</strong> is on its way!</p>`,
  };
}

function supportTicketCreatedEmail({ name, ticketNumber }) {
  return {
    subject: `Support ticket ${ticketNumber} received — FoodRush`,
    text: `Hi ${name},\n\nWe've received your support ticket ${ticketNumber} and will get back to you soon.`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>We've received your support ticket <strong>${escapeHtml(ticketNumber)}</strong> and will get back to you soon.</p>`,
  };
}

function supportTicketReplyEmail({ name, ticketNumber }) {
  return {
    subject: `New reply on ticket ${ticketNumber} — FoodRush`,
    text: `Hi ${name},\n\nThere's a new reply on your support ticket ${ticketNumber}.`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>There's a new reply on your support ticket <strong>${escapeHtml(ticketNumber)}</strong>.</p>`,
  };
}

function supportTicketResolvedEmail({ name, ticketNumber }) {
  return {
    subject: `Ticket ${ticketNumber} resolved — FoodRush`,
    text: `Hi ${name},\n\nYour support ticket ${ticketNumber} has been marked resolved. Reply if you still need help.`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>Your support ticket <strong>${escapeHtml(ticketNumber)}</strong> has been marked resolved. Reply if you still need help.</p>`,
  };
}

function settlementPaidEmail({ name, netAmount }) {
  return {
    subject: `Settlement paid — FoodRush`,
    text: `Hi ${name},\n\nYour delivery-earnings settlement of ₹${netAmount} has been marked paid.`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>Your delivery-earnings settlement of ₹${netAmount} has been marked paid.</p>`,
  };
}

function settlementFailedEmail({ name, reason }) {
  return {
    subject: `Settlement payout issue — FoodRush`,
    text: `Hi ${name},\n\nThere was an issue with your delivery-earnings settlement payout${reason ? ` (${reason})` : ''}. Our team has been notified.`,
    html: `<p>Hi ${escapeHtml(name)},</p><p>There was an issue with your delivery-earnings settlement payout${reason ? ` (${escapeHtml(reason)})` : ''}. Our team has been notified.</p>`,
  };
}

// M17 — a staff invite. Distinct from passwordResetEmail because the recipient
// has no password to reset: they are being told an account now exists and asked
// to set one. Naming the role and the inviter matters for a security email —
// someone who was not expecting to be made a DELIVERY_MANAGER should be able to
// tell at a glance that something is wrong.
function staffInviteEmail({ name, role, inviteUrl, expiresInDays, invitedBy }) {
  return {
    subject: 'You have been added to the FoodRush team',
    text:
      `Hi ${name},\n\n${invitedBy} has created a FoodRush staff account for you with the role ${role}. ` +
      `Set your password using the link below within ${expiresInDays} days:\n\n${inviteUrl}\n\n` +
      'The link can only be used once. If you were not expecting this, do not use it — reply to this email or contact your administrator.',
    html:
      `<p>Hi ${escapeHtml(name)},</p>` +
      `<p>${escapeHtml(invitedBy)} has created a FoodRush staff account for you with the role <strong>${escapeHtml(role)}</strong>. Set your password using the button below within ${expiresInDays} days.</p>` +
      `<p><a href="${escapeHtml(inviteUrl)}" style="background:#ea580c;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Set your password</a></p>` +
      `<p style="color:#666;font-size:13px">If the button doesn't work, paste this link into your browser:<br>${escapeHtml(inviteUrl)}</p>` +
      '<p style="color:#666;font-size:13px">The link can only be used once. If you were not expecting this, do not use it — contact your administrator.</p>',
  };
}

module.exports = {
  PROVIDERS,
  getProvider,
  isEmailConfigured,
  sendMail,
  passwordResetEmail,
  staffInviteEmail,
  passwordChangedEmail,
  orderDeliveredEmail,
  orderPlacedEmail,
  orderConfirmedEmail,
  orderRejectedEmail,
  orderCancelledEmail,
  paymentSuccessEmail,
  paymentFailedEmail,
  paymentRetryRequiredEmail,
  refundCreatedEmail,
  refundFailedEmail,
  refundCompletedEmail,
  deliveryAssignedEmail,
  orderOutForDeliveryEmail,
  supportTicketCreatedEmail,
  supportTicketReplyEmail,
  supportTicketResolvedEmail,
  settlementPaidEmail,
  settlementFailedEmail,
  escapeHtml,
};
