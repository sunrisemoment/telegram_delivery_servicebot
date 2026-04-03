import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { extractErrorMessage } from '@shared/api';
import { formatCurrency, formatDateTime } from '@shared/format';
import type { BtcDiscountSettings, DeliveryConfigSettings } from '@shared/types';

import { adminRequest, isUnauthorizedError } from './admin-api';
import { DetailItem, LoadingPanel } from './admin-ui';

function toFormState(settings: DeliveryConfigSettings | null) {
  return {
    central_location_name: settings?.central_location_name ?? 'Atlantic Station',
    central_location_address: settings?.central_location_address ?? 'Atlantic Station, Atlanta, GA',
    central_location_lat: String(settings?.central_location_lat ?? 33.7901),
    central_location_lng: String(settings?.central_location_lng ?? -84.3972),
    atlantic_station_radius_miles: String(settings?.atlantic_station_radius_miles ?? 2),
    atlantic_station_fee_cents: String(settings?.atlantic_station_fee_cents ?? 500),
    inside_i285_radius_miles: String(settings?.inside_i285_radius_miles ?? 10),
    inside_i285_fee_cents: String(settings?.inside_i285_fee_cents ?? 1000),
    outside_i285_radius_miles: String(settings?.outside_i285_radius_miles ?? 18),
    outside_i285_fee_cents: String(settings?.outside_i285_fee_cents ?? 2000),
    max_delivery_radius_miles: String(settings?.max_delivery_radius_miles ?? 18),
    delivery_radius_enforced: settings?.delivery_radius_enforced ?? true,
    dispatch_offer_timeout_seconds: String(settings?.dispatch_offer_timeout_seconds ?? 90),
    dispatch_auto_escalate: settings?.dispatch_auto_escalate ?? true,
    admin_session_hours: String(settings?.admin_session_hours ?? 12),
  };
}

export default function SettingsView({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [settings, setSettings] = useState<BtcDiscountSettings | null>(null);
  const [deliveryConfig, setDeliveryConfig] = useState<DeliveryConfigSettings | null>(null);
  const [btcDiscount, setBtcDiscount] = useState('0');
  const [deliveryForm, setDeliveryForm] = useState(toFormState(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function loadSettings() {
    setLoading(true);
    try {
      const [discountResponse, deliveryResponse] = await Promise.all([
        adminRequest<BtcDiscountSettings>(token, '/settings/btc-discount'),
        adminRequest<DeliveryConfigSettings>(token, '/settings/delivery-config'),
      ]);
      setSettings(discountResponse);
      setDeliveryConfig(deliveryResponse);
      setBtcDiscount(String(discountResponse.btc_discount_percent ?? 0));
      setDeliveryForm(toFormState(deliveryResponse));
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

  async function saveDiscount(event: FormEvent<HTMLFormElement>) {
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

  async function saveDeliveryConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await adminRequest<DeliveryConfigSettings>(token, '/settings/delivery-config', {
        method: 'PUT',
        body: JSON.stringify({
          central_location_name: deliveryForm.central_location_name,
          central_location_address: deliveryForm.central_location_address,
          central_location_lat: Number(deliveryForm.central_location_lat),
          central_location_lng: Number(deliveryForm.central_location_lng),
          atlantic_station_radius_miles: Number(deliveryForm.atlantic_station_radius_miles),
          atlantic_station_fee_cents: Number(deliveryForm.atlantic_station_fee_cents),
          inside_i285_radius_miles: Number(deliveryForm.inside_i285_radius_miles),
          inside_i285_fee_cents: Number(deliveryForm.inside_i285_fee_cents),
          outside_i285_radius_miles: Number(deliveryForm.outside_i285_radius_miles),
          outside_i285_fee_cents: Number(deliveryForm.outside_i285_fee_cents),
          max_delivery_radius_miles: Number(deliveryForm.max_delivery_radius_miles),
          delivery_radius_enforced: deliveryForm.delivery_radius_enforced,
          dispatch_offer_timeout_seconds: Number(deliveryForm.dispatch_offer_timeout_seconds),
          dispatch_auto_escalate: deliveryForm.dispatch_auto_escalate,
          admin_session_hours: Number(deliveryForm.admin_session_hours),
        }),
      });
      setDeliveryConfig(response);
      setDeliveryForm(toFormState(response));
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

  if (loading && !settings && !deliveryConfig) {
    return <LoadingPanel label="Loading settings" />;
  }

  return (
    <section className="view-stack">
      <article className="panel emphasis-panel">
        <p className="eyebrow">Settings</p>
        <h3>Payment, delivery radius, and dispatch policy</h3>
        <dl className="detail-grid">
          <DetailItem label="BTC Discount" value={`${settings?.btc_discount_percent ?? 0}%`} />
          <DetailItem label="Dispatch Timeout" value={`${deliveryConfig?.dispatch_offer_timeout_seconds ?? 90}s`} />
          <DetailItem label="Atlantic Station Fee" value={formatCurrency(deliveryConfig?.atlantic_station_fee_cents ?? 0)} />
          <DetailItem label="Max Radius" value={`${deliveryConfig?.max_delivery_radius_miles ?? 0} mi`} />
          <DetailItem label="Radius Enforcement" value={deliveryConfig?.delivery_radius_enforced ? 'Enabled' : 'Disabled'} />
          <DetailItem label="Last Updated" value={formatDateTime(deliveryConfig?.updated_at || settings?.updated_at)} />
        </dl>
      </article>

      <section className="two-column-layout">
        <article className="panel detail-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Payment Settings</p>
              <h3>BTC payment discount</h3>
            </div>
          </div>

          <form className="stack" onSubmit={saveDiscount}>
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
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? 'Updating…' : 'Update Discount'}
            </button>
          </form>
        </article>

        <article className="panel detail-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Delivery Radius</p>
              <h3>Atlantic Station and I-285 rules</h3>
            </div>
          </div>

          <form className="stack" onSubmit={saveDeliveryConfig}>
            <label className="field">
              <span>Central location name</span>
              <input
                value={deliveryForm.central_location_name}
                onChange={(event) => setDeliveryForm((current) => ({ ...current, central_location_name: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Central location address</span>
              <input
                value={deliveryForm.central_location_address}
                onChange={(event) => setDeliveryForm((current) => ({ ...current, central_location_address: event.target.value }))}
              />
            </label>
            <div className="detail-grid">
              <label className="field">
                <span>Latitude</span>
                <input
                  type="number"
                  step="0.0001"
                  value={deliveryForm.central_location_lat}
                  onChange={(event) => setDeliveryForm((current) => ({ ...current, central_location_lat: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Longitude</span>
                <input
                  type="number"
                  step="0.0001"
                  value={deliveryForm.central_location_lng}
                  onChange={(event) => setDeliveryForm((current) => ({ ...current, central_location_lng: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Atlantic Station radius (mi)</span>
                <input
                  type="number"
                  step="0.1"
                  value={deliveryForm.atlantic_station_radius_miles}
                  onChange={(event) => setDeliveryForm((current) => ({ ...current, atlantic_station_radius_miles: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Atlantic Station fee (cents)</span>
                <input
                  type="number"
                  step="50"
                  value={deliveryForm.atlantic_station_fee_cents}
                  onChange={(event) => setDeliveryForm((current) => ({ ...current, atlantic_station_fee_cents: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Inside I-285 radius (mi)</span>
                <input
                  type="number"
                  step="0.1"
                  value={deliveryForm.inside_i285_radius_miles}
                  onChange={(event) => setDeliveryForm((current) => ({ ...current, inside_i285_radius_miles: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Inside I-285 fee (cents)</span>
                <input
                  type="number"
                  step="50"
                  value={deliveryForm.inside_i285_fee_cents}
                  onChange={(event) => setDeliveryForm((current) => ({ ...current, inside_i285_fee_cents: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Outside I-285 radius (mi)</span>
                <input
                  type="number"
                  step="0.1"
                  value={deliveryForm.outside_i285_radius_miles}
                  onChange={(event) => setDeliveryForm((current) => ({ ...current, outside_i285_radius_miles: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Outside I-285 fee (cents)</span>
                <input
                  type="number"
                  step="50"
                  value={deliveryForm.outside_i285_fee_cents}
                  onChange={(event) => setDeliveryForm((current) => ({ ...current, outside_i285_fee_cents: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Max delivery radius (mi)</span>
                <input
                  type="number"
                  step="0.1"
                  value={deliveryForm.max_delivery_radius_miles}
                  onChange={(event) => setDeliveryForm((current) => ({ ...current, max_delivery_radius_miles: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Offer timeout (seconds)</span>
                <input
                  type="number"
                  step="5"
                  value={deliveryForm.dispatch_offer_timeout_seconds}
                  onChange={(event) => setDeliveryForm((current) => ({ ...current, dispatch_offer_timeout_seconds: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Admin session hours</span>
                <input
                  type="number"
                  step="1"
                  value={deliveryForm.admin_session_hours}
                  onChange={(event) => setDeliveryForm((current) => ({ ...current, admin_session_hours: event.target.value }))}
                />
              </label>
            </div>

            <label className="checkbox-row">
              <input
                checked={deliveryForm.delivery_radius_enforced}
                onChange={(event) => setDeliveryForm((current) => ({ ...current, delivery_radius_enforced: event.target.checked }))}
                type="checkbox"
              />
              <span>Enforce delivery radius gate</span>
            </label>
            <label className="checkbox-row">
              <input
                checked={deliveryForm.dispatch_auto_escalate}
                onChange={(event) => setDeliveryForm((current) => ({ ...current, dispatch_auto_escalate: event.target.checked }))}
                type="checkbox"
              />
              <span>Auto-escalate expired dispatch offers</span>
            </label>

            {error ? <div className="inline-error">{error}</div> : null}
            <div className="inline-actions">
              <button className="primary-button" disabled={saving} type="submit">
                {saving ? 'Saving…' : 'Save Delivery Config'}
              </button>
              <button className="secondary-button" onClick={() => void loadSettings()} type="button">
                Reset
              </button>
            </div>
          </form>
        </article>
      </section>
    </section>
  );
}
