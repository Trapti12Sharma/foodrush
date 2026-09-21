const nodemailer = require('nodemailer');
const emailService = require('../src/services/email.service');
const { validateEnv } = require('../src/config/env');

const message = { to: 'user@example.com', subject: 'Hello', text: 'Plain body', html: '<p>Body</p>' };

describe('provider selection', () => {
  it('defaults to none and reports email as unconfigured', () => {
    expect(emailService.getProvider({})).toBe('none');
    expect(emailService.isEmailConfigured({})).toBe(false);
    expect(emailService.isEmailConfigured({ EMAIL_PROVIDER: 'smtp' })).toBe(true);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(emailService.getProvider({ EMAIL_PROVIDER: '  SMTP ' })).toBe('smtp');
  });

  it('refuses to send when email is disabled or the provider is unknown', async () => {
    await expect(emailService.sendMail(message, {})).rejects.toThrow(/not configured/);
    await expect(emailService.sendMail(message, { EMAIL_PROVIDER: 'carrier-pigeon' })).rejects.toThrow(/Unknown EMAIL_PROVIDER/);
  });
});

describe('log provider (development only)', () => {
  it('prints the message instead of sending it', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await emailService.sendMail(message, { EMAIL_PROVIDER: 'log', NODE_ENV: 'development' });
    expect(logSpy.mock.calls[0][0]).toContain('to=user@example.com');
    logSpy.mockRestore();
  });

  it('is refused in production, so reset links can never end up in production logs', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(emailService.sendMail(message, { EMAIL_PROVIDER: 'log', NODE_ENV: 'production' })).rejects.toThrow(/not allowed in production/);
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});

describe('smtp provider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('builds a transport from the SMTP_* variables and sends from EMAIL_FROM', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    const create = jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail });
    await emailService.sendMail(message, {
      EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'FoodRush <no-reply@example.com>',
      SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_USER: 'u', SMTP_PASS: 'p',
    });
    expect(create).toHaveBeenCalledWith({ host: 'smtp.example.com', port: 465, secure: true, auth: { user: 'u', pass: 'p' } });
    expect(sendMail).toHaveBeenCalledWith({ from: 'FoodRush <no-reply@example.com>', ...message });
  });

  it('uses port 587, STARTTLS and no auth block by default', async () => {
    const create = jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: jest.fn().mockResolvedValue({}) });
    await emailService.sendMail(message, { EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'a@example.com', SMTP_HOST: 'localhost' });
    expect(create).toHaveBeenCalledWith({ host: 'localhost', port: 587, secure: false, auth: undefined });
  });

  it('actually delivers a well-formed message through nodemailer (stream transport, no network)', async () => {
    const real = nodemailer.createTransport({ streamTransport: true, buffer: true });
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue(real);
    const sendSpy = jest.spyOn(real, 'sendMail');
    await emailService.sendMail(message, { EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'FoodRush <no-reply@example.com>', SMTP_HOST: 'x' });
    const info = await sendSpy.mock.results[0].value;
    const raw = info.message.toString();
    expect(raw).toMatch(/From: FoodRush <no-reply@example.com>/);
    expect(raw).toMatch(/To: user@example.com/);
    expect(raw).toMatch(/Subject: Hello/);
    expect(raw).toContain('Plain body');
    expect(raw).toContain('<p>Body</p>');
  });

  it('propagates transport failures', async () => {
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: jest.fn().mockRejectedValue(new Error('connection refused')) });
    await expect(emailService.sendMail(message, { EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'a@example.com', SMTP_HOST: 'x' })).rejects.toThrow('connection refused');
  });
});

describe('resend provider', () => {
  const env = { EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'FoodRush <no-reply@example.com>', RESEND_API_KEY: 're_test_key_123' };
  let fetchSpy;
  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it('POSTs to the Resend API with a bearer key and the message', async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200 });
    await emailService.sendMail(message, env);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer re_test_key_123');
    expect(JSON.parse(options.body)).toEqual({
      from: 'FoodRush <no-reply@example.com>', to: ['user@example.com'], subject: 'Hello', text: 'Plain body', html: '<p>Body</p>',
    });
  });

  it('reports only the HTTP status on failure — never the key or the response body', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid key re_test_key_123' });
    const error = await emailService.sendMail(message, env).catch((e) => e);
    expect(error.message).toBe('Resend API responded with status 401');
    expect(error.message).not.toContain('re_test_key_123');
  });
});

describe('message templates', () => {
  it('builds a reset email containing the link, and escapes HTML in the user-controlled name', () => {
    const m = emailService.passwordResetEmail({ name: '<script>alert(1)</script>', resetUrl: 'https://app.example.com/reset-password?token=abc&x=1', expiresInMinutes: 30 });
    expect(m.text).toContain('https://app.example.com/reset-password?token=abc&x=1');
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).toContain('token=abc&amp;x=1');
    expect(m.text).toContain('30 minutes');
  });

  it('builds a password-changed notice', () => {
    const m = emailService.passwordChangedEmail({ name: 'Asha' });
    expect(m.subject).toBe('Your FoodRush password was changed');
    expect(m.text).toContain('Asha');
  });
});

describe('boot-time validation of email settings', () => {
  const base = {
    NODE_ENV: 'production', MONGODB_URI: 'mongodb+srv://u:p@c.example.mongodb.net/db',
    JWT_SECRET: 'a'.repeat(40), CLIENT_URL: 'https://foodrush.example.com',
  };
  const errorsFor = (extra) => validateEnv({ ...base, ...extra }).errors.join(' | ');

  it('accepts a complete smtp or resend configuration', () => {
    expect(errorsFor({ EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'a@example.com', SMTP_HOST: 'smtp.example.com' })).toBe('');
    expect(errorsFor({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'a@example.com', RESEND_API_KEY: 'k' })).toBe('');
  });

  it('names each missing variable, never a value', () => {
    expect(errorsFor({ EMAIL_PROVIDER: 'smtp' })).toMatch(/EMAIL_FROM.*SMTP_HOST/);
    expect(errorsFor({ EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'a@example.com', SMTP_HOST: 'h', SMTP_USER: 'u' })).toMatch(/SMTP_PASS/);
    expect(errorsFor({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'a@example.com' })).toMatch(/RESEND_API_KEY/);
    expect(errorsFor({ EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'a@example.com', SMTP_HOST: 'h', SMTP_PORT: 'abc' })).toMatch(/SMTP_PORT/);
    expect(errorsFor({ EMAIL_PROVIDER: 'nonsense' })).toMatch(/EMAIL_PROVIDER must be one of/);
  });

  it('forbids the log provider in production but allows it in development', () => {
    expect(errorsFor({ EMAIL_PROVIDER: 'log' })).toMatch(/not allowed in production/);
    expect(validateEnv({ ...base, NODE_ENV: 'development', EMAIL_PROVIDER: 'log' }).errors).toEqual([]);
  });

  it('only warns (does not block boot) when email is disabled in production', () => {
    const result = validateEnv(base);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/EMAIL_PROVIDER is not set/);
  });
});
