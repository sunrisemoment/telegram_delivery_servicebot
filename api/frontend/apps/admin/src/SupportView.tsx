import { useEffect, useMemo, useState } from 'react';

import { extractErrorMessage } from '@shared/api';
import { formatDateTime, humanize } from '@shared/format';
import type { SupportTicketSummary } from '@shared/types';

import { adminRequest, isUnauthorizedError } from './admin-api';
import { DetailItem, EmptyPanel, StatusPill } from './admin-ui';

export default function SupportView({
  token,
  onUnauthorized,
  adminUsername,
}: {
  token: string;
  onUnauthorized: () => void;
  adminUsername: string;
}) {
  const [tickets, setTickets] = useState<SupportTicketSummary[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicketSummary | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadTickets() {
    try {
      const query = statusFilter === 'all' ? '' : `?status=${encodeURIComponent(statusFilter)}`;
      const response = await adminRequest<SupportTicketSummary[]>(token, `/support-tickets${query}`);
      const items = Array.isArray(response) ? response : [];
      setTickets(items);
      setSelectedTicket((current) => items.find((ticket) => ticket.id === current?.id) || items[0] || null);
      setError('');
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    }
  }

  useEffect(() => {
    void loadTickets();
  }, [token, statusFilter]);

  const statusOptions = useMemo(() => ['open', 'in_progress', 'resolved', 'closed'], []);

  async function updateTicket(nextStatus: string) {
    if (!selectedTicket) {
      return;
    }

    setSaving(true);
    try {
      await adminRequest(token, `/support-tickets/${selectedTicket.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: nextStatus,
          assigned_admin_username: adminUsername,
        }),
      });
      await loadTickets();
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="two-column-layout">
      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Support</p>
            <h3>Ticket queue</h3>
          </div>
          <div className="inline-actions">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {humanize(status)}
                </option>
              ))}
            </select>
            <button className="secondary-button" onClick={() => void loadTickets()} type="button">
              Refresh
            </button>
          </div>
        </div>

        {error ? <div className="inline-error">{error}</div> : null}

        {tickets.length ? (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr
                    key={ticket.id}
                    className={selectedTicket?.id === ticket.id ? 'selected-row' : ''}
                    onClick={() => setSelectedTicket(ticket)}
                  >
                    <td>{ticket.subject}</td>
                    <td>{ticket.customer_name || ticket.customer_telegram_id || 'N/A'}</td>
                    <td>
                      <StatusPill tone={ticket.status}>{humanize(ticket.status)}</StatusPill>
                    </td>
                    <td>{formatDateTime(ticket.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyPanel title="No support tickets" copy="Customer and driver support requests will appear here." />
        )}
      </article>

      <article className="panel detail-panel">
        {selectedTicket ? (
          <>
            <div className="panel-header">
              <div>
                <p className="eyebrow">Ticket Detail</p>
                <h3>{selectedTicket.subject}</h3>
              </div>
              <StatusPill tone={selectedTicket.status}>{humanize(selectedTicket.status)}</StatusPill>
            </div>

            <dl className="detail-grid">
              <DetailItem label="Customer" value={`${selectedTicket.customer_name || selectedTicket.customer_telegram_id || 'N/A'}`} />
              <DetailItem label="Order" value={selectedTicket.order_number || 'N/A'} />
              <DetailItem label="Category" value={humanize(selectedTicket.category)} />
              <DetailItem label="Priority" value={humanize(selectedTicket.priority)} />
            </dl>

            <div className="detail-block">
              <h4>Message</h4>
              <p className="detail-copy">{selectedTicket.message}</p>
            </div>

            <div className="row-actions">
              {statusOptions.map((status) => (
                <button
                  key={status}
                  className={status === selectedTicket.status ? 'secondary-button compact-button' : 'ghost-button compact-button'}
                  disabled={saving || status === selectedTicket.status}
                  onClick={() => void updateTicket(status)}
                  type="button"
                >
                  {humanize(status)}
                </button>
              ))}
            </div>
          </>
        ) : (
          <EmptyPanel title="Select a ticket" copy="Review a support ticket to update its status." />
        )}
      </article>
    </section>
  );
}
