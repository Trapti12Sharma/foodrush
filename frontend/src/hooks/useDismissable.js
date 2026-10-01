import { useEffect, useRef } from 'react';

// Closes a popover/dropdown when the user clicks outside it, moves the pointer
// out of it, or presses Escape. Returns a ref to put on the element that should
// count as "inside" — usually the wrapper holding both the trigger and the menu,
// so clicking the trigger again doesn't immediately re-close what it just opened.
//
// Pointer-leave is opt-in (`closeOnLeave`) because it is the wrong behaviour for
// anything the user has to interact with — a menu that vanishes the moment the
// cursor strays is hostile on a dropdown containing a form. It also never applies
// to touch input, where there is no hover and `mouseleave` fires at odd times.
//
// `mousedown` rather than `click`: a click that starts inside and ends outside
// (a drag, or selecting text in the menu) shouldn't count as leaving, and acting
// on mousedown also closes the menu before any outside button handles its own
// click — which is what makes a second trigger feel responsive.
export default function useDismissable(open, onClose, { closeOnLeave = false, leaveDelayMs = 300 } = {}) {
  const ref = useRef(null);
  // Kept in a ref so changing the callback identity between renders doesn't tear
  // down and re-attach the listeners.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      if (ref.current && !ref.current.contains(event.target)) onCloseRef.current();
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') onCloseRef.current();
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !closeOnLeave) return undefined;
    const element = ref.current;
    if (!element) return undefined;

    // A short grace period: without it, the menu closes on the slightest wobble
    // across a gap between the trigger and the panel, and re-entering cancels it.
    let timer = null;
    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const scheduleClose = () => {
      cancel();
      timer = setTimeout(() => onCloseRef.current(), leaveDelayMs);
    };

    element.addEventListener('mouseleave', scheduleClose);
    element.addEventListener('mouseenter', cancel);
    return () => {
      cancel();
      element.removeEventListener('mouseleave', scheduleClose);
      element.removeEventListener('mouseenter', cancel);
    };
  }, [open, closeOnLeave, leaveDelayMs]);

  return ref;
}
