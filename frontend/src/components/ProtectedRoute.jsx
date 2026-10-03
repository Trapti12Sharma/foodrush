import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { landingPathFor } from '../constants/roles';

// Redirects authenticated users away from auth-only pages (login, register)
// to their role's dashboard.
export function AuthRedirect({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to={landingPathFor(user)} replace />;
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
