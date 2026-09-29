import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import DateRangePicker, { DEFAULT_RANGE } from './DateRangePicker';

// These cases exist because the component's job is to never emit a range the
// API would reject with a 400. Every assertion below is about what onChange
// does or does not fire.
describe('DateRangePicker', () => {
  it('emits a preset immediately, with no date fields needed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateRangePicker value={DEFAULT_RANGE} onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText(/date range/i), 'last7days');
    expect(onChange).toHaveBeenCalledWith({ preset: 'last7days' });
  });

  it('offers exactly the presets the backend accepts', () => {
    render(<DateRangePicker value={DEFAULT_RANGE} onChange={vi.fn()} />);
    const values = Array.from(screen.getByLabelText(/date range/i).options).map((o) => o.value);

    // Mirrors PRESETS in backend/src/utils/dateRange.js. A value here that the
    // parser does not know would be a guaranteed 400.
    expect(values).toEqual([
      'today',
      'yesterday',
      'last7days',
      'last30days',
      'thismonth',
      'lastmonth',
      'alltime',
      'custom',
    ]);
  });

  it('withholds a custom range until both ends are filled in', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateRangePicker value={{ preset: 'custom' }} onChange={onChange} />);

    await user.type(screen.getByLabelText(/start date/i), '2026-03-01');

    // A custom range missing endDate is a 400 from the API, so it must not be
    // sent. The prompt tells the user why nothing has loaded.
    const emittedWithDates = onChange.mock.calls.some(([arg]) => arg.startDate && arg.endDate);
    expect(emittedWithDates).toBe(false);
    expect(screen.getByText(/pick both dates/i)).toBeInTheDocument();
  });

  it('emits the range once both ends are present and in order', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateRangePicker value={{ preset: 'custom' }} onChange={onChange} />);

    await user.type(screen.getByLabelText(/start date/i), '2026-03-01');
    await user.type(screen.getByLabelText(/end date/i), '2026-03-31');

    expect(onChange).toHaveBeenCalledWith({
      preset: 'custom',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    });
  });

  it('refuses to emit a backwards range and says so', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateRangePicker value={{ preset: 'custom' }} onChange={onChange} />);

    await user.type(screen.getByLabelText(/start date/i), '2026-03-31');
    await user.type(screen.getByLabelText(/end date/i), '2026-03-01');

    // The backend rejects start >= end. Catching it here turns a round-trip
    // error into an inline explanation.
    const emittedBackwards = onChange.mock.calls.some(
      ([arg]) => arg.startDate === '2026-03-31' && arg.endDate === '2026-03-01'
    );
    expect(emittedBackwards).toBe(false);
    expect(screen.getByText(/must be on or before/i)).toBeInTheDocument();
  });

  it('accepts a single-day range, which is a valid window', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateRangePicker value={{ preset: 'custom' }} onChange={onChange} />);

    await user.type(screen.getByLabelText(/start date/i), '2026-03-07');
    await user.type(screen.getByLabelText(/end date/i), '2026-03-07');

    // Equal dates are allowed: the backend treats a bare end date as
    // through-end-of-day, so this is one full day, not an empty range.
    expect(onChange).toHaveBeenCalledWith({
      preset: 'custom',
      startDate: '2026-03-07',
      endDate: '2026-03-07',
    });
  });
});
