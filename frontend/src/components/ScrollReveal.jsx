import { useEffect, useRef, useState } from 'react';

// Fades + lifts its children in once they scroll into view, then disconnects —
// this never re-hides content the visitor has already seen (no re-triggering
// on scroll-up), so it can't make something flicker in and out while reading.
// One IntersectionObserver per instance; cheap to mount many of these down a
// page since each only does work for the single element it watches.
//
// Reduced-motion note: this doesn't use the shared `[data-food-anim]` CSS gate
// (there's no infinite loop here to kill) — instead it just skips the
// observer entirely and renders already-visible, which is the correct
// reduced-motion behaviour for a one-shot entrance effect.
export default function ScrollReveal({ children, className = '', delay = 0, as: Tag = 'div' }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setVisible(true);
      return undefined;
    }
    const node = ref.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`transition-all duration-700 ease-out ${visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'} ${className}`}
      style={{ transitionDelay: visible ? `${delay}ms` : '0ms' }}
    >
      {children}
    </Tag>
  );
}
