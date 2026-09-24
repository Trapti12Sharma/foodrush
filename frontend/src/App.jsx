import { Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { FavoritesProvider } from './context/FavoritesContext';
import { LocationProvider } from './context/LocationContext';
import LocationPicker from './components/LocationPicker';
import ProtectedRoute from './components/ProtectedRoute';
import { ADMIN_PANEL_ROLES } from './constants/roles';
import MainLayout from './layouts/MainLayout';
import RestaurantOwnerLayout from './layouts/RestaurantOwnerLayout';
import DeliveryPartnerLayout from './layouts/DeliveryPartnerLayout';
import AdminLayout from './layouts/AdminLayout';

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
import OwnerDashboard from './pages/owner/Dashboard';
import OwnerOrders from './pages/owner/Orders';
import OwnerMenu from './pages/owner/Menu';
import OwnerCategories from './pages/owner/Categories';
import OwnerProfile from './pages/owner/Profile';
import OwnerReviews from './pages/owner/Reviews';
import DeliveryDashboard from './pages/delivery/Dashboard';
import DeliveryProfile from './pages/delivery/Profile';
import DeliverySupport from './pages/delivery/Support';
import Support from './pages/Support';
import OwnerSupport from './pages/owner/Support';
import AdminDashboard from './pages/admin/Dashboard';
import AdminUsers from './pages/admin/Users';
import AdminRestaurants from './pages/admin/Restaurants';
import AdminOrders from './pages/admin/Orders';
import AdminCoupons from './pages/admin/Coupons';
import AdminDeliveryPartners from './pages/admin/DeliveryPartners';
import AdminDeliveryAssignments from './pages/admin/DeliveryAssignments';
import AdminDeliverySettlements from './pages/admin/DeliverySettlements';
import AdminSupportTickets from './pages/admin/SupportTickets';
import AdminAuditLogs from './pages/admin/AuditLogs';
import Profile from './pages/Profile';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import NotFound from './pages/NotFound';

function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <FavoritesProvider>
          <LocationProvider>
          <Toaster position="top-center" toastOptions={{ duration: 3000 }} />
          <LocationPicker />
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
                <Route path="users" element={<AdminUsers />} />
                <Route path="restaurants" element={<AdminRestaurants />} />
                <Route path="orders" element={<AdminOrders />} />
                <Route path="coupons" element={<AdminCoupons />} />
                <Route path="delivery-partners" element={<AdminDeliveryPartners />} />
                <Route path="delivery-assignments" element={<AdminDeliveryAssignments />} />
                <Route path="delivery-settlements" element={<AdminDeliverySettlements />} />
                <Route path="support-tickets" element={<AdminSupportTickets />} />
                <Route path="audit-logs" element={<AdminAuditLogs />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
          </LocationProvider>
        </FavoritesProvider>
      </CartProvider>
    </AuthProvider>
  );
}

export default App;
