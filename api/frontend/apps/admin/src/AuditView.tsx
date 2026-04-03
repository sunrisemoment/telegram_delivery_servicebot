import { useEffect, useState } from 'react';

import { extractErrorMessage } from '@shared/api';
import { formatDateTime } from '@shared/format';
import type { AuditLogSummary } from '@shared/types';

import { adminRequest, isUnauthorizedError } from './admin-api';
import { EmptyPanel } from './admin-ui';

export default function AuditView({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [logs, setLogs] = useState<AuditLogSummary[]>([]);
  const [error, setError] = useState('');

  async function loadLogs() {
    try {
      const response = await adminRequest<AuditLogSummary[]>(token, '/audit-logs');
      setLogs(Array.isArray(response) ? response : []);
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
    void loadLogs();
  }, [token]);

  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Audit</p>
          <h3>Recent admin and system activity</h3>
        </div>
        <button className="secondary-button" onClick={() => void loadLogs()} type="button">
          Refresh
        </button>
      </div>

      {error ? <div className="inline-error">{error}</div> : null}

      {logs.length ? (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Actor</th>
                <th>Entity</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.action}</td>
                  <td>{entry.actor_username || entry.actor_type}</td>
                  <td>{[entry.entity_type, entry.entity_id].filter(Boolean).join(' • ') || 'N/A'}</td>
                  <td>{formatDateTime(entry.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyPanel title="No audit events" copy="Audit events for auth, dispatch, support, and settings will appear here." />
      )}
    </article>
  );
}
