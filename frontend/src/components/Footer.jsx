import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-gray-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-10">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div>
            <p className="text-lg font-extrabold text-brand-600">
              Food<span className="text-gray-900">Rush</span>
            </p>
            <p className="mt-2 text-sm text-gray-500">Order food you love, delivered fast.</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Explore</p>
            <ul className="mt-2 space-y-1 text-sm text-gray-500">
              <li><Link to="/restaurants" className="hover:text-brand-600">Restaurants</Link></li>
              <li><Link to="/search" className="hover:text-brand-600">Search</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Account</p>
            <ul className="mt-2 space-y-1 text-sm text-gray-500">
              <li><Link to="/login" className="hover:text-brand-600">Login</Link></li>
              <li><Link to="/register" className="hover:text-brand-600">Register</Link></li>
              <li><Link to="/orders" className="hover:text-brand-600">Orders</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Company</p>
            <p className="mt-2 text-sm text-gray-500">An original, independent food-delivery platform. Not affiliated with any other delivery brand.</p>
          </div>
        </div>
        <p className="mt-8 border-t border-gray-100 pt-6 text-center text-xs text-gray-400">
          © {new Date().getFullYear()} FoodRush. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
