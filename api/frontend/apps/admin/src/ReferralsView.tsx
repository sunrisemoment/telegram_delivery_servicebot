import { useEffect, useState } from 'react';

import { extractErrorMessage } from '@shared/api';
import { formatDateTime, humanize } from '@shared/format';
import type { ReferralSummary } from '@shared/types';

import { adminRequest, isUnauthorizedError } from './admin-api';
import { EmptyPanel, StatusPill } from './admin-ui';

export default function ReferralsView({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [referrals, setReferrals] = useState<ReferralSummary[]>([]);
  const [error, setError] = useState('');

  async function loadReferrals() {
    try {
      const response = await adminRequest<ReferralSummary[]>(token, '/referrals');
      setReferrals(Array.isArray(response) ? response : []);
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
    void loadReferrals();
  }, [token]);

  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Referrals</p>
          <h3>Invite referral ledger</h3>
        </div>
        <button className="secondary-button" onClick={() => void loadReferrals()} type="button">
          Refresh
        </button>
      </div>

      {error ? <div className="inline-error">{error}</div> : null}

      {referrals.length ? (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Invite</th>
                <th>Referrer</th>
                <th>Referred</th>
                <th>Status</th>
                <th>Reward</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((referral) => (
                <tr key={referral.id}>
                  <td>{referral.invite_code || 'N/A'}</td>
                  <td>{referral.referrer_name || referral.referrer_customer_id || 'N/A'}</td>
                  <td>{referral.referred_name || referral.referred_customer_id || 'Pending'}</td>
                  <td>
                    <StatusPill tone={referral.status}>{humanize(referral.status)}</StatusPill>
                  </td>
                  <td>
                    <StatusPill tone={referral.reward_status === 'granted' ? 'approved' : 'pending'}>
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
        <EmptyPanel title="No referrals yet" copy="Referral invites created from the Mini App will appear here." />
      )}
    </article>
  );
}
