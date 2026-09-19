const swaggerJsdoc = require('swagger-jsdoc');

// swagger-jsdoc scans the `apis` glob for `@swagger` JSDoc blocks above each
// route definition and merges them into this base document — so every
// endpoint's docs live right next to the route that implements it, in
// src/routes/*.js, rather than in one giant file that drifts out of sync.
const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'FoodRush API',
      version: '1.0.0',
      description:
        'REST API for FoodRush, an original food-delivery platform. ' +
        'Auth uses a JWT in an httpOnly cookie (browser clients) or an ' +
        '`Authorization: Bearer <token>` header (non-browser clients) — see the ' +
        '"cookieAuth" and "bearerAuth" security schemes below; either is accepted ' +
        'on every protected route. All responses use the envelope ' +
        '`{ success, message, data }` on success or `{ success, message, errors }` ' +
        'on failure.',
    },
    servers: [{ url: '/api', description: 'API base path (this server)' }],
    security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    components: {
      securitySchemes: {
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'foodrush_token' },
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      responses: {
        Unauthorized: {
          description: 'Missing, invalid, or expired credentials',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        Forbidden: {
          description: "Authenticated, but not allowed to perform this action (wrong role or doesn't own the resource)",
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        NotFound: {
          description: 'Resource not found (or hidden from this requester, e.g. an unapproved restaurant)',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        ValidationError: {
          description: 'Request body failed validation',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/ApiError' },
                  {
                    type: 'object',
                    properties: {
                      errors: {
                        type: 'array',
                        items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
        Conflict: {
          description: 'The request conflicts with existing state (e.g. duplicate code, already reviewed, cross-restaurant cart)',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
      },
      schemas: {
        ApiError: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
            errors: { type: 'array', items: {} },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
        User: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            role: { type: 'string', enum: ['CUSTOMER', 'RESTAURANT_OWNER', 'ADMIN'] },
            avatar: { type: 'string' },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Address: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            label: { type: 'string', example: 'Home' },
            addressLine: { type: 'string' },
            city: { type: 'string' },
            state: { type: 'string' },
            pincode: { type: 'string' },
            latitude: { type: 'number' },
            longitude: { type: 'number' },
            isDefault: { type: 'boolean' },
          },
        },
        Addon: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            price: { type: 'number' },
            isAvailable: { type: 'boolean' },
          },
        },
        Restaurant: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            owner: { type: 'string', description: 'User id of the restaurant owner' },
            image: { type: 'string', nullable: true },
            cuisine: { type: 'array', items: { type: 'string' } },
            address: {
              type: 'object',
              properties: { addressLine: { type: 'string' }, state: { type: 'string' }, pincode: { type: 'string' } },
            },
            city: { type: 'string' },
            location: {
              type: 'object',
              properties: {
                type: { type: 'string', example: 'Point' },
                coordinates: { type: 'array', items: { type: 'number' }, example: [73.8567, 18.5204] },
              },
            },
            rating: { type: 'number' },
            totalReviews: { type: 'integer' },
            deliveryTime: { type: 'number', description: 'Estimated minutes' },
            deliveryFee: { type: 'number' },
            minimumOrder: { type: 'number' },
            isOpen: { type: 'boolean' },
            isApproved: { type: 'boolean', description: 'Admin approval gate — invisible to the public until true' },
            isActive: { type: 'boolean', description: "Admin's separate disable/enable switch" },
          },
        },
        FoodCategory: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            restaurant: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            image: { type: 'string', nullable: true },
            isActive: { type: 'boolean' },
          },
        },
        FoodItem: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            restaurant: { type: 'string' },
            category: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            image: { type: 'string', nullable: true },
            price: { type: 'number' },
            discountPrice: { type: 'number', nullable: true },
            isVeg: { type: 'boolean' },
            isAvailable: { type: 'boolean' },
            preparationTime: { type: 'number' },
            addons: { type: 'array', items: { $ref: '#/components/schemas/Addon' } },
          },
        },
        CartItem: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            food: { type: 'string' },
            quantity: { type: 'integer' },
            price: { type: 'number', description: 'Server-computed at add/recalculate time, never trusted from the client' },
            addons: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, price: { type: 'number' } } } },
          },
        },
        Cart: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            user: { type: 'string' },
            restaurant: { type: 'string', nullable: true, description: 'Locks the cart to one restaurant; null when empty' },
            items: { type: 'array', items: { $ref: '#/components/schemas/CartItem' } },
            subtotal: { type: 'number' },
            deliveryFee: { type: 'number' },
            tax: { type: 'number' },
            discount: { type: 'number' },
            couponCode: { type: 'string', nullable: true },
            total: { type: 'number' },
          },
        },
        Order: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            user: { type: 'string' },
            restaurant: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  food: { type: 'string' }, name: { type: 'string' }, price: { type: 'number' }, quantity: { type: 'integer' },
                },
              },
              description: 'Frozen snapshot at order time — a later menu edit never rewrites history',
            },
            deliveryAddress: { $ref: '#/components/schemas/Address' },
            subtotal: { type: 'number' },
            deliveryFee: { type: 'number' },
            tax: { type: 'number' },
            discount: { type: 'number' },
            totalAmount: { type: 'number' },
            coupon: { type: 'object', nullable: true, properties: { code: { type: 'string' }, discountAmount: { type: 'number' } } },
            paymentMethod: { type: 'string', enum: ['COD', 'ONLINE'] },
            paymentStatus: { type: 'string', enum: ['pending', 'paid', 'failed', 'refunded'] },
            orderStatus: {
              type: 'string',
              enum: ['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'cancelled', 'rejected'],
            },
            statusHistory: {
              type: 'array',
              items: { type: 'object', properties: { status: { type: 'string' }, changedAt: { type: 'string', format: 'date-time' } } },
            },
            transactionId: { type: 'string', nullable: true },
            estimatedDeliveryTime: { type: 'string', format: 'date-time', nullable: true },
            cancellationReason: { type: 'string', nullable: true },
          },
        },
        Review: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            user: { type: 'object', properties: { _id: { type: 'string' }, name: { type: 'string' }, avatar: { type: 'string' } } },
            restaurant: { type: 'string' },
            order: { type: 'string' },
            rating: { type: 'integer', minimum: 1, maximum: 5 },
            comment: { type: 'string' },
            images: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Coupon: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            code: { type: 'string', example: 'SAVE20' },
            description: { type: 'string' },
            discountType: { type: 'string', enum: ['PERCENTAGE', 'FLAT'] },
            discountValue: { type: 'number' },
            minimumOrder: { type: 'number' },
            maximumDiscount: { type: 'number', nullable: true },
            expiryDate: { type: 'string', format: 'date-time' },
            usageLimit: { type: 'integer', nullable: true },
            usedCount: { type: 'integer' },
            isActive: { type: 'boolean' },
          },
        },
      },
    },
    tags: [
      { name: 'Auth', description: 'Register, login, logout, current user' },
      { name: 'Restaurants', description: 'Restaurant listing, detail, CRUD, owner dashboard' },
      { name: 'Categories', description: 'Menu categories within a restaurant' },
      { name: 'Foods', description: 'Menu items within a restaurant' },
      { name: 'Cart', description: "The signed-in customer's single active cart" },
      { name: 'Addresses', description: "The signed-in customer's saved delivery addresses" },
      { name: 'Orders', description: 'Placing and tracking orders' },
      { name: 'Reviews', description: 'Order-gated restaurant reviews' },
      { name: 'Favorites', description: "The signed-in customer's favorited restaurants" },
      { name: 'Coupons', description: 'Discount code validation and admin management' },
      { name: 'Uploads', description: 'Image upload for restaurant/category/food images' },
      { name: 'Config', description: 'Public runtime configuration flags' },
      { name: 'Admin', description: 'Platform-wide administration (ADMIN role only)' },
    ],
  },
  apis: ['./src/routes/*.js'],
};

module.exports = swaggerJsdoc(options);
