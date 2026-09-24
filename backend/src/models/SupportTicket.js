const mongoose = require('mongoose');
const { SUPPORT_TICKET_CATEGORY, SUPPORT_TICKET_PRIORITY, SUPPORT_TICKET_STATUS } = require('../utils/constants');

// One entry per reply in the ticket's conversation. `sender`/`senderRole` are
// always derived from the authenticated caller (see supportTicket.service.js),
// never accepted from the request body, so a message can't be spoofed as coming
// from someone else. `attachments` reuses the exact same image-upload pipeline as
// everything else (storage.service.js via POST /uploads/image?purpose=support) —
// these are plain URLs, never raw bytes stored on the document.
const supportMessageSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, required: true },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    attachments: { type: [String], default: [] },
  },
  { _id: true, timestamps: { createdAt: true, updatedAt: false } }
);

const supportTicketSchema = new mongoose.Schema(
  {
    // Short, human-readable id (FR-TKT-000001...) — see utils/ticketNumber.js.
    // Never relied on for lookups internally (that's always _id); this exists so
    // a customer/rider/owner has something readable to quote back to support.
    ticketNumber: { type: String, required: true, unique: true, index: true },

    // Who actually opened this ticket, and their role AT THE TIME — always the
    // authenticated caller, never a client-supplied id. `customer` is a
    // convenience denormalization (equals createdBy when createdByRole is
    // CUSTOMER, else null) so admin filtering/reporting on "tickets about a
    // customer" doesn't have to branch on role.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    createdByRole: { type: String, required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Optional relationships — each one is verified server-side against the
    // caller's own records before it is ever attached (see
    // supportTicket.service.js#resolveRelationships). A restaurant owner can only
    // reference their own restaurant; a delivery partner only a delivery they were
    // actually assigned; a customer only their own order.
    restaurant: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', default: null, index: true },
    deliveryPartner: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryPartner', default: null },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },

    category: { type: String, enum: Object.values(SUPPORT_TICKET_CATEGORY), required: true, index: true },
    subject: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, required: true, trim: true, maxlength: 3000 },
    priority: { type: String, enum: Object.values(SUPPORT_TICKET_PRIORITY), default: SUPPORT_TICKET_PRIORITY.MEDIUM, index: true },
    status: { type: String, enum: Object.values(SUPPORT_TICKET_STATUS), default: SUPPORT_TICKET_STATUS.OPEN, index: true },

    // A staff member holding support_tickets:manage — validated at assignment
    // time (see supportTicket.service.js#assignForAdmin), never just any user id.
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    messages: { type: [supportMessageSchema], default: [] },
    // Attachments on the ORIGINAL ticket (submitted at creation time); each
    // message may carry its own on top of these.
    attachments: { type: [String], default: [] },

    resolution: { type: String, default: null, maxlength: 2000 },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    closedAt: { type: Date, default: null },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// priority/status/category/assignedTo/order/createdBy already have single-field
// indexes via `index: true` above; these are the additional compound/sort ones.
supportTicketSchema.index({ createdBy: 1, createdAt: -1 });
supportTicketSchema.index({ status: 1, createdAt: -1 });
supportTicketSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
