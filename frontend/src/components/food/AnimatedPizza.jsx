import AnimatedFood from './AnimatedFood';

// Thin preset over AnimatedFood — exists because the ask was specifically for
// named per-food components, not just the generic engine. Forwards every prop,
// so `<AnimatedPizza src="/images/pizza.png" size="lg" interactive />` works
// exactly like `<AnimatedFood type="pizza" .../>`.
export default function AnimatedPizza(props) {
  return <AnimatedFood type="pizza" {...props} />;
}
