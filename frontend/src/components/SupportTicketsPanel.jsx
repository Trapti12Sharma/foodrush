import { useEffect, useState } from 'react';
import toast from '@/utils/toast';
import { LifeBuoy, Paperclip, X } from 'lucide-react';
import { supportService } from '../services/supportService';
import { uploadService } from '../services/uploadService';
import EmptyState from './EmptyState';

const CATEGORIES = ['ORDER', 'PAYMENT', 'REFUND', 'DELIVERY', 'RESTAURANT', 'ACCOUNT', 'TECHNICAL', 'OTHER'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const STATUS_FILTERS = ['', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'];
const OPEN_FOR_REPLY = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER'];

const STATUS_STYLES = {
  OPEN: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  WAITING_FOR_USER: 'bg-purple-100 text-purple-700',
  RESOLVED: 'bg-green-100 text-green-700',
  CLOSED: 'bg-gray-200 text-gray-600',
};

function Badge({ value }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[value] || 'bg-gray-100 text-gray-500'}`}>{value}</span>;
}

// Uploads up to 3 files one at a time via the existing image-upload pipeline
// (purpose=support), collecting the returned URLs — the same pattern
// ImageUploadField uses for a single image, just accumulated into an array here.
function AttachmentPicker({ attachments, onChange }) {
  const [uploading, setUploading] = useState(false);

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []).slice(0, 3 - attachments.length);
    e.target.value = '';
    if (files.length === 0) return;
    setUploading(true);
    try {
      const urls = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const file of files) {
        // eslint-disable-next-line no-await-in-loop
        urls.push(await uploadService.uploadImage(file, 'support'));
      }
      onChange([...attachments, ...urls]);
    } catch (err) {
      toast.error(err.message || 'Could not upload attachment');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {attachments.map((url) => (
        <span key={url} className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">
          <Paperclip size={12} /> attachment
          <button type="button" onClick={() => onChange(attachments.filter((a) => a !== url))} aria-label="Remove attachment">
            <X size={12} />
          </button>
        </span>
      ))}
      {attachments.length < 3 && (
        <label className="cursor-pointer text-xs font-medium text-brand-600 hover:underline">
          {uploading ? 'Uploading…' : '+ Attach screenshot'}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading} onChange={handleFiles} />
        </label>
      )}
    </div>
  );
}

function CreateTicketForm({ restaurantId, onCreated, onCancel }) {
  const [category, setCategory] = useState('ORDER');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [orderId, setOrderId] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!subject.trim() || !description.trim()) return;
    setSubmitting(true);
    try {
      await supportService.createTicket({
        category,
        subject: subject.trim(),
        description: description.trim(),
        priority,
        orderId: orderId.trim() || undefined,
        restaurantId: restaurantId || undefined,
        attachments,
      });
      toast.success('Support ticket created');
      onCreated();
    } catch (err) {
      toast.error(err.message || 'Could not create ticket');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-gray-200 bg-surface p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
        maxLength={150}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Describe the issue…"
        maxLength={3000}
        rows={4}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <input
        value={orderId}
        onChange={(e) => setOrderId(e.target.value)}
        placeholder="Order ID (optional) — paste from the order's page if this is about a specific order"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <AttachmentPicker attachments={attachments} onChange={setAttachments} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !subject.trim() || !description.trim()}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit ticket'}
        </button>
      </div>
    </form>
  );
}

function TicketDetail({ ticket, onClose, onUpdated }) {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const canReply = OPEN_FOR_REPLY.includes(ticket.status);

  async function handleReply(e) {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    try {
      const updated = await supportService.addMessage(ticket._id, { message: message.trim(), attachments });
      onUpdated(updated);
      setMessage('');
      setAttachments([]);
    } catch (err) {
      toast.error(err.message || 'Could not send message');
    } finally {
      setSending(false);
    }
  }

  async function handleClose() {
    setClosing(true);
    try {
      const updated = await supportService.closeTicket(ticket._id);
      onUpdated(updated);
      toast.success('Ticket closed');
    } catch (err) {
      toast.error(err.message || 'Could not close ticket');
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-gray-100 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-gray-400">{ticket.ticketNumber}</p>
              <h2 className="text-lg font-bold text-gray-900">{ticket.subject}</h2>
            </div>
            <Badge value={ticket.status} />
          </div>
          <p className="mt-2 text-sm text-gray-600">{ticket.description}</p>
          {ticket.order?.orderNumber && <p className="mt-1 text-xs text-gray-400">Order #{ticket.order.orderNumber}</p>}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {(ticket.messages || []).map((m) => (
            <div key={m._id} className={`rounded-lg p-3 text-sm ${m.senderRole?.includes('ADMIN') || m.senderRole === 'SUPPORT_AGENT' ? 'bg-brand-50' : 'bg-gray-50'}`}>
              <p className="mb-1 text-xs font-semibold text-gray-500">{m.sender?.name || m.senderRole} · {new Date(m.createdAt).toLocaleString()}</p>
              <p className="text-gray-800">{m.message}</p>
            </div>
          ))}
          {(ticket.messages || []).length === 0 && <p className="text-center text-xs text-gray-400">No replies yet.</p>}
        </div>

        <div className="border-t border-gray-100 p-4">
          {canReply ? (
            <form onSubmit={handleReply} className="space-y-2">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Write a reply…"
                rows={2}
                maxLength={2000}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <div className="flex items-center justify-between">
                <AttachmentPicker attachments={attachments} onChange={setAttachments} />
                <div className="flex gap-2">
                  <button type="button" disabled={closing} onClick={handleClose} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                    {closing ? 'Closing…' : 'Close ticket'}
                  </button>
                  <button type="submit" disabled={sending || !message.trim()} className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                    {sending ? 'Sending…' : 'Reply'}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <p className="text-center text-xs text-gray-400">
              {ticket.status === 'CLOSED' ? 'This ticket is closed.' : 'This ticket has been resolved. It is not accepting new replies right now.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// One shared master-detail panel used identically by the customer, delivery-partner
// and restaurant-owner "Support" pages — the API and rules are the same for all
// three (see support.routes.js); `restaurantId`, when given, is silently attached to
// every ticket this panel creates (used by the restaurant-owner page only).
export default function SupportTicketsPanel({ restaurantId }) {
  const [tickets, setTickets] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState(null);

  function load() {
    setLoading(true);
    supportService
      .myTickets({ status: statusFilter || undefined, limit: 50 })
      .then((res) => setTickets(res.tickets))
      .catch((err) => toast.error(err.message || 'Could not load your tickets'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [statusFilter]);

  async function openDetail(id) {
    try {
      setDetail(await supportService.getTicket(id));
    } catch (err) {
      toast.error(err.message || 'Could not load ticket');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Support</h1>
        {!showCreate && (
          <button type="button" onClick={() => setShowCreate(true)} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            New ticket
          </button>
        )}
      </div>

      {showCreate && (
        <div className="mt-4">
          <CreateTicketForm
            restaurantId={restaurantId}
            onCreated={() => {
              setShowCreate(false);
              load();
            }}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Your tickets</h2>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>{s || 'All statuses'}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-gray-400">Loading…</p>
      ) : tickets.length === 0 ? (
        <EmptyState icon={LifeBuoy} title="No support tickets" description="Anything you need help with will show up here." />
      ) : (
        <div className="mt-3 space-y-2">
          {tickets.map((t) => (
            <button
              key={t._id}
              type="button"
              onClick={() => openDetail(t._id)}
              className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-surface p-4 text-left hover:shadow-sm"
            >
              <div>
                <p className="text-xs text-gray-400">{t.ticketNumber} · {t.category}</p>
                <p className="font-medium text-gray-900">{t.subject}</p>
                <p className="mt-1 text-xs text-gray-400">{new Date(t.createdAt).toLocaleString()}</p>
              </div>
              <Badge value={t.status} />
            </button>
          ))}
        </div>
      )}

      {detail && <TicketDetail ticket={detail} onClose={() => setDetail(null)} onUpdated={setDetail} />}
    </div>
  );
}
