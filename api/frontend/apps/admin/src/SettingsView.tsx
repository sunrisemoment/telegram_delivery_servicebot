import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { extractErrorMessage } from '@shared/api';
import { formatDateTime } from '@shared/format';
import type { BtcDiscountSettings } from '@shared/types';

import { adminRequest, isUnauthorizedError } from './admin-api';
import { DetailItem, LoadingPanel } from './admin-ui';

export default function SettingsView({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [settings, setSettings] = useState<BtcDiscountSettings | null>(null);
  const [btcDiscount, setBtcDiscount] = useState('0');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function loadSettings() {
    setLoading(true);
    try {
      const response = await adminRequest<BtcDiscountSettings>(token, '/settings/btc-discount');
      setSettings(response);
      setBtcDiscount(String(response.btc_discount_percent ?? 0));
      setError('');
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, [token]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedDiscount = Number.parseInt(btcDiscount, 10);
    if (Number.isNaN(parsedDiscount) || parsedDiscount < 0 || parsedDiscount > 100) {
      setError('BTC discount must be a whole number between 0 and 100.');
      return;
    }

    setSaving(true);
    try {
      const response = await adminRequest<BtcDiscountSettings>(token, '/settings/btc-discount', {
        method: 'PUT',
        body: JSON.stringify({ btc_discount_percent: parsedDiscount }),
      });
      setSettings(response);
      setBtcDiscount(String(response.btc_discount_percent));
      setError('');
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

  if (loading && !settings) {
    return <LoadingPanel label="Loading settings" />;
  }

  return (
    <section className="two-column-layout">
      <article className="panel emphasis-panel">
        <p className="eyebrow">Settings</p>
        <h3>Global payment controls</h3>
        <p>
          The BTC discount applies across the Telegram bot and Mini App checkout. Keep it at `0` to disable the incentive or raise it when you want BTC orders promoted.
        </p>

        <dl className="detail-grid">
          <DetailItem label="Current Discount" value={`${settings?.btc_discount_percent ?? 0}%`} />
          <DetailItem label="Last Updated" value={formatDateTime(settings?.updated_at)} />
        </dl>
      </article>

      <article className="panel detail-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Payment Settings</p>
            <h3>BTC payment discount</h3>
          </div>
        </div>

        <form className="stack" onSubmit={saveSettings}>
          <label className="field">
            <span>Discount percent</span>
            <input
              max="100"
              min="0"
              step="1"
              type="number"
              value={btcDiscount}
              onChange={(event) => setBtcDiscount(event.target.value)}
            />
          </label>
          {error ? <div className="inline-error">{error}</div> : null}
          <div className="inline-actions">
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? 'Updating…' : 'Update Discount'}
            </button>
            <button className="secondary-button" onClick={() => void loadSettings()} type="button">
              Reset
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}
