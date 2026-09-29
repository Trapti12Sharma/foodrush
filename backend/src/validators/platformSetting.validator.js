const { body } = require('express-validator');

// M17 — every field is optional (a PATCH only touches what it sends) but must be
// a real number/boolean when present, and inside the same bounds the model
// declares. The bounds are stated in BOTH places deliberately: here they produce
// a 422 naming the field, which is what an operator needs, while the model's
// copy is the guarantee that holds for a migration or a seed script that never
// passes through this layer.
//
// `version` is the only REQUIRED field — it carries the optimistic-concurrency
// check (see platformSetting.service.js#updateSettings). A request without it is
// rejected here rather than being quietly treated as "force overwrite".
const updateSettingsValidator = [
  body('version').exists().withMessage('version is required — send the version you read, so a concurrent edit is detected').bail().isInt({ min: 1 }).withMessage('version must be a positive integer').toInt(),

  body('pricing.taxRate')
    .optional()
    .isFloat({ min: 0, max: 0.5 })
    .withMessage('pricing.taxRate must be a fraction between 0 and 0.5 (0.05 = 5%)')
    .toFloat(),

  body('delivery.baseEarning').optional().isFloat({ min: 0, max: 10000 }).withMessage('delivery.baseEarning must be between 0 and 10000').toFloat(),
  body('delivery.perKmRate').optional().isFloat({ min: 0, max: 1000 }).withMessage('delivery.perKmRate must be between 0 and 1000').toFloat(),
  body('delivery.minEarning').optional().isFloat({ min: 0, max: 10000 }).withMessage('delivery.minEarning must be between 0 and 10000').toFloat(),

  // Explicitly nullable: null means "no cap", and is the only way to REMOVE a cap
  // once one is set. `optional({ nullable: true })` would skip the check for null
  // and never convert it, so the null is allowed through a custom check instead.
  body('delivery.maxEarning')
    .optional({ nullable: true })
    .custom((value) => {
      if (value === null) return true; // removes the cap
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 100000) {
        throw new Error('delivery.maxEarning must be between 0 and 100000, or null for no cap');
      }
      return true;
    })
    .customSanitizer((value) => (value === null ? null : Number(value))),

  body('delivery.incentives.longDistance.enabled').optional().isBoolean().withMessage('delivery.incentives.longDistance.enabled must be a boolean').toBoolean(),
  body('delivery.incentives.longDistance.thresholdKm').optional().isFloat({ min: 0, max: 500 }).withMessage('delivery.incentives.longDistance.thresholdKm must be between 0 and 500').toFloat(),
  body('delivery.incentives.longDistance.bonusAmount').optional().isFloat({ min: 0, max: 10000 }).withMessage('delivery.incentives.longDistance.bonusAmount must be between 0 and 10000').toFloat(),

  body('delivery.incentives.peakHour.enabled').optional().isBoolean().withMessage('delivery.incentives.peakHour.enabled must be a boolean').toBoolean(),
  body('delivery.incentives.peakHour.bonusAmount').optional().isFloat({ min: 0, max: 10000 }).withMessage('delivery.incentives.peakHour.bonusAmount must be between 0 and 10000').toFloat(),

  // Windows are replaced wholesale rather than patched per-index: an array of
  // hour ranges has no stable identity to patch against, and "replace the set"
  // is what the console's editor actually does. Capped at 8 — more than that is
  // a mistake, not a schedule.
  body('delivery.incentives.peakHour.windows')
    .optional()
    .isArray({ max: 8 })
    .withMessage('delivery.incentives.peakHour.windows must be an array of at most 8 windows'),
  body('delivery.incentives.peakHour.windows.*.startHour')
    .optional()
    .isInt({ min: 0, max: 23 })
    .withMessage('each window startHour must be a whole hour from 0 to 23 (UTC)')
    .toInt(),
  body('delivery.incentives.peakHour.windows.*.endHour')
    .optional()
    .isInt({ min: 0, max: 23 })
    .withMessage('each window endHour must be a whole hour from 0 to 23 (UTC)')
    .toInt(),
  // Each window must carry BOTH hours. Without this, `[{ startHour: 9 }]` would
  // pass every rule above (the missing endHour is merely "optional") and reach
  // the model, which would reject it as a required-field ValidationError — a
  // correct outcome with a much worse message than naming the window here.
  body('delivery.incentives.peakHour.windows')
    .optional()
    .custom((windows) => {
      windows.forEach((w, i) => {
        if (w === null || typeof w !== 'object' || Array.isArray(w)) {
          throw new Error(`window ${i + 1} must be an object with startHour and endHour`);
        }
        if (w.startHour === undefined || w.endHour === undefined) {
          throw new Error(`window ${i + 1} must have both startHour and endHour`);
        }
        if (Number(w.startHour) === Number(w.endHour)) {
          throw new Error(`window ${i + 1} is empty — startHour and endHour must differ. A window that covers the whole day is not expressible here by design; leave the incentive enabled with no windows removed, or raise the bonus instead.`);
        }
      });
      return true;
    }),
];

module.exports = { updateSettingsValidator };
