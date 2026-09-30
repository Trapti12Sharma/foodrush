import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach } from 'vitest';
import Reviews from './Reviews';
import { useRestaurantOwner } from '../../context/RestaurantOwnerContext';
import { reviewService } from '../../services/reviewService';

vi.mock('../../context/RestaurantOwnerContext', () => ({ useRestaurantOwner: vi.fn() }));
vi.mock('../../services/reviewService', () => ({
  reviewService: {
    listForRestaurant: vi.fn(),
    reply: vi.fn(),
    removeReply: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const RESTAURANT = { _id: 'r1', name: 'Napoli', rating: 4.2, totalReviews: 3 };

const UNANSWERED = {
  _id: 'rev1',
  rating: 2,
  comment: 'Cold when it arrived',
  createdAt: '2026-03-01T00:00:00.000Z',
  user: { _id: 'c1', name: 'Asha' },
  reply: null,
};

const ANSWERED = {
  ...UNANSWERED,
  _id: 'rev2',
  comment: 'Lovely food',
  reply: { text: 'Thanks so much!', repliedAt: '2026-03-02T00:00:00.000Z' },
};

describe('Owner Reviews page — replies', () => {
  beforeEach(() => {
    useRestaurantOwner.mockReturnValue({ selectedRestaurant: RESTAURANT });
    reviewService.listForRestaurant.mockResolvedValue({ reviews: [UNANSWERED, ANSWERED] });
  });

  it('offers Reply on an unanswered review and shows the existing reply on an answered one', async () => {
    render(<Reviews />);
    await waitFor(() => expect(screen.getByText('Cold when it arrived')).toBeInTheDocument());

    // One Reply button — only the unanswered review gets one.
    expect(screen.getAllByRole('button', { name: /^reply$/i })).toHaveLength(1);
    // The answered one shows its text with edit/remove instead.
    expect(screen.getByText('Thanks so much!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });

  it('publishes a reply and shows it without a full refetch', async () => {
    const user = userEvent.setup();
    reviewService.reply.mockResolvedValue({ reply: { text: 'Sorry about that — refund sent.', repliedAt: '2026-03-03T00:00:00.000Z' } });

    render(<Reviews />);
    await waitFor(() => expect(screen.getByText('Cold when it arrived')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^reply$/i }));
    await user.type(screen.getByLabelText(/your reply/i), 'Sorry about that — refund sent.');
    await user.click(screen.getByRole('button', { name: /publish reply/i }));

    await waitFor(() => expect(reviewService.reply).toHaveBeenCalledWith('rev1', 'Sorry about that — refund sent.'));
    // Patched in place: the list is not refetched, so the page does not jump.
    expect(reviewService.listForRestaurant).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Sorry about that — refund sent.')).toBeInTheDocument();
  });

  it('will not publish an empty or whitespace-only reply', async () => {
    const user = userEvent.setup();
    render(<Reviews />);
    await waitFor(() => expect(screen.getByText('Cold when it arrived')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^reply$/i }));
    const publish = screen.getByRole('button', { name: /publish reply/i });

    // Disabled while empty — the API would 422, so the button never fires it.
    expect(publish).toBeDisabled();

    await user.type(screen.getByLabelText(/your reply/i), '    ');
    expect(publish).toBeDisabled();
    expect(reviewService.reply).not.toHaveBeenCalled();
  });

  it('pre-fills the existing text when editing, so a typo fix is not a retype', async () => {
    const user = userEvent.setup();
    render(<Reviews />);
    await waitFor(() => expect(screen.getByText('Thanks so much!')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /edit/i }));
    expect(screen.getByLabelText(/your reply/i)).toHaveValue('Thanks so much!');
  });

  it('asks for confirmation before removing a reply, and removes it on confirm', async () => {
    const user = userEvent.setup();
    reviewService.removeReply.mockResolvedValue({});

    render(<Reviews />);
    await waitFor(() => expect(screen.getByText('Thanks so much!')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /remove/i }));
    // Removing public content is not a one-click action.
    expect(screen.getByText(/remove your reply\?/i)).toBeInTheDocument();
    expect(reviewService.removeReply).not.toHaveBeenCalled();

    // Scoped to the dialog: the row's own "Remove" button is still on screen, so
    // an unscoped query matches two elements. (That both are reachable at once
    // is a real accessibility gap in ConfirmDialog — it is not aria-modal and
    // does not trap focus — but that belongs to the accessibility pass, not here.)
    const dialog = screen.getByText(/remove your reply\?/i).closest('div');
    await user.click(within(dialog).getByRole('button', { name: /^remove$/i }));
    await waitFor(() => expect(reviewService.removeReply).toHaveBeenCalledWith('rev2'));
    await waitFor(() => expect(screen.queryByText('Thanks so much!')).not.toBeInTheDocument());
  });

  it('keeps the reply on screen when publishing fails', async () => {
    const user = userEvent.setup();
    reviewService.reply.mockRejectedValue({ status: 400, message: 'Cannot reply to a review that is "HIDDEN"' });

    render(<Reviews />);
    await waitFor(() => expect(screen.getByText('Cold when it arrived')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^reply$/i }));
    await user.type(screen.getByLabelText(/your reply/i), 'Let me explain');
    await user.click(screen.getByRole('button', { name: /publish reply/i }));

    // The form stays open with the text intact rather than closing and losing it.
    await waitFor(() => expect(reviewService.reply).toHaveBeenCalled());
    expect(screen.getByLabelText(/your reply/i)).toHaveValue('Let me explain');
  });
});
