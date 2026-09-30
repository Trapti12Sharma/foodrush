// The DEFAULT export on purpose: it is the same callable `toast` object as the
// named one, but it is also what every call site here used before this wrapper
// existed — and what test files therefore mock. Importing the named export
// instead would blow up against a `vi.mock` that only stubs `default`.
import base from 'react-hot-toast';

// Drop-in replacement for react-hot-toast's `toast` that collapses duplicates.
//
// React StrictMode (development only) deliberately mounts every component twice,
// so any toast fired from an effect — or from a promise an effect kicked off,
// like a failed initial data load — is raised twice and stacks two identical
// cards on screen. react-hot-toast treats `id` as a toast's identity: raising a
// toast with an id that is already on screen UPDATES it instead of adding
// another. Deriving that id from the message text therefore makes repeats
// collapse into one, without every call site having to invent an id.
//
// A caller that passes its own `id` still wins (the spread comes after), which
// is what you want for things like a loading toast that is later resolved.
function idFor(message) {
  const text = typeof message === 'string' ? message : '';
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 2147483647;
  return `t${hash}`;
}

function withId(message, options) {
  return { id: idFor(message), ...options };
}

const toast = (message, options) => base(message, withId(message, options));

toast.success = (message, options) => base.success(message, withId(message, options));
toast.error = (message, options) => base.error(message, withId(message, options));
toast.loading = (message, options) => base.loading(message, withId(message, options));

// Pass-throughs — these either manage their own ids or take no message at all.
// Read defensively so a partial mock in a test (which typically stubs only
// success/error) doesn't throw at import time and fail the whole file.
toast.custom = base?.custom;
toast.promise = base?.promise;
toast.dismiss = base?.dismiss;
toast.remove = base?.remove;

export default toast;
