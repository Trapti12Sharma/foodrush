import { Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import ProtectedRoute from './components/ProtectedRoute';
import MainLayout from './layouts/MainLayout';
import RestaurantOwnerLayout from './layouts/RestaurantOwnerLayout';

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
import OwnerDashboard from './pages/owner/Dashboard';
import OwnerOrders from './pages/owner/Orders';
import OwnerMenu from './pages/owner/Menu';
import OwnerCategories from './pages/owner/Categories';
import OwnerProfile from './pages/owner/Profile';
import ComingSoon from './pages/ComingSoon';
import NotFound from './pages/NotFound';

function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <Toaster position="top-center" toastOptions={{ duration: 3000 }} />
        <Routes>
          <Route element={<MainLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
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
                  <ComingSoon title="Your profile" phase="a follow-up phase" />
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
                  <ComingSoon title="Your favorites" phase="Phase 11" />
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
              <Route path="reviews" element={<ComingSoon title="Reviews" phase="Phase 11" />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </CartProvider>
    </AuthProvider>
  );
}

export default App;
