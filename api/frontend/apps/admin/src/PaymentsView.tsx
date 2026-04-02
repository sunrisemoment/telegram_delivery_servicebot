import { useDeferredValue, useEffect, useState } from 'react';

import { extractErrorMessage } from '@shared/api';
import { formatDateTime, humanize } from '@shared/format';
import type {
  BtcStatusSummary,
  PaymentDetailSummary,
  PaymentsListResponse,
  PaymentSummary,
} from '@shared/types';

import { adminRequest, isUnauthorizedError } from './admin-api';
import { DetailItem, EmptyPanel, LoadingPanel, StatCard, StatusPill } from './admin-ui';

type PaymentStatusFilter =
  | 'all'
  | 'pending'
  | 'pending_btc'
  | 'paid'
  | 'paid_confirmed'
  | 'paid_0conf';

type PaymentTypeFilter = 'all' | 'btc' | 'cash' | 'cashapp' | 'apple_cash' | 'card';

function formatDollars(amount: number | null | undefined): string {
  return `$${Number(amount || 0).toFixed(2)}`;
}

function formatPaymentLabel(paymentType: string | null | undefined): string {
  const normalized = String(paymentType || '').toLowerCase();
  const labels: Record<string, string> = {
    btc: 'Bitcoin',
    cash: 'Cash',
    cashapp: 'Cash App',
    apple_cash: 'Apple Cash',
    card: 'Card',
  };
  return labels[normalized] || humanize(normalized || 'payment');
}

function formatMaybeValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (typeof value === 'number') {
    return `${value}`;
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return String(value);
}

function formatSats(value: number | null | undefined): string {
  return `${Number(value || 0).toLocaleString()} sats`;
}

export default function PaymentsView({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [paymentsResponse, setPaymentsResponse] = useState<PaymentsListResponse | null>(null);
  const [selectedOrderNumber, setSelectedOrderNumber] = useState('');
  const [selectedPayment, setSelectedPayment] = useState<PaymentSummary | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<PaymentDetailSummary | null>(null);
  const [btcStatus, setBtcStatus] = useState<BtcStatusSummary | null>(null);
  const [paymentTypeFilter, setPaymentTypeFilter] = useState<PaymentTypeFilter>('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<PaymentStatusFilter>('all');
  const [search, setSearch] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const deferredSearch = useDeferredValue(search);

  async function loadPayments(): Promise<PaymentsListResponse | null> {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '200');
      if (paymentTypeFilter !== 'all') {
        params.set('payment_type', paymentTypeFilter);
      }
      if (paymentStatusFilter !== 'all') {
        params.set('payment_status', paymentStatusFilter);
      }

      const response = await adminRequest<PaymentsListResponse>(token, `/payments?${params.toString()}`);
      setPaymentsResponse(response);

      if (selectedOrderNumber) {
        const match = response.payments.find((payment) => payment.order_number === selectedOrderNumber) || null;
        setSelectedPayment(match);
        if (!match) {
          setSelectedDetails(null);
          setBtcStatus(null);
          setSelectedOrderNumber('');
          setAdminNotes('');
        }
      } else {
        setSelectedPayment(null);
      }

      setError('');
      return response;
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return null;
      }
      setError(extractErrorMessage(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPayments();
  }, [token, paymentTypeFilter, paymentStatusFilter]);

  const payments = paymentsResponse?.payments ?? [];
  const filteredPayments = payments.filter((payment) => {
    const haystack = [
      payment.order_number,
      payment.customer_telegram_id,
      payment.customer_phone,
      payment.driver_name,
      payment.payment_type,
      payment.payment_status,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(deferredSearch.trim().toLowerCase());
  });

  async function loadPaymentDetails(orderNumber: string, payment?: PaymentSummary | null) {
    setBusyAction(`detail-${orderNumber}`);
    try {
      const detail = await adminRequest<PaymentDetailSummary>(token, `/orders/${orderNumber}/payment-details`);
      setSelectedOrderNumber(orderNumber);
      setSelectedPayment(payment || payments.find((entry) => entry.order_number === orderNumber) || null);
      setSelectedDetails(detail);
      setBtcStatus(null);
      setAdminNotes('');
      setError('');
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    } finally {
      setBusyAction('');
    }
  }

  async function refreshSelectedPayment() {
    if (!selectedOrderNumber) {
      await loadPayments();
      return;
    }

    const refreshed = await loadPayments();
    const latestPayment =
      refreshed?.payments.find((payment) => payment.order_number === selectedOrderNumber) || selectedPayment;
    await loadPaymentDetails(selectedOrderNumber, latestPayment);
  }

  async function markPaymentApproved() {
    if (!selectedDetails) {
      return;
    }

    const orderNumber = selectedDetails.order_number;
    const isBtc = selectedDetails.payment_type === 'btc';
    const endpoint = isBtc ? `/payments/confirm-btc/${orderNumber}` : `/payments/mark-paid/${orderNumber}`;
    const actionLabel = isBtc ? 'Confirm Bitcoin payment' : 'Mark payment approved';

    if (!window.confirm(`${actionLabel} for ${orderNumber}?`)) {
      return;
    }

    setBusyAction(isBtc ? 'confirm-btc' : 'mark-paid');
    try {
      await adminRequest(token, endpoint, {
        method: 'POST',
        body: JSON.stringify({
          notes: adminNotes.trim() || undefined,
        }),
      });
      await refreshSelectedPayment();
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    } finally {
      setBusyAction('');
    }
  }

  async function checkBtcStatus() {
    if (!selectedDetails) {
      return;
    }

    setBusyAction('check-btc');
    try {
      const response = await adminRequest<BtcStatusSummary>(token, `/payments/check-btc/${selectedDetails.order_number}`);
      setBtcStatus(response);
      await loadPayments();
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    } finally {
      setBusyAction('');
    }
  }

  async function generateBtcLink() {
    if (!selectedDetails) {
      return;
    }

    setBusyAction('generate-btc');
    try {
      const response = await adminRequest<{
        payment_url: string;
        btc_address: string;
        btc_amount: number;
        usd_amount: number;
        expires_at: string;
        qr_code_url?: string;
      }>(token, `/payments/generate-btc/${selectedDetails.order_number}`, {
        method: 'POST',
      });

      setSelectedPayment((current) =>
        current
          ? {
              ...current,
              payment_metadata: {
                ...(current.payment_metadata || {}),
                payment_url: response.payment_url,
                btc_address: response.btc_address,
                btc_amount: response.btc_amount,
                usd_amount: response.usd_amount,
                expires_at: response.expires_at,
                qr_code_url: response.qr_code_url,
              },
            }
          : current,
      );

      window.open(response.payment_url, '_blank', 'noopener,noreferrer');
      await loadPayments();
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    } finally {
      setBusyAction('');
    }
  }

  const pendingApprovals = filteredPayments.filter((payment) => !payment.payment_confirmed).length;
  const pendingBtc = filteredPayments.filter((payment) => payment.payment_type === 'btc' && !payment.payment_confirmed).length;

  const metadata = (selectedPayment?.payment_metadata || {}) as Record<string, unknown>;
  const btcAddress = metadata.btc_address as string | undefined;
  const btcAmount = metadata.btc_amount as number | undefined;
  const paymentUrl = metadata.payment_url as string | undefined;
  const qrCodeUrl = metadata.qr_code_url as string | undefined;

  if (loading && !paymentsResponse) {
    return <LoadingPanel label="Loading payments" />;
  }

  return (
    <section className="stack">
      <section className="page-grid">
        <StatCard label="Tracked Payments" value={`${paymentsResponse?.summary.total_count ?? 0}`} />
        <StatCard label="Gross Amount" value={formatDollars(paymentsResponse?.summary.total_amount)} tone="olive" />
        <StatCard label="Pending Approval" value={`${pendingApprovals}`} tone={pendingApprovals ? 'warning' : 'default'} />
        <StatCard label="Pending BTC" value={`${pendingBtc}`} tone={pendingBtc ? 'warning' : 'default'} />
      </section>

      <section className="two-column-layout">
        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Payments</p>
              <h3>Approvals and BTC review</h3>
            </div>
            <button className="secondary-button" onClick={() => void loadPayments()} type="button">
              Refresh
            </button>
          </div>

          <div className="toolbar">
            <input
              className="search-input"
              placeholder="Search order, customer, driver, or phone"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select value={paymentTypeFilter} onChange={(event) => setPaymentTypeFilter(event.target.value as PaymentTypeFilter)}>
              <option value="all">All methods</option>
              <option value="btc">Bitcoin</option>
              <option value="cash">Cash</option>
              <option value="cashapp">Cash App</option>
              <option value="apple_cash">Apple Cash</option>
              <option value="card">Card</option>
            </select>
            <select value={paymentStatusFilter} onChange={(event) => setPaymentStatusFilter(event.target.value as PaymentStatusFilter)}>
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="pending_btc">Pending BTC</option>
              <option value="paid">Paid</option>
              <option value="paid_0conf">Paid 0-conf</option>
              <option value="paid_confirmed">Paid Confirmed</option>
            </select>
          </div>

          {error ? <div className="inline-error">{error}</div> : null}

          {filteredPayments.length ? (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Total</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Approved</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.map((payment) => (
                    <tr
                      key={payment.order_number}
                      className={selectedOrderNumber === payment.order_number ? 'selected-row' : ''}
                      onClick={() => void loadPaymentDetails(payment.order_number, payment)}
                    >
                      <td>{payment.order_number}</td>
                      <td>
                        <strong>{payment.customer_telegram_id ?? 'N/A'}</strong>
                        {payment.customer_phone ? <p className="table-subcopy">{payment.customer_phone}</p> : null}
                      </td>
                      <td>{formatDollars(payment.total)}</td>
                      <td>{formatPaymentLabel(payment.payment_type)}</td>
                      <td>
                        <StatusPill tone={payment.payment_status}>{humanize(payment.payment_status)}</StatusPill>
                      </td>
                      <td>
                        <StatusPill tone={payment.payment_confirmed ? 'approved' : 'pending'}>
                          {payment.payment_confirmed ? 'Approved' : 'Waiting'}
                        </StatusPill>
                      </td>
                      <td>{formatDateTime(payment.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyPanel title="No payments found" copy="Adjust the filters or wait for new orders to enter the payment queue." />
          )}
        </article>

        <article className="panel detail-panel">
          {selectedDetails && selectedPayment ? (
            <>
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Payment Detail</p>
                  <h3>{selectedDetails.order_number}</h3>
                </div>
                <StatusPill tone={selectedDetails.payment_confirmed ? 'approved' : 'pending'}>
                  {selectedDetails.payment_confirmed ? 'Approved' : 'Pending Approval'}
                </StatusPill>
              </div>

              <dl className="detail-grid">
                <DetailItem label="Method" value={formatPaymentLabel(selectedDetails.payment_type)} />
                <DetailItem label="Status" value={humanize(selectedDetails.payment_status)} />
                <DetailItem label="Subtotal" value={formatDollars(selectedDetails.subtotal)} />
                <DetailItem label="Delivery Fee" value={formatDollars(selectedDetails.delivery_fee)} />
                <DetailItem label="Total" value={formatDollars(selectedDetails.total)} />
                <DetailItem label="Customer" value={selectedDetails.customer_telegram_id ?? 'N/A'} />
                <DetailItem label="Phone" value={selectedDetails.customer_phone || 'N/A'} />
                <DetailItem label="Approved At" value={formatDateTime(selectedDetails.payment_confirmed_at)} />
              </dl>

              <div className="detail-block">
                <h4>Routing</h4>
                <p>{selectedDetails.delivery_address || 'No delivery address recorded for this payment.'}</p>
              </div>

              {selectedDetails.payment_type === 'btc' ? (
                <div className="detail-block">
                  <h4>Bitcoin Metadata</h4>
                  <div className="metadata-grid">
                    <div className="detail-item">
                      <span>BTC Address</span>
                      <code className="code-value">{btcAddress || 'Not generated yet'}</code>
                    </div>
                    <div className="detail-item">
                      <span>BTC Amount</span>
                      <strong>{btcAmount ? `${btcAmount} BTC` : '—'}</strong>
                    </div>
                    <div className="detail-item">
                      <span>Expires</span>
                      <strong>{formatDateTime(metadata.expires_at as string | undefined)}</strong>
                    </div>
                    <div className="detail-item">
                      <span>Payment Detected</span>
                      <strong>{metadata.btc_payment_detected ? 'Yes' : 'No'}</strong>
                    </div>
                  </div>

                  {btcStatus ? (
                    <div className="preview-card">
                      <p className="eyebrow">Latest Chain Check</p>
                      <div className="detail-grid">
                        <DetailItem label="Has Payment" value={btcStatus.has_payment ? 'Yes' : 'No'} />
                        <DetailItem label="Has Unconfirmed" value={btcStatus.has_unconfirmed ? 'Yes' : 'No'} />
                        <DetailItem label="Confirmed Balance" value={formatSats(btcStatus.confirmed_balance)} />
                        <DetailItem label="Unconfirmed Balance" value={formatSats(btcStatus.unconfirmed_balance)} />
                        <DetailItem label="Total Received" value={formatSats(btcStatus.total_received)} />
                        <DetailItem label="Error" value={btcStatus.error || 'None'} />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="detail-block">
                  <h4>Manual Approval Metadata</h4>
                  <div className="metadata-list">
                    <div className="detail-item">
                      <span>Notes</span>
                      <strong>{formatMaybeValue(metadata.manual_payment_notes)}</strong>
                    </div>
                    <div className="detail-item">
                      <span>Confirmed At</span>
                      <strong>{formatDateTime(metadata.manual_payment_confirmed_at as string | undefined)}</strong>
                    </div>
                  </div>
                </div>
              )}

              <label className="field">
                <span>Admin note</span>
                <textarea
                  rows={4}
                  value={adminNotes}
                  onChange={(event) => setAdminNotes(event.target.value)}
                  placeholder="Optional note recorded with manual approval"
                />
              </label>

              <div className="row-actions">
                {!selectedDetails.payment_confirmed ? (
                  <button className="primary-button" disabled={busyAction === 'mark-paid' || busyAction === 'confirm-btc'} onClick={() => void markPaymentApproved()} type="button">
                    {busyAction === 'mark-paid' || busyAction === 'confirm-btc'
                      ? 'Saving…'
                      : selectedDetails.payment_type === 'btc'
                        ? 'Confirm BTC Payment'
                        : 'Mark Payment Approved'}
                  </button>
                ) : null}

                {selectedDetails.payment_type === 'btc' ? (
                  <>
                    <button className="secondary-button" disabled={busyAction === 'check-btc'} onClick={() => void checkBtcStatus()} type="button">
                      {busyAction === 'check-btc' ? 'Checking…' : 'Check BTC Status'}
                    </button>
                    <button className="ghost-button" disabled={busyAction === 'generate-btc'} onClick={() => void generateBtcLink()} type="button">
                      {busyAction === 'generate-btc' ? 'Generating…' : 'Generate BTC Link'}
                    </button>
                    {paymentUrl ? (
                      <button
                        className="ghost-button"
                        onClick={() => window.open(paymentUrl, '_blank', 'noopener,noreferrer')}
                        type="button"
                      >
                        Open Payment Link
                      </button>
                    ) : null}
                    {qrCodeUrl ? (
                      <button
                        className="ghost-button"
                        onClick={() => window.open(qrCodeUrl, '_blank', 'noopener,noreferrer')}
                        type="button"
                      >
                        Open QR Code
                      </button>
                    ) : null}
                  </>
                ) : null}

                <button className="secondary-button" disabled={busyAction.startsWith('detail-')} onClick={() => void loadPaymentDetails(selectedDetails.order_number, selectedPayment)} type="button">
                  Refresh Detail
                </button>
              </div>
            </>
          ) : (
            <EmptyPanel title="Select a payment" copy="Choose a payment from the table to review approval state, BTC metadata, and manual confirmation actions." />
          )}
        </article>
      </section>
    </section>
  );
}
