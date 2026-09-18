const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../utils/constants');

async function registerUser({ name, email, phone, password, role }) {
  const existing = await User.findOne({ email });
  if (existing) throw ApiError.conflict('An account with this email already exists');

  const user = await User.create({
    name,
    email,
    phone,
    password,
    role: role || ROLES.CUSTOMER,
  });

  return user;
}

async function loginUser({ email, password }) {
  const user = await User.findOne({ email }).select('+password');

  // Same generic message whether the email doesn't exist or the password is
  // wrong — avoids leaking which accounts are registered.
  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  if (!user.isActive) {
    throw ApiError.forbidden('This account has been disabled');
  }

  return user;
}

module.exports = { registerUser, loginUser };
