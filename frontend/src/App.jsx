import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { CartProvider } from './context/CartContext';
import { FavoritesProvider } from './context/FavoritesContext';
import { LocationProvider } from './context/LocationContext';
import LocationPicker from './components/LocationPicker';
import ErrorBoundary from './components/ErrorBoundary';
import ProtectedRoute from './components/ProtectedRoute';
import { ADMIN_PANEL_ROLES } from './constants/roles';
import MainLayout from './layouts/MainLayout';

import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import RestaurantListing from './pages/RestaurantListing';
import RestaurantDetail from './pages/RestaurantDetail';
import Search from './pages/Search';
import Cart from './pages/Cart';
import Checkout from './pages/Checkout';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import Addresses from './pages/Addresses';
import Favorites from './pages/Favorites';
import Support from './pages/Support';
import Profile from './pages/Profile';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import NotFound from './pages/NotFound';

// M18 — every role-gated area is code-split. A customer loads none of the owner,
// delivery or admin bundles, which is most of the application by weight: those
// pages exist for a handful of staff accounts, and shipping them to every diner
// on a phone was pure cost. Public and customer routes stay eagerly imported,
// because those ARE the first paint and splitting them would trade a smaller
// download for an extra round trip on the page people actually land on.
const RestaurantOwnerLayout = lazy(() => import('./layouts/RestaurantOwnerLayout'));
const DeliveryPartnerLayout = lazy(() => import('./layouts/DeliveryPartnerLayout'));
const AdminLayout = lazy(() => import('./layouts/AdminLayout'));
const OwnerDashboard = lazy(() => import('./pages/owner/Dashboard'));
const OwnerOrders = lazy(() => import('./pages/owner/Orders'));
const OwnerMenu = lazy(() => import('./pages/owner/Menu'));
const OwnerCategories = lazy(() => import('./pages/owner/Categories'));
const OwnerProfile = lazy(() => import('./pages/owner/Profile'));
const OwnerReviews = lazy(() => import('./pages/owner/Reviews'));
const OwnerSupport = lazy(() => import('./pages/owner/Support'));
const DeliveryDashboard = lazy(() => import('./pages/delivery/Dashboard'));
const DeliveryProfile = lazy(() => import('./pages/delivery/Profile'));
const DeliverySupport = lazy(() => import('./pages/delivery/Support'));
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const AdminAnalytics = lazy(() => import('./pages/admin/Analytics'));
const AdminUsers = lazy(() => import('./pages/admin/Users'));
const AdminRestaurants = lazy(() => import('./pages/admin/Restaurants'));
const AdminOrders = lazy(() => import('./pages/admin/Orders'));
const AdminCoupons = lazy(() => import('./pages/admin/Coupons'));
const AdminDeliveryPartners = lazy(() => import('./pages/admin/DeliveryPartners'));
const AdminDeliveryAssignments = lazy(() => import('./pages/admin/DeliveryAssignments'));
const AdminDeliverySettlements = lazy(() => import('./pages/admin/DeliverySettlements'));
const AdminSupportTickets = lazy(() => import('./pages/admin/SupportTickets'));
const AdminReviews = lazy(() => import('./pages/admin/Reviews'));
const AdminAuditLogs = lazy(() => import('./pages/admin/AuditLogs'));
const AdminSettings = lazy(() => import('./pages/admin/Settings'));
const AdminStaff = lazy(() => import('./pages/admin/Staff'));

// Shown only while a role-gated chunk downloads — typically a few hundred
// milliseconds on first visit to that area, and never again once cached.
// Deliberately minimal: a spinner that appears and vanishes is more distracting
// than a quiet placeholder holding the same space the page will occupy.
function RouteFallback() {
  return <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-gray-400">Loading…</div>;
}

function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
      <CartProvider>
        <FavoritesProvider>
          <LocationProvider>
          <Toaster position="top-center" toastOptions={{ duration: 3000 }} />
          <LocationPicker />
          {/* M19 — sits INSIDE the providers and OUTSIDE Routes on purpose. Inside,
              so a render error in any page is caught rather than blanking the app;
              outside Routes, so the fallback survives the failure of whichever
              route threw. It also wraps Suspense, which is what catches a failed
              lazy-chunk import after a deploy (see ErrorBoundary's chunk case). */}
          <ErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route element={<MainLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/restaurants" element={<RestaurantListing />} />
              <Route path="/restaurants/:id" element={<RestaurantDetail />} />
              <Route path="/search" element={<Search />} />

              <Route path="/cart" element={<Cart />} />
              <Route
                path="/checkout"
                element={
                  <ProtectedRoute>
                    <Checkout />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/orders"
                element={
                  <ProtectedRoute>
                    <Orders />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/orders/:id"
                element={
                  <ProtectedRoute>
                    <OrderDetail />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <Profile />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile/addresses"
                element={
                  <ProtectedRoute>
                    <Addresses />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/favorites"
                element={
                  <ProtectedRoute>
                    <Favorites />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/support"
                element={
                  <ProtectedRoute>
                    <Support />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/restaurant"
                element={
                  <ProtectedRoute roles={['RESTAURANT_OWNER']}>
                    <RestaurantOwnerLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="dashboard" element={<OwnerDashboard />} />
                <Route path="orders" element={<OwnerOrders />} />
                <Route path="menu" element={<OwnerMenu />} />
                <Route path="categories" element={<OwnerCategories />} />
                <Route path="profile" element={<OwnerProfile />} />
                <Route path="reviews" element={<OwnerReviews />} />
                <Route path="support" element={<OwnerSupport />} />
              </Route>

              <Route
                path="/delivery"
                element={
                  <ProtectedRoute roles={['DELIVERY_PARTNER']}>
                    <DeliveryPartnerLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="dashboard" element={<DeliveryDashboard />} />
                <Route path="profile" element={<DeliveryProfile />} />
                <Route path="support" element={<DeliverySupport />} />
              </Route>

              <Route
                path="/admin"
                element={
                  <ProtectedRoute roles={ADMIN_PANEL_ROLES}>
                    <AdminLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="dashboard" element={<AdminDashboard />} />
                <Route path="analytics" element={<AdminAnalytics />} />
                <Route path="users" element={<AdminUsers />} />
                <Route path="restaurants" element={<AdminRestaurants />} />
                <Route path="orders" element={<AdminOrders />} />
                <Route path="coupons" element={<AdminCoupons />} />
                <Route path="delivery-partners" element={<AdminDeliveryPartners />} />
                <Route path="delivery-assignments" element={<AdminDeliveryAssignments />} />
                <Route path="delivery-settlements" element={<AdminDeliverySettlements />} />
                <Route path="support-tickets" element={<AdminSupportTickets />} />
                <Route path="reviews" element={<AdminReviews />} />
                <Route path="audit-logs" element={<AdminAuditLogs />} />
                {/* M17 — reachable by every ADMIN_PANEL_ROLE like the routes above,
                    but the endpoints behind them require settings:manage /
                    admins:manage (SUPER_ADMIN only). The nav hides the links for
                    everyone else; a staff member who types the URL gets the page
                    with a permission error from the API rather than data. */}
                <Route path="settings" element={<AdminSettings />} />
                <Route path="staff" element={<AdminStaff />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
          </Suspense>
          </ErrorBoundary>
          </LocationProvider>
        </FavoritesProvider>
      </CartProvider>
      </NotificationProvider>
    </AuthProvider>
  );
}

export default App;
