const { body } = require('express-validator');
const { SUPPORT_TICKET_CATEGORY, SUPPORT_TICKET_PRIORITY, SUPPORT_TICKET_STATUS } = require('../utils/constants');

// Attachments are URLs returned by POST /uploads/image?purpose=support (see
// middleware/upload.middleware.js) — plain strings, capped in count and length
// so this can never become a way to smuggle a huge or malicious payload through
// a field that was only ever supposed to carry a handful of short URLs.
const attachmentsValidator = [
  body('attachments').optional().isArray({ max: 3 }).withMessage('At most 3 attachments are allowed'),
  body('attachments.*').isString().trim().isLength({ min: 1, max: 500 }).withMessage('Each attachment must be a valid URL'),
];

const createTicketValidator = [
  body('category').isIn(Object.values(SUPPORT_TICKET_CATEGORY)).withMessage('Invalid ticket category'),
  body('subject').trim().notEmpty().withMessage('A subject is required').isLength({ max: 150 }),
  body('description').trim().notEmpty().withMessage('A description is required').isLength({ max: 3000 }),
  body('priority').optional().isIn(Object.values(SUPPORT_TICKET_PRIORITY)).withMessage('Invalid priority'),
  body('orderId').optional({ checkFalsy: true }).isMongoId().withMessage('orderId must be a valid id'),
  body('restaurantId').optional({ checkFalsy: true }).isMongoId().withMessage('restaurantId must be a valid id'),
  ...attachmentsValidator,
];

const addMessageValidator = [
  body('message').trim().notEmpty().withMessage('A message is required').isLength({ max: 2000 }),
  ...attachmentsValidator,
];

const updateStatusValidator = [body('status').isIn(Object.values(SUPPORT_TICKET_STATUS)).withMessage('Invalid ticket status')];

const updatePriorityValidator = [body('priority').isIn(Object.values(SUPPORT_TICKET_PRIORITY)).withMessage('Invalid priority')];

const assignTicketValidator = [body('assignedTo').optional({ checkFalsy: true }).isMongoId().withMessage('assignedTo must be a valid id')];

const resolveTicketValidator = [body('resolution').optional({ checkFalsy: true }).trim().isLength({ max: 2000 })];

module.exports = {
  createTicketValidator,
  addMessageValidator,
  updateStatusValidator,
  updatePriorityValidator,
  assignTicketValidator,
  resolveTicketValidator,
};
