import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { extractErrorMessage } from '@shared/api';
import { formatCurrency, formatDateTime, humanize } from '@shared/format';
import type {
  AdminReferralDashboardResponse,
  ReferralBatchSummary,
  ReferralRewardSummary,
  ReferralSummary,
} from '@shared/types';

import { ADMIN_API_BASE, adminRequest, isUnauthorizedError } from './admin-api';
import { EmptyPanel, StatCard, StatusPill } from './admin-ui';

type ReferralSummaryCounters = AdminReferralDashboardResponse['summary'];

const EMPTY_DASHBOARD: AdminReferralDashboardResponse = {
  referrals: [],
  pending_approvals: [],
  rewards: [],
  batches: [],
  summary: {
    created_count: 0,
    signed_up_count: 0,
    awaiting_admin_approval_count: 0,
    approved_count: 0,
    reward_issued_count: 0,
  },
};

export default function ReferralsView({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [dashboard, setDashboard] = useState<AdminReferralDashboardResponse>(EMPTY_DASHBOARD);
  const [error, setError] = useState('');
  const [liveNotice, setLiveNotice] = useState('');
  const [approvalNotes, setApprovalNotes] = useState<Record<number, string>>({});
  const [actingReferralId, setActingReferralId] = useState<number | null>(null);
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [creatingManualReward, setCreatingManualReward] = useState(false);
  const [latestBatchCodes, setLatestBatchCodes] = useState<string[]>([]);
  const [batchForm, setBatchForm] = useState({
    name: '',
    code_count: '10',
    campaign_tag: '',
    source_tag: '',
    notes: '',
  });
  const [manualRewardForm, setManualRewardForm] = useState({
    recipient_customer_id: '',
    amount_cents: '2500',
    reward_type: 'vip_bonus',
    notes: '',
  });
  const summaryRef = useRef<ReferralSummaryCounters | null>(null);

  async function loadDashboard({ silent = false }: { silent?: boolean } = {}) {
    try {
      const response = await adminRequest<AdminReferralDashboardResponse>(token, '/referrals');
      setDashboard(response || EMPTY_DASHBOARD);
      setError('');

      if (summaryRef.current) {
        const previous = summaryRef.current;
        const next = response.summary;
        const notices: string[] = [];
        if (next.created_count > previous.created_count) {
          notices.push(`${next.created_count - previous.created_count} new referral code${next.created_count - previous.created_count === 1 ? '' : 's'} created`);
        }
        if (next.signed_up_count > previous.signed_up_count) {
          notices.push(`${next.signed_up_count - previous.signed_up_count} referred signup${next.signed_up_count - previous.signed_up_count === 1 ? '' : 's'} recorded`);
        }
        if (next.awaiting_admin_approval_count > previous.awaiting_admin_approval_count) {
          notices.push(`${next.awaiting_admin_approval_count - previous.awaiting_admin_approval_count} account${next.awaiting_admin_approval_count - previous.awaiting_admin_approval_count === 1 ? '' : 's'} entered the approval queue`);
        }
        if (notices.length) {
          setLiveNotice(notices.join(' • '));
        } else if (!silent) {
          setLiveNotice('');
        }
      }
      summaryRef.current = response.summary;
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    }
  }

  useEffect(() => {
    void loadDashboard();
    const intervalId = window.setInterval(() => {
      void loadDashboard({ silent: true });
    }, 20_000);
    return () => window.clearInterval(intervalId);
  }, [token]);

  async function handleApprovalAction(referralId: number, action: 'approve' | 'reject') {
    setActingReferralId(referralId);
    try {
      await adminRequest<ReferralSummary>(token, `/referrals/${referralId}/${action}`, {
        method: 'POST',
        body: JSON.stringify({
          note: approvalNotes[referralId] || null,
        }),
      });
      setApprovalNotes((current) => {
        const next = { ...current };
        delete next[referralId];
        return next;
      });
      await loadDashboard();
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    } finally {
      setActingReferralId(null);
    }
  }

  async function handleCreateBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingBatch(true);
    try {
      const response = await adminRequest<{ batch: ReferralBatchSummary; codes: string[] }>(token, '/referrals/batches', {
        method: 'POST',
        body: JSON.stringify({
          name: batchForm.name,
          code_count: Number(batchForm.code_count),
          campaign_tag: batchForm.campaign_tag || null,
          source_tag: batchForm.source_tag || null,
          notes: batchForm.notes || null,
        }),
      });
      setLatestBatchCodes(Array.isArray(response.codes) ? response.codes : []);
      setBatchForm({
        name: '',
        code_count: '10',
        campaign_tag: '',
        source_tag: '',
        notes: '',
      });
      await loadDashboard();
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    } finally {
      setCreatingBatch(false);
    }
  }

  async function handleCreateManualReward(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingManualReward(true);
    try {
      await adminRequest<ReferralRewardSummary>(token, '/referrals/rewards/manual', {
        method: 'POST',
        body: JSON.stringify({
          recipient_customer_id: Number(manualRewardForm.recipient_customer_id),
          amount_cents: Number(manualRewardForm.amount_cents),
          reward_type: manualRewardForm.reward_type,
          notes: manualRewardForm.notes || null,
        }),
      });
      setManualRewardForm({
        recipient_customer_id: '',
        amount_cents: '2500',
        reward_type: 'vip_bonus',
        notes: '',
      });
      await loadDashboard();
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    } finally {
      setCreatingManualReward(false);
    }
  }

  async function handleDownloadBatchCsv(batchId: number) {
    try {
      const response = await fetch(`${ADMIN_API_BASE}/referrals/batches/${batchId}/csv`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.status === 401) {
        onUnauthorized();
        return;
      }
      if (!response.ok) {
        throw new Error(`CSV export failed with status ${response.status}`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `referral-batch-${batchId}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(objectUrl);
    } catch (cause) {
      setError(extractErrorMessage(cause));
    }
  }

  return (
    <section className="view-stack">
      <div className="page-grid">
        <StatCard label="Codes Created" value={`${dashboard.summary.created_count}`} />
        <StatCard label="Signed Up" value={`${dashboard.summary.signed_up_count}`} tone="olive" />
        <StatCard label="Awaiting Approval" value={`${dashboard.summary.awaiting_admin_approval_count}`} tone="warning" />
        <StatCard label="Rewards Issued" value={`${dashboard.summary.reward_issued_count}`} tone="olive" />
      </div>

      {liveNotice ? <article className="panel notice-panel">{liveNotice}</article> : null}
      {error ? <div className="inline-error">{error}</div> : null}

      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Approval Queue</p>
            <h3>Pending referred customers</h3>
          </div>
          <button className="secondary-button" onClick={() => void loadDashboard()} type="button">
            Refresh
          </button>
        </div>

        {dashboard.pending_approvals.length ? (
          <div className="approval-queue-grid">
            {dashboard.pending_approvals.map((referral) => (
              <article key={referral.id} className="summary-card approval-card">
                <div className="panel-header compact-header">
                  <div>
                    <strong>{referral.referred_name || 'Pending name'}</strong>
                    <p className="detail-copy">
                      {referral.referred_phone || 'No phone'} • {referral.invite_code || 'No code'}
                    </p>
                  </div>
                  <StatusPill tone={referral.status}>{humanize(referral.status)}</StatusPill>
                </div>
                <div className="detail-grid">
                  <div className="detail-item">
                    <span>Referred By</span>
                    <strong>{referral.referrer_name || referral.batch_name || 'Campaign / bulk code'}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Created</span>
                    <strong>{formatDateTime(referral.created_at)}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Signed Up</span>
                    <strong>{formatDateTime(referral.signed_up_at || referral.claimed_at)}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Source</span>
                    <strong>{referral.source_tag || referral.campaign_tag || 'Direct referral'}</strong>
                  </div>
                </div>
                <label className="field">
                  <span>Admin Note</span>
                  <textarea
                    rows={2}
                    placeholder="Optional approval or rejection note"
                    value={approvalNotes[referral.id] || ''}
                    onChange={(event) => setApprovalNotes((current) => ({ ...current, [referral.id]: event.target.value }))}
                  />
                </label>
                <div className="row-actions">
                  <button
                    className="primary-button compact-button"
                    disabled={actingReferralId === referral.id}
                    onClick={() => void handleApprovalAction(referral.id, 'approve')}
                    type="button"
                  >
                    {actingReferralId === referral.id ? 'Saving…' : 'Approve'}
                  </button>
                  <button
                    className="ghost-button compact-button"
                    disabled={actingReferralId === referral.id}
                    onClick={() => void handleApprovalAction(referral.id, 'reject')}
                    type="button"
                  >
                    Reject
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyPanel title="No approvals pending" copy="New referred signups will appear here for admin review." />
        )}
      </article>

      <div className="two-column-layout">
        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Bulk Codes</p>
              <h3>Campaign and giveaway batches</h3>
            </div>
          </div>

          <form className="stack" onSubmit={handleCreateBatch}>
            <label className="field">
              <span>Batch Name</span>
              <input
                required
                value={batchForm.name}
                onChange={(event) => setBatchForm((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <div className="split-fields">
              <label className="field">
                <span>Code Count</span>
                <input
                  inputMode="numeric"
                  required
                  value={batchForm.code_count}
                  onChange={(event) => setBatchForm((current) => ({ ...current, code_count: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Campaign Tag</span>
                <input
                  value={batchForm.campaign_tag}
                  onChange={(event) => setBatchForm((current) => ({ ...current, campaign_tag: event.target.value }))}
                />
              </label>
            </div>
            <label className="field">
              <span>Source Tag</span>
              <input
                value={batchForm.source_tag}
                onChange={(event) => setBatchForm((current) => ({ ...current, source_tag: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Notes</span>
              <textarea
                rows={3}
                value={batchForm.notes}
                onChange={(event) => setBatchForm((current) => ({ ...current, notes: event.target.value }))}
              />
            </label>
            <button className="primary-button" disabled={creatingBatch} type="submit">
              {creatingBatch ? 'Generating…' : 'Generate Batch'}
            </button>
          </form>

          {latestBatchCodes.length ? (
            <div className="detail-block">
              <h4>Latest batch codes</h4>
              <div className="code-grid">
                {latestBatchCodes.slice(0, 24).map((code) => (
                  <code key={code}>{code}</code>
                ))}
              </div>
            </div>
          ) : null}
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Manual Reward</p>
              <h3>VIP or discretionary credit</h3>
            </div>
          </div>

          <form className="stack" onSubmit={handleCreateManualReward}>
            <label className="field">
              <span>Customer ID</span>
              <input
                inputMode="numeric"
                required
                value={manualRewardForm.recipient_customer_id}
                onChange={(event) => setManualRewardForm((current) => ({ ...current, recipient_customer_id: event.target.value }))}
              />
            </label>
            <div className="split-fields">
              <label className="field">
                <span>Amount (cents)</span>
                <input
                  inputMode="numeric"
                  required
                  value={manualRewardForm.amount_cents}
                  onChange={(event) => setManualRewardForm((current) => ({ ...current, amount_cents: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Reward Type</span>
                <input
                  required
                  value={manualRewardForm.reward_type}
                  onChange={(event) => setManualRewardForm((current) => ({ ...current, reward_type: event.target.value }))}
                />
              </label>
            </div>
            <label className="field">
              <span>Note</span>
              <textarea
                rows={3}
                value={manualRewardForm.notes}
                onChange={(event) => setManualRewardForm((current) => ({ ...current, notes: event.target.value }))}
              />
            </label>
            <button className="primary-button" disabled={creatingManualReward} type="submit">
              {creatingManualReward ? 'Saving…' : 'Issue Manual Reward'}
            </button>
          </form>
        </article>
      </div>

      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Referral Ledger</p>
            <h3>All created referrals</h3>
          </div>
        </div>

        {dashboard.referrals.length ? (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Referrer</th>
                  <th>Referred</th>
                  <th>Status</th>
                  <th>Reward</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.referrals.map((referral) => (
                  <tr key={referral.id}>
                    <td>{referral.invite_code || 'N/A'}</td>
                    <td>{referral.referrer_name || referral.batch_name || 'Campaign / bulk'}</td>
                    <td>{referral.referred_name || referral.referred_phone || 'Pending signup'}</td>
                    <td>
                      <StatusPill tone={referral.status}>{humanize(referral.status)}</StatusPill>
                    </td>
                    <td>
                      <StatusPill tone={referral.reward_status === 'issued' ? 'approved' : referral.reward_status}>
                        {humanize(referral.reward_status)}
                      </StatusPill>
                    </td>
                    <td>{formatDateTime(referral.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyPanel title="No referrals yet" copy="Customer-created referral codes and batch-generated campaign codes will appear here." />
        )}
      </article>

      <div className="two-column-layout">
        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Rewards</p>
              <h3>Issued referral credits</h3>
            </div>
          </div>

          {dashboard.rewards.length ? (
            <div className="table-shell compact-table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Issued</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.rewards.map((reward) => (
                    <tr key={reward.id}>
                      <td>{reward.recipient_name || reward.recipient_customer_id}</td>
                      <td>{humanize(reward.reward_type)}</td>
                      <td>{formatCurrency(reward.amount_cents)}</td>
                      <td>
                        <StatusPill tone={reward.status === 'available' ? 'approved' : reward.status}>
                          {humanize(reward.status)}
                        </StatusPill>
                      </td>
                      <td>{formatDateTime(reward.issued_at || reward.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyPanel title="No rewards issued" copy="Referrer credits and milestone bonuses will appear here after qualifying orders are completed and paid." />
          )}
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Batches</p>
              <h3>Generated campaign code groups</h3>
            </div>
          </div>

          {dashboard.batches.length ? (
            <div className="table-shell compact-table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th>Codes</th>
                    <th>Claimed</th>
                    <th>Created</th>
                    <th>Export</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.batches.map((batch) => (
                    <tr key={batch.id}>
                      <td>
                        <strong>{batch.name}</strong>
                        <div className="table-subcopy">{batch.campaign_tag || batch.source_tag || 'No tags'}</div>
                      </td>
                      <td>{batch.created_code_count || batch.code_count}</td>
                      <td>{batch.claimed_count || 0}</td>
                      <td>{formatDateTime(batch.created_at)}</td>
                      <td>
                        <button className="secondary-button compact-button" onClick={() => void handleDownloadBatchCsv(batch.id)} type="button">
                          CSV
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyPanel title="No batches yet" copy="Create a campaign or giveaway batch to generate referral-ready codes in bulk." />
          )}
        </article>
      </div>
    </section>
  );
}
