import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, MapPin, User, ShoppingCart, Menu, X, LogOut, ClipboardList, Heart, MapPinned, Store } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useCityPreference } from '../hooks/useCityPreference';

export default function Navbar() {
  const { user, logout } = useAuth();
  const { itemCount } = useCart();
  const navigate = useNavigate();
  const [city, setCity] = useCityPreference();
  const [query, setQuery] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editingCity, setEditingCity] = useState(false);

  function submitSearch(e) {
    e.preventDefault();
    setMobileOpen(false);
    navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  function handleLogout() {
    setProfileOpen(false);
    logout();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
        <Link to="/" className="shrink-0 text-2xl font-extrabold text-brand-600">
          Food<span className="text-gray-900">Rush</span>
        </Link>

        <button
          type="button"
          onClick={() => setEditingCity((v) => !v)}
          className="hidden shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 md:flex"
        >
          <MapPin size={16} />
          {editingCity ? (
            <input
              autoFocus
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onBlur={() => setEditingCity(false)}
              onKeyDown={(e) => e.key === 'Enter' && setEditingCity(false)}
              placeholder="Your city"
              className="w-28 border-b border-brand-400 bg-transparent outline-none"
            />
          ) : (
            <span className="max-w-[8rem] truncate">{city || 'Set location'}</span>
          )}
        </button>

        <form onSubmit={submitSearch} className="hidden flex-1 md:block">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search restaurants or food…"
              className="w-full rounded-full border border-gray-200 bg-gray-50 py-2 pl-9 pr-4 text-sm outline-none focus:border-brand-400"
            />
          </div>
        </form>

        <nav className="ml-auto hidden items-center gap-4 md:flex">
          <Link to="/restaurants" className="text-sm font-medium text-gray-700 hover:text-brand-600">
            Restaurants
          </Link>
          <Link to="/cart" className="relative text-gray-700 hover:text-brand-600" aria-label="Cart">
            <ShoppingCart size={20} />
            {itemCount > 0 && (
              <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-brand-600 text-[10px] font-semibold text-white">
                {itemCount > 9 ? '9+' : itemCount}
              </span>
            )}
          </Link>

          {user ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setProfileOpen((v) => !v)}
                className="flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <User size={16} /> {user.name.split(' ')[0]}
              </button>
              {profileOpen && (
                <div className="absolute right-0 mt-2 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  {user.role === 'RESTAURANT_OWNER' && (
                    <Link
                      to="/restaurant/dashboard"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50"
                    >
                      <Store size={14} /> Restaurant dashboard
                    </Link>
                  )}
                  <Link
                    to="/profile"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <User size={14} /> Profile
                  </Link>
                  <Link
                    to="/orders"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <ClipboardList size={14} /> My orders
                  </Link>
                  <Link
                    to="/profile/addresses"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <MapPinned size={14} /> Addresses
                  </Link>
                  <Link
                    to="/favorites"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Heart size={14} /> Favorites
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    <LogOut size={14} /> Logout
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              to="/login"
              className="rounded-full bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              Login
            </Link>
          )}
        </nav>

        <button
          type="button"
          className="ml-auto text-gray-700 md:hidden"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t border-gray-200 px-4 py-3 md:hidden">
          <form onSubmit={submitSearch} className="mb-3">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search restaurants or food…"
                className="w-full rounded-full border border-gray-200 bg-gray-50 py-2 pl-9 pr-4 text-sm outline-none"
              />
            </div>
          </form>
          <div className="flex flex-col gap-1">
            <Link to="/restaurants" onClick={() => setMobileOpen(false)} className="rounded px-2 py-2 text-sm hover:bg-gray-50">
              Restaurants
            </Link>
            <Link to="/cart" onClick={() => setMobileOpen(false)} className="rounded px-2 py-2 text-sm hover:bg-gray-50">
              Cart
            </Link>
            {user ? (
              <>
                {user.role === 'RESTAURANT_OWNER' && (
                  <Link
                    to="/restaurant/dashboard"
                    onClick={() => setMobileOpen(false)}
                    className="rounded px-2 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50"
                  >
                    Restaurant dashboard
                  </Link>
                )}
                <Link to="/profile" onClick={() => setMobileOpen(false)} className="rounded px-2 py-2 text-sm hover:bg-gray-50">
                  Profile
                </Link>
                <Link to="/orders" onClick={() => setMobileOpen(false)} className="rounded px-2 py-2 text-sm hover:bg-gray-50">
                  My orders
                </Link>
                <Link to="/profile/addresses" onClick={() => setMobileOpen(false)} className="rounded px-2 py-2 text-sm hover:bg-gray-50">
                  Addresses
                </Link>
                <Link to="/favorites" onClick={() => setMobileOpen(false)} className="rounded px-2 py-2 text-sm hover:bg-gray-50">
                  Favorites
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    logout();
                  }}
                  className="rounded px-2 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                >
                  Logout
                </button>
              </>
            ) : (
              <Link to="/login" onClick={() => setMobileOpen(false)} className="rounded px-2 py-2 text-sm font-medium text-brand-600">
                Login
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
