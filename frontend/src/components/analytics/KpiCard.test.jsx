import { render, screen } from '@testing-library/react';
import KpiCard from './KpiCard';

// The distinction these tests protect is the one the analytics API goes out of
// its way to express: a metric it cannot compute returns null, not 0. Rendering
// that null as "0" or "₹0.00" would state something false — "no orders to divide
// by" is not "a 0% completion rate".
describe('KpiCard', () => {
  it('shows a real zero as a zero', () => {
    render(<KpiCard label="Net sales" value="₹0.00" />);
    expect(screen.getByText('₹0.00')).toBeInTheDocument();
    expect(screen.queryByText(/no data/i)).not.toBeInTheDocument();
  });

  it('shows "No data" for null rather than inventing a zero', () => {
    render(<KpiCard label="Completion rate" value={null} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('treats undefined the same as null', () => {
    render(<KpiCard label="Avg delivery time" value={undefined} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it('does not show a hint when there is no value for it to qualify', () => {
    // A hint like "of 12 placed" alongside "No data" would imply a figure that
    // was never computed.
    render(<KpiCard label="Delivered orders" value={null} hint="of 12 placed" />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
    expect(screen.queryByText('of 12 placed')).not.toBeInTheDocument();
  });

  it('shows the hint when there is a value', () => {
    render(<KpiCard label="Delivered orders" value="8" hint="of 12 placed" />);
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('of 12 placed')).toBeInTheDocument();
  });

  it('renders the label for every state', () => {
    const { rerender } = render(<KpiCard label="Refunded" value={null} />);
    expect(screen.getByText('Refunded')).toBeInTheDocument();

    rerender(<KpiCard label="Refunded" value="₹40.00" />);
    expect(screen.getByText('Refunded')).toBeInTheDocument();
  });
});
