const Address = require('../models/Address');
const ApiError = require('../utils/ApiError');

const FIELDS = ['label', 'addressLine', 'city', 'state', 'pincode', 'latitude', 'longitude'];

function pickFields(source) {
  const result = {};
  FIELDS.forEach((field) => {
    if (source[field] !== undefined) result[field] = source[field];
  });
  return result;
}

async function listAddresses(userId) {
  return Address.find({ user: userId }).sort('-isDefault -createdAt');
}

async function createAddress(userId, payload) {
  const data = pickFields(payload);
  const isFirst = (await Address.countDocuments({ user: userId })) === 0;
  const isDefault = isFirst || payload.isDefault === true; // first address is always default

  const address = await Address.create({ ...data, user: userId, isDefault });
  if (isDefault) await Address.clearDefaultForUser(userId, address._id);
  return address;
}

async function getOwnedAddress(userId, addressId) {
  const address = await Address.findById(addressId);
  if (!address || address.user.toString() !== userId.toString()) {
    throw ApiError.notFound('Address not found');
  }
  return address;
}

async function updateAddress(userId, addressId, payload) {
  const address = await getOwnedAddress(userId, addressId);
  Object.assign(address, pickFields(payload));
  await address.save();

  if (payload.isDefault === true) {
    address.isDefault = true;
    await address.save();
    await Address.clearDefaultForUser(userId, address._id);
  }
  return address;
}

async function deleteAddress(userId, addressId) {
  const address = await getOwnedAddress(userId, addressId);
  await address.deleteOne();

  if (address.isDefault) {
    const next = await Address.findOne({ user: userId }).sort('-createdAt');
    if (next) {
      next.isDefault = true;
      await next.save();
    }
  }
}

module.exports = { listAddresses, createAddress, getOwnedAddress, updateAddress, deleteAddress };
