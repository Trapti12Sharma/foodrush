import { Link } from 'react-router-dom';
import AnimatedFries from '../components/food/AnimatedFries';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <AnimatedFries size="lg" interactive label="Dropped fries" className="mx-auto mb-2" />
      <p className="text-6xl font-extrabold text-brand-600">404</p>
      <p className="mt-2 text-lg font-medium text-gray-900">Page not found</p>
      <Link to="/" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline">
        Back to home
      </Link>
    </div>
  );
}
