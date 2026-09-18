import { Construction } from 'lucide-react';
import EmptyState from '../components/EmptyState';

// Honest placeholder for routes whose backend/UI lands in a later build phase —
// deliberately not a fake interactive page, just a status message.
export default function ComingSoon({ title, phase }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24">
      <EmptyState
        icon={Construction}
        title={title}
        description={`This page is being built in ${phase}. Check back soon.`}
      />
    </div>
  );
}
