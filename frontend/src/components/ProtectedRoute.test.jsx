import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi } from 'vitest';
import ProtectedRoute from './ProtectedRoute';
import { useAuth } from '../context/AuthContext';

// The auth state is the only input that matters here, so it is mocked directly
// rather than rendering a real AuthProvider and a fake API behind it. That keeps
// each case to one obvious variable: who is signed in.
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));

// Renders a protected "/secret" alongside the two pages ProtectedRoute can
// redirect to, so a redirect is observable as rendered output rather than as an
// assertion about router internals.
function renderAt(path, element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>home page</p>} />
        <Route path="/login" element={<p>login page</p>} />
        <Route path="/secret" element={element} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  it('waits while auth is still loading instead of bouncing to login', () => {
    // The bug this guards against: treating "not loaded yet" as "not signed in"
    // would redirect a legitimately signed-in user to /login on every refresh,
    // because the session is restored asynchronously.
    useAuth.mockReturnValue({ user: null, loading: true });
    renderAt('/secret', <ProtectedRoute><p>secret content</p></ProtectedRoute>);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText('login page')).not.toBeInTheDocument();
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });

  it('redirects an anonymous visitor to login', () => {
    useAuth.mockReturnValue({ user: null, loading: false });
    renderAt('/secret', <ProtectedRoute><p>secret content</p></ProtectedRoute>);

    expect(screen.getByText('login page')).toBeInTheDocument();
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });

  it('renders the page for a signed-in user when no role is required', () => {
    useAuth.mockReturnValue({ user: { _id: 'u1', role: 'CUSTOMER' }, loading: false });
    renderAt('/secret', <ProtectedRoute><p>secret content</p></ProtectedRoute>);

    expect(screen.getByText('secret content')).toBeInTheDocument();
  });

  it('keeps a signed-in user out of a route their role does not allow', () => {
    useAuth.mockReturnValue({ user: { _id: 'u1', role: 'CUSTOMER' }, loading: false });
    renderAt(
      '/secret',
      <ProtectedRoute roles={['ADMIN', 'SUPER_ADMIN']}>
        <p>admin content</p>
      </ProtectedRoute>
    );

    expect(screen.getByText('home page')).toBeInTheDocument();
    expect(screen.queryByText('admin content')).not.toBeInTheDocument();
  });

  it('admits a user whose role is in the allowed list', () => {
    useAuth.mockReturnValue({ user: { _id: 'a1', role: 'ADMIN' }, loading: false });
    renderAt(
      '/secret',
      <ProtectedRoute roles={['ADMIN', 'SUPER_ADMIN']}>
        <p>admin content</p>
      </ProtectedRoute>
    );

    expect(screen.getByText('admin content')).toBeInTheDocument();
  });

  it('does not admit a staff role that is merely adjacent to the allowed one', () => {
    // SUPPORT_AGENT can open the admin panel generally, but must not reach a
    // route restricted to SUPER_ADMIN. Role lists are exact membership, never
    // "is some kind of staff".
    useAuth.mockReturnValue({ user: { _id: 's1', role: 'SUPPORT_AGENT' }, loading: false });
    renderAt(
      '/secret',
      <ProtectedRoute roles={['SUPER_ADMIN']}>
        <p>super admin only</p>
      </ProtectedRoute>
    );

    expect(screen.queryByText('super admin only')).not.toBeInTheDocument();
    expect(screen.getByText('home page')).toBeInTheDocument();
  });
});
