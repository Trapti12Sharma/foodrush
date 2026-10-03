import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { landingPathFor } from '../constants/roles';

// Redirects authenticated users away from auth-only pages (login, register)
// to their role's dashboard — UNLESS they're a customer visiting
// /register?role=DELIVERY_PARTNER or ?role=RESTAURANT_OWNER, which means they
// are intentionally trying to sign up for a different role from the marketing page.
export function AuthRedirect({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (user) {
    // Allow customers to visit /register?role=X to start a partner application.
    const roleParam = new URLSearchParams(location.search).get('role');
    const isPartnerSignup = roleParam && roleParam !== 'CUSTOMER' && user.role === 'CUSTOMER';
    if (!isPartnerSignup) {
      return <Navigate to={landingPathFor(user)} replace />;
    }
  }
  return children;
}

// Redirects staff/owners away from the customer storefront home page.
// Unauthenticated visitors and customers see the home page normally.
export function CustomerHomeGuard({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user && user.role !== 'CUSTOMER') {
    return <Navigate to={landingPathFor(user)} replace />;
  }
  return children;
}

export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="py-24 text-center text-gray-400">Loading…</div>;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    // Staff/owners hitting a customer-only route → send them to their console.
    return <Navigate to={landingPathFor(user)} replace />;
  }

  return children;
}
