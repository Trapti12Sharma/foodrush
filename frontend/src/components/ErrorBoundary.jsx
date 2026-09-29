import { Component } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

// M19 — the app's last line of defence against a blank screen.
//
// React unmounts the entire tree when a render throws and nothing catches it, so
// without this a single bad field access in one component gives the user a white
// page with no explanation and no way out. This catches it and renders something
// they can act on instead.
//
// Must be a class: getDerivedStateFromError and componentDidCatch have no hooks
// equivalent, which is the one remaining reason to write a class component.
//
// WHAT IS DELIBERATELY NOT SHOWN: the error message and stack are logged to the
// console but never rendered in production. An exception string can carry a URL
// with a token in it, an internal field name, or a database error quoting the
// document it choked on — none of which belongs on a customer's screen. In
// development the message IS shown, because there the person reading it is the
// person who has to fix it.
//
// Lazy-chunk failures get their own message. Since M18 route-split the admin,
// owner and delivery areas, a user holding an old tab open across a deploy can
// hit a dynamic import for a hashed filename that no longer exists. That is not
// a bug in the page they were opening and "reload" genuinely fixes it, so it is
// worth saying so rather than showing a generic failure.
const CHUNK_ERROR = /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i;

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // The only place the detail goes. No external error service is wired up in
    // this project, and adding one would be a dependency and a data-egress
    // decision that belongs to the user, not to this component.
    console.error('Unhandled UI error:', error, info?.componentStack);
  }

  handleRetry = () => {
    // Clears the boundary and re-renders the same subtree. Enough for a
    // transient failure (a race on data that has since arrived); if the error is
    // deterministic it will simply land here again, which is why Reload and Home
    // are offered alongside it rather than instead of it.
    this.setState({ error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  handleHome = () => {
    // A hard navigation, not a router push: the router lives inside the subtree
    // that just failed, so its in-memory state is not to be trusted here.
    window.location.assign('/');
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isChunkError = CHUNK_ERROR.test(error.message || '');
    const isDev = import.meta.env.DEV;

    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <AlertTriangle size={22} />
          </div>

          <h1 className="text-lg font-bold text-gray-900">
            {isChunkError ? 'A newer version of FoodRush is available' : 'Something went wrong'}
          </h1>

          <p className="mt-2 text-sm text-gray-500">
            {isChunkError
              ? 'This tab has been open since an earlier version was deployed, so part of the app could not be loaded. Reloading will pick up the current version.'
              : "This page hit an unexpected error. Nothing you were doing has been lost — your cart and your orders are saved on the server, not in this tab."}
          </p>

          {isDev && (
            <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-gray-50 p-3 text-left text-xs text-red-700">
              {error.message}
            </pre>
          )}

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {!isChunkError && (
              <button
                type="button"
                onClick={this.handleRetry}
                className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Try again
              </button>
            )}
            <button
              type="button"
              onClick={this.handleReload}
              className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              <RefreshCw size={15} /> Reload
            </button>
            <button
              type="button"
              onClick={this.handleHome}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Home size={15} /> Home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
