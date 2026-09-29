const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES } = require('../utils/constants');
const { getPermissions } = require('../utils/permissions');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email address'],
    },
    phone: {
      type: String,
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 8,
      select: false,
    },
    role: {
      type: String,
      enum: Object.values(ROLES),
      default: ROLES.CUSTOMER,
    },
    avatar: {
      type: String,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Set whenever the password changes (change or reset). Any login token issued
    // before this moment is rejected by the auth middleware, so a stolen or old
    // session stops working the instant the password is changed.
    passwordChangedAt: {
      type: Date,
      default: null,
    },
    // Password-reset state. Only the SHA-256 HASH of the emailed token is stored,
    // so a database leak can't be used to reset anyone's password. select:false
    // keeps all of it out of every normal query and API response.
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    passwordResetRequestedAt: { type: Date, select: false },
  },
  { timestamps: true }
);

// M16 — analytics counts customers (role === CUSTOMER) in total and those who
// registered inside a date range; this serves both from one index.
userSchema.index({ role: 1, createdAt: -1 });

// `addresses` and `favorites` are intentionally not embedded arrays of ids —
// they're derived via virtual populate from the Address/Favorite collections so
// there is a single source of truth and no array to keep in sync on every write.
userSchema.virtual('addresses', {
  ref: 'Address',
  localField: '_id',
  foreignField: 'user',
});

userSchema.virtual('favorites', {
  ref: 'Favorite',
  localField: '_id',
  foreignField: 'user',
});

userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

// M18 — cost 12 in every real environment, which is the whole point of bcrypt:
// it must be slow. Under NODE_ENV=test only, the cost drops to 4.
//
// This is a test-speed change, not a security trade-off, because nothing in the
// test database is a real credential: the suite creates hundreds of throwaway
// users, and at cost 12 each one costs roughly a quarter-second of pure CPU. The
// Phase 0 audit flagged the suite's runtime and suggested exactly this. The
// hashing PATH is unchanged, so every test still exercises real bcrypt hashing
// and real comparison — only the work factor differs, and no test asserts on it.
//
// The check is an exact match on 'test' and the fallback is the strong cost, so
// every other value — production, development, staging, or NODE_ENV unset
// entirely — gets 12. The weak cost is reachable only by explicitly declaring a
// test environment, never by forgetting to declare one.
const BCRYPT_COST = process.env.NODE_ENV === 'test' ? 4 : 12;

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, BCRYPT_COST);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toSafeObject = function toSafeObject() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.passwordResetTokenHash;
  delete obj.passwordResetExpires;
  delete obj.passwordResetRequestedAt;
  // Lets the frontend show/hide staff UI per permission. Display only — the
  // backend re-checks the permission on every request.
  obj.permissions = getPermissions(this.role);
  return obj;
};

module.exports = mongoose.model('User', userSchema);
