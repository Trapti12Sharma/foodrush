const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const cartService = require('../services/cart.service');

const getCart = asyncHandler(async (req, res) => {
  const cart = await cartService.getCart(req.user._id);
  res.json(new ApiResponse(200, 'Cart fetched', { cart }));
});

const addItem = asyncHandler(async (req, res) => {
  const cart = await cartService.addItem(req.user._id, req.body);
  res.status(201).json(new ApiResponse(201, 'Item added to cart', { cart }));
});

const updateItem = asyncHandler(async (req, res) => {
  const cart = await cartService.updateItemQuantity(req.user._id, req.params.id, req.body.quantity);
  res.json(new ApiResponse(200, 'Cart item updated', { cart }));
});

const removeItem = asyncHandler(async (req, res) => {
  const cart = await cartService.removeItem(req.user._id, req.params.id);
  res.json(new ApiResponse(200, 'Item removed from cart', { cart }));
});

const clearCart = asyncHandler(async (req, res) => {
  const cart = await cartService.clearCart(req.user._id);
  res.json(new ApiResponse(200, 'Cart cleared', { cart }));
});

module.exports = { getCart, addItem, updateItem, removeItem, clearCart };
