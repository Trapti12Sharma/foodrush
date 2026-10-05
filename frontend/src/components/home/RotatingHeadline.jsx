import { useEffect, useState } from 'react';

const WORDS = ['pizza', 'biryani', 'burgers', 'Chinese', 'desserts', 'rolls'];

// Swaps the emphasised word in the hero heading every few seconds — a cheap
// `setInterval` that only ever touches one string in state, not a per-frame
// animation loop. The cross-fade is plain CSS (opacity/translate transition
// retriggered by the key change), and respects `data-food-anim` like every
// other motion in this app.
export default function RotatingHeadline() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const id = setInterval(() => setIndex((i) => (i + 1) % WORDS.length), 2600);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      key={index}
      data-food-anim
      className="inline-block animate-[word-in_0.5s_ease-out] bg-gradient-to-r from-brand-500 to-accent-400 bg-clip-text text-transparent"
    >
      {WORDS[index]}
    </span>
  );
}
