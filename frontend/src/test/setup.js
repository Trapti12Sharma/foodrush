import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// M20 — shared setup for every frontend test.
//
// cleanup() unmounts anything a test rendered. Without it the previous test's
// DOM is still attached when the next one queries, so getByRole finds two
// matching elements and fails for a reason that has nothing to do with the code
// under test — the frontend equivalent of the shared-state problem the backend
// suite hit with its Mongo connection.
afterEach(() => {
  cleanup();
});

// jsdom implements neither of these, and components that call them would throw
// during a test for reasons unrelated to what is being asserted.
//
// matchMedia: any responsive hook or library that asks about breakpoints.
// IntersectionObserver: SmartImage's lazy loading (components/SmartImage.jsx).
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
}

if (!window.IntersectionObserver) {
  window.IntersectionObserver = class {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
}
