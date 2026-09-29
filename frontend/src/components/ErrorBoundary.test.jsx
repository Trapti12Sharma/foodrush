import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, afterEach } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

// A component that throws on demand. `shouldThrow` is read at render time so the
// same instance can be made to stop throwing, which is how the retry path is
// exercised.
function Boom({ shouldThrow, message = 'kaboom' }) {
  if (shouldThrow) throw new Error(message);
  return <p>recovered content</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs the caught error itself, and the boundary logs it again on
    // purpose. Silencing keeps the test output readable without suppressing the
    // assertion that the boundary DID log (checked below).
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>all fine</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('all fine')).toBeInTheDocument();
  });

  it('catches a render error and shows a recoverable fallback instead of a blank screen', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    // All three escape routes are offered.
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /home/i })).toBeInTheDocument();
  });

  it('logs the error for developers rather than swallowing it', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow message="diagnostic detail" />
      </ErrorBoundary>
    );

    const loggedAnything = console.error.mock.calls.some((args) =>
      args.some((a) => typeof a === 'string' && a.includes('Unhandled UI error'))
    );
    expect(loggedAnything).toBe(true);
  });

  it('recovers when "Try again" is pressed and the child no longer throws', async () => {
    const user = userEvent.setup();

    function Host() {
      // Flips to non-throwing on the first click, so pressing Try again lands on
      // a child that renders successfully.
      const [broken, setBroken] = useState(true);
      return (
        <div>
          <button type="button" onClick={() => setBroken(false)}>
            fix it
          </button>
          <ErrorBoundary>
            <Boom shouldThrow={broken} />
          </ErrorBoundary>
        </div>
      );
    }

    render(<Host />);
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /fix it/i }));
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(screen.getByText('recovered content')).toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it('treats a failed lazy-chunk import as a stale-tab problem, not a page bug', () => {
    // What a browser actually throws when a code-split chunk 404s after a deploy
    // (M18 route-split the admin/owner/delivery areas). The user should be told
    // to reload, not shown a generic failure for a page that is fine.
    render(
      <ErrorBoundary>
        <Boom shouldThrow message="Failed to fetch dynamically imported module: /assets/Admin-a1b2c3.js" />
      </ErrorBoundary>
    );

    expect(screen.getByText(/newer version of foodrush/i)).toBeInTheDocument();
    // "Try again" is pointless for a missing chunk — re-rendering re-requests the
    // same dead URL — so it is deliberately not offered here.
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });
});
