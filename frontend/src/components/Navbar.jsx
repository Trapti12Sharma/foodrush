import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MapPin, User, ShoppingCart, Menu, X,
  LogOut, ClipboardList, Heart, MapPinned, Store,
  LayoutDashboard, Bike, LifeBuoy, ChevronDown,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useDeliveryLocation } from '../context/LocationContext';
import { isAdminPanelUser } from '../constants/roles';
import useDismissable from '../hooks/useDismissable';
import NotificationBell from './NotificationBell';

export default function Navbar() {
  const { user, logout } = useAuth();
  const { itemCount } = useCart();
  const { location, openPicker } = useDeliveryLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const profileRef = useDismissable(profileOpen, () => setProfileOpen(false), { closeOnLeave: true });
  const mobileRef = useDismissable(mobileOpen, () => setMobileOpen(false));

  function handleLogout() {
    setProfileOpen(false);
    logout();
  }

  const showStorefrontNav = !user || user.role === 'CUSTOMER';
  const avatar = user?.name?.charAt(0)?.toUpperCase() || 'U';

  return (
    <header
      className="sticky top-0 z-30"
      style={{
        background: 'linear-gradient(135deg, #0f0b1e 0%, #1a0f33 50%, #0d1220 100%)',
        borderBottom: '1px solid rgba(147,51,234,0.25)',
        boxShadow: '0 4px 32px rgba(0,0,0,0.5), 0 1px 0 rgba(147,51,234,0.15)',
      }}
    >
      {/* Top accent line */}
      <div
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{ background: 'linear-gradient(90deg, transparent, #9333ea 30%, #c084fc 50%, #9333ea 70%, transparent)' }}
      />

      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4" style={{ height: '60px' }}>

        {/* Logo */}
        <Link to="/" className="shrink-0 text-xl font-extrabold tracking-tight">
          <span style={{ background: 'linear-gradient(135deg, #c084fc, #9333ea)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Food
          </span>
          <span className="text-white">Rush</span>
        </Link>

        {/* Location pill — desktop only */}
        {showStorefrontNav && (
          <button
            type="button"
            onClick={openPicker}
            aria-label="Choose delivery location"
            className="hidden shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150 md:flex"
            style={{
              background: 'rgba(147,51,234,0.12)',
              border: '1px solid rgba(147,51,234,0.3)',
              color: '#c084fc',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(147,51,234,0.22)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(147,51,234,0.12)'}
          >
            <MapPin size={13} />
            <span className="max-w-[9rem] truncate">{location?.label || 'Set location'}</span>
            <ChevronDown size={11} className="opacity-60" />
          </button>
        )}

        {/* Right nav */}
        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {showStorefrontNav && (
            <>
              <Link
                to="/restaurants"
                className="rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150"
                style={{ color: 'rgba(233,227,245,0.8)' }}
                onMouseEnter={e => { e.currentTarget.style.color = '#c084fc'; e.currentTarget.style.background = 'rgba(147,51,234,0.12)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'rgba(233,227,245,0.8)'; e.currentTarget.style.background = 'transparent'; }}
              >
                Restaurants
              </Link>

              <Link
                to="/cart"
                aria-label="Cart"
                className="relative flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150"
                style={{ color: 'rgba(233,227,245,0.8)' }}
                onMouseEnter={e => { e.currentTarget.style.color = '#c084fc'; e.currentTarget.style.background = 'rgba(147,51,234,0.15)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'rgba(233,227,245,0.8)'; e.currentTarget.style.background = 'transparent'; }}
              >
                <ShoppingCart size={19} />
                {itemCount > 0 && (
                  <span
                    className="absolute -right-0.5 -top-0.5 flex min-w-[1.1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                    style={{ height: '18px', background: 'linear-gradient(135deg, #9333ea, #c084fc)', boxShadow: '0 0 8px rgba(147,51,234,0.6)' }}
                  >
                    {itemCount > 9 ? '9+' : itemCount}
                  </span>
                )}
              </Link>
            </>
          )}

          {user ? (
            <>
              {showStorefrontNav && <NotificationBell />}

              {/* Profile dropdown */}
              <div className="relative ml-1" ref={profileRef}>
                <button
                  type="button"
                  onClick={() => setProfileOpen((v) => !v)}
                  className="flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-sm font-medium transition-all duration-150"
                  style={{
                    background: profileOpen ? 'rgba(147,51,234,0.2)' : 'rgba(147,51,234,0.1)',
                    border: '1px solid rgba(147,51,234,0.3)',
                    color: '#e9e3f5',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(147,51,234,0.2)'}
                  onMouseLeave={e => !profileOpen && (e.currentTarget.style.background = 'rgba(147,51,234,0.1)')}
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, #9333ea, #c084fc)' }}
                  >
                    {avatar}
                  </span>
                  <span className="max-w-[8rem] truncate">{user.name}</span>
                  <ChevronDown
                    size={13}
                    className="opacity-60 transition-transform duration-200"
                    style={{ transform: profileOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>

                {profileOpen && (
                  <div
                    className="absolute right-0 mt-2 w-52 overflow-hidden rounded-2xl py-1.5"
                    style={{
                      background: 'linear-gradient(145deg, #1a1035, #120d28)',
                      border: '1px solid rgba(147,51,234,0.25)',
                      boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(147,51,234,0.1)',
                    }}
                  >
                    <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                        style={{ background: 'linear-gradient(135deg, #9333ea, #c084fc)' }}
                      >
                        {avatar}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{user.name}</p>
                        <p className="text-[11px]" style={{ color: 'rgba(193,182,216,0.7)' }}>{user.role}</p>
                      </div>
                    </div>

                    <div className="py-1">
                      {user.role === 'RESTAURANT_OWNER' && <DropItem to="/restaurant/dashboard" icon={Store} label="Restaurant dashboard" accent onClick={() => setProfileOpen(false)} />}
                      {user.role === 'DELIVERY_PARTNER' && <DropItem to="/delivery/dashboard" icon={Bike} label="Delivery dashboard" accent onClick={() => setProfileOpen(false)} />}
                      {isAdminPanelUser(user) && <DropItem to="/admin/dashboard" icon={LayoutDashboard} label="Admin dashboard" accent onClick={() => setProfileOpen(false)} />}
                      <DropItem to="/profile" icon={User} label="Profile" onClick={() => setProfileOpen(false)} />
                      {showStorefrontNav && (
                        <>
                          <DropItem to="/orders" icon={ClipboardList} label="My orders" onClick={() => setProfileOpen(false)} />
                          <DropItem to="/profile/addresses" icon={MapPinned} label="Addresses" onClick={() => setProfileOpen(false)} />
                          <DropItem to="/favorites" icon={Heart} label="Favorites" onClick={() => setProfileOpen(false)} />
                          <DropItem to="/support" icon={LifeBuoy} label="Support" onClick={() => setProfileOpen(false)} />
                        </>
                      )}
                    </div>

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} className="pt-1">
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-all duration-150"
                        style={{ color: '#f87171' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <LogOut size={14} /> Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <Link
              to="/login"
              className="rounded-full px-5 py-2 text-sm font-semibold text-white transition-all duration-150"
              style={{ background: 'linear-gradient(135deg, #9333ea, #7c3aed)', boxShadow: '0 0 20px rgba(147,51,234,0.4)' }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = '0 0 28px rgba(147,51,234,0.6)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow = '0 0 20px rgba(147,51,234,0.4)'}
            >
              Login
            </Link>
          )}
        </nav>

        {/* Mobile hamburger */}
        <button
          type="button"
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150 md:hidden"
          style={{ color: '#c084fc', background: 'rgba(147,51,234,0.1)', border: '1px solid rgba(147,51,234,0.2)' }}
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          ref={mobileRef}
          className="md:hidden"
          style={{
            background: 'linear-gradient(180deg, #1a1035 0%, #120d28 100%)',
            borderTop: '1px solid rgba(147,51,234,0.2)',
          }}
        >
          <div className="px-4 py-3">
            {showStorefrontNav && (
              <button
                type="button"
                onClick={() => { setMobileOpen(false); openPicker(); }}
                className="mb-3 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm"
                style={{ background: 'rgba(147,51,234,0.12)', border: '1px solid rgba(147,51,234,0.2)', color: '#c084fc' }}
              >
                <MapPin size={15} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-xs">
                  <span style={{ color: 'rgba(193,182,216,0.6)' }}>Deliver to </span>
                  {location?.label || 'Set location'}
                </span>
              </button>
            )}

            <div className="space-y-0.5">
              {showStorefrontNav && (
                <>
                  <MobileItem to="/restaurants" label="Restaurants" onClick={() => setMobileOpen(false)} />
                  <MobileItem to="/cart" label={`Cart${itemCount > 0 ? ` (${itemCount})` : ''}`} onClick={() => setMobileOpen(false)} />
                </>
              )}
              {user ? (
                <>
                  {user.role === 'RESTAURANT_OWNER' && <MobileItem to="/restaurant/dashboard" label="Restaurant dashboard" accent onClick={() => setMobileOpen(false)} />}
                  {user.role === 'DELIVERY_PARTNER' && <MobileItem to="/delivery/dashboard" label="Delivery dashboard" accent onClick={() => setMobileOpen(false)} />}
                  {isAdminPanelUser(user) && <MobileItem to="/admin/dashboard" label="Admin dashboard" accent onClick={() => setMobileOpen(false)} />}
                  <MobileItem to="/profile" label="Profile" onClick={() => setMobileOpen(false)} />
                  {showStorefrontNav && (
                    <>
                      <MobileItem to="/orders" label="My orders" onClick={() => setMobileOpen(false)} />
                      <MobileItem to="/profile/addresses" label="Addresses" onClick={() => setMobileOpen(false)} />
                      <MobileItem to="/favorites" label="Favorites" onClick={() => setMobileOpen(false)} />
                      <MobileItem to="/support" label="Support" onClick={() => setMobileOpen(false)} />
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => { setMobileOpen(false); logout(); }}
                    className="mt-2 w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium"
                    style={{ color: '#f87171', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}
                  >
                    Logout
                  </button>
                </>
              ) : (
                <Link
                  to="/login"
                  onClick={() => setMobileOpen(false)}
                  className="mt-2 block w-full rounded-xl py-2.5 text-center text-sm font-semibold text-white"
                  style={{ background: 'linear-gradient(135deg, #9333ea, #7c3aed)' }}
                >
                  Login
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

function DropItem({ to, icon: Icon, label, accent, onClick }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex items-center gap-2.5 px-4 py-2.5 text-sm transition-all duration-150"
      style={{ color: accent ? '#c084fc' : 'rgba(233,227,245,0.85)' }}
      onMouseEnter={e => e.currentTarget.style.background = accent ? 'rgba(147,51,234,0.12)' : 'rgba(255,255,255,0.05)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <Icon size={14} style={{ opacity: 0.7 }} />
      {label}
    </Link>
  );
}

function MobileItem({ to, label, accent, onClick }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="block rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150"
      style={{ color: accent ? '#c084fc' : 'rgba(233,227,245,0.85)' }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {label}
    </Link>
  );
}
