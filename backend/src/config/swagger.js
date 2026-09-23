const swaggerJsdoc = require('swagger-jsdoc');
const { ROLES } = require('../utils/constants');

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
            role: { type: 'string', enum: Object.values(ROLES) },
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
            deliveryRadiusKm: { type: 'number', description: 'How far from `location` this restaurant delivers, in km (default 5)' },
            isOpen: { type: 'boolean', description: 'Manual pause switch — false always means closed, regardless of openingHours' },
            openingHours: {
              type: 'array',
              description:
                'Weekly schedule. On create/update, send day (0=Sunday..6=Saturday) with open/close as "HH:MM" strings; a response echoes them back as minutes since midnight (open/close: 0-1439). close <= open means an overnight slot (e.g. 18:00 -> 02:00). An empty array means no schedule set — always open (subject to isOpen).',
              items: { type: 'object', properties: { day: { type: 'integer' }, open: { oneOf: [{ type: 'string' }, { type: 'integer' }] }, close: { oneOf: [{ type: 'string' }, { type: 'integer' }] } } },
            },
            timezone: { type: 'string', description: 'IANA timezone openingHours is evaluated in (default Asia/Kolkata)' },
            isOpenNow: { type: 'boolean', readOnly: true, description: 'Computed: isOpen AND within openingHours right now. Not settable directly.' },
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
            variants: {
              type: 'array',
              description: 'e.g. Small/Medium/Large. When present, ordering this item requires choosing one (see POST /cart/items) — price/discountPrice above then only feed displayPrice.',
              items: {
                type: 'object',
                properties: { _id: { type: 'string' }, name: { type: 'string' }, price: { type: 'number' }, discountPrice: { type: 'number', nullable: true }, isAvailable: { type: 'boolean' } },
              },
            },
            displayPrice: { type: 'number', readOnly: true, description: 'Computed: price to show before a variant is chosen — the cheapest available variant, or the usual discount/base price if there are no variants. Never what a line is actually charged.' },
            isRecommended: { type: 'boolean', description: 'Owner-curated, shown in the menu\'s Recommended section' },
            isBestseller: { type: 'boolean' },
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
            variantId: { type: 'string', nullable: true },
            variantName: { type: 'string', nullable: true },
            note: { type: 'string', description: 'Free-text instruction, e.g. "less spicy" (max 140 chars)' },
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
            orderNumber: { type: 'string', description: 'Short, human-readable id, e.g. FR00000001' },
            orderStatus: {
              type: 'string',
              enum: ['PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REJECTED', 'REFUND_PENDING', 'REFUNDED'],
            },
            deliveryDistanceKm: { type: 'number', nullable: true },
            razorpayOrderId: { type: 'string', nullable: true },
            deliveryPartner: { type: 'string', nullable: true, description: 'Set once a rider accepts the delivery (M7) — OUT_FOR_DELIVERY is reached this way, or manually by the restaurant for self-delivery' },
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
            usageLimit: { type: 'integer', nullable: true, description: 'Total uses across every customer; null = unlimited' },
            perUserLimit: { type: 'integer', nullable: true, description: 'Uses allowed for ONE customer; null = unlimited (still subject to usageLimit)' },
            usedCount: { type: 'integer' },
            restaurant: { type: 'string', nullable: true, description: 'Scopes the coupon to one restaurant; mutually exclusive with city' },
            city: { type: 'string', nullable: true, description: 'Scopes the coupon to every restaurant in a city' },
            fundedBy: { type: 'string', enum: ['PLATFORM', 'RESTAURANT', 'SHARED'], description: 'Who bears the discount, for settlement reporting — does not change the discount amount' },
            isActive: { type: 'boolean' },
          },
        },
        Payment: {
          type: 'object',
          description: 'One ONLINE payment ATTEMPT on an order (an order can have several, after a retry)',
          properties: {
            _id: { type: 'string' },
            order: { type: 'string' },
            razorpayOrderId: { type: 'string' },
            razorpayPaymentId: { type: 'string', nullable: true },
            amount: { type: 'number' },
            status: { type: 'string', enum: ['CREATED', 'PAID', 'FAILED'] },
          },
        },
        Refund: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            order: { type: 'string' },
            amount: { type: 'number' },
            reason: { type: 'string', enum: ['customer_cancellation', 'restaurant_rejection', 'restaurant_unavailable', 'operational_issue', 'admin_initiated'] },
            status: { type: 'string', enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] },
            razorpayRefundId: { type: 'string', nullable: true },
            initiatedBy: { type: 'string', nullable: true, description: 'Staff user id; null for an automatic system refund' },
          },
        },
        DeliveryPartner: {
          type: 'object',
          description: 'A delivery partner profile. GET /admin/delivery-partners (list) omits documents/drivingLicenceNumber/dateOfBirth/emergencyContact — only the single-partner detail endpoint returns them.',
          properties: {
            _id: { type: 'string' },
            user: { type: 'string' },
            fullName: { type: 'string' },
            phone: { type: 'string' },
            city: { type: 'string' },
            vehicleType: { type: 'string', enum: ['BICYCLE', 'SCOOTER', 'MOTORCYCLE', 'CAR'] },
            vehicleNumber: { type: 'string' },
            kycStatus: { type: 'string', enum: ['PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED'] },
            kycRejectionReason: { type: 'string', nullable: true },
            accountStatus: { type: 'string', enum: ['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED'] },
            accountStatusReason: { type: 'string', nullable: true },
            availability: { type: 'string', enum: ['OFFLINE', 'ONLINE'] },
            lastLocationAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        DeliveryAssignment: {
          type: 'object',
          description: 'One rider-offer attempt for an order. An order can accumulate several over its dispatch history; at most one is ever active (OFFERED/ACCEPTED/ASSIGNED) at once.',
          properties: {
            _id: { type: 'string' },
            order: { type: 'string' },
            deliveryPartner: { type: 'string' },
            status: { type: 'string', enum: ['OFFERED', 'ACCEPTED', 'ASSIGNED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'COMPLETED'] },
            offeredAt: { type: 'string', format: 'date-time' },
            expiresAt: { type: 'string', format: 'date-time' },
            acceptedAt: { type: 'string', format: 'date-time', nullable: true },
            assignedAt: { type: 'string', format: 'date-time', nullable: true },
            rejectedAt: { type: 'string', format: 'date-time', nullable: true },
            rejectionReason: { type: 'string', nullable: true },
            cancelledAt: { type: 'string', format: 'date-time', nullable: true },
            distanceKmAtOffer: { type: 'number', nullable: true },
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
      { name: 'Delivery Partners', description: "A delivery partner's own profile, KYC submission, availability and location" },
      { name: 'Delivery Assignments', description: "A delivery partner's own offered/accepted/current deliveries" },
    ],
  },
  apis: ['./src/routes/*.js'],
};

module.exports = swaggerJsdoc(options);
