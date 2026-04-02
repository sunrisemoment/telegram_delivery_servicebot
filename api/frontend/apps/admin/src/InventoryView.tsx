import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { extractErrorMessage } from '@shared/api';
import { formatDateTime } from '@shared/format';
import type {
  AdminMenuItem,
  DriverInventorySummary,
  DriverSummary,
  InventoryReservationSummary,
} from '@shared/types';

import { adminRequest, isUnauthorizedError } from './admin-api';
import { DetailItem, EmptyPanel, StatCard, StatusPill } from './admin-ui';

interface InventoryActionForm {
  menu_item_id: string;
  quantity: string;
  reason_note: string;
}

interface StockAdjustForm {
  menu_item_id: string;
  new_quantity: string;
  reason_note: string;
}

interface TransferForm extends InventoryActionForm {
  to_driver_id: string;
}

function buildDefaultInventoryForm(menuItems: AdminMenuItem[], reasonNote: string): InventoryActionForm {
  return {
    menu_item_id: menuItems[0] ? String(menuItems[0].id) : '',
    quantity: '1',
    reason_note: reasonNote,
  };
}

function buildDefaultAdjustForm(menuItems: AdminMenuItem[], reasonNote: string): StockAdjustForm {
  return {
    menu_item_id: menuItems[0] ? String(menuItems[0].id) : '',
    new_quantity: '0',
    reason_note: reasonNote,
  };
}

export default function InventoryView({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [drivers, setDrivers] = useState<DriverSummary[]>([]);
  const [menuItems, setMenuItems] = useState<AdminMenuItem[]>([]);
  const [reservations, setReservations] = useState<InventoryReservationSummary[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [driverStock, setDriverStock] = useState<DriverInventorySummary[]>([]);
  const [loadoutForm, setLoadoutForm] = useState<InventoryActionForm>({
    menu_item_id: '',
    quantity: '1',
    reason_note: 'Admin loadout',
  });
  const [adjustForm, setAdjustForm] = useState<StockAdjustForm>({
    menu_item_id: '',
    new_quantity: '0',
    reason_note: 'Admin adjustment',
  });
  const [transferForm, setTransferForm] = useState<TransferForm>({
    menu_item_id: '',
    quantity: '1',
    reason_note: 'Admin transfer',
    to_driver_id: '',
  });
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');

  async function loadOverview() {
    setLoading(true);
    try {
      const [driversResponse, menuResponse, reservationsResponse] = await Promise.all([
        adminRequest<DriverSummary[]>(token, '/drivers?limit=200'),
        adminRequest<AdminMenuItem[]>(token, '/menu/items?active_only=false'),
        adminRequest<InventoryReservationSummary[]>(token, '/inventory/reservations'),
      ]);

      const nextDrivers = Array.isArray(driversResponse) ? driversResponse : [];
      const nextMenuItems = Array.isArray(menuResponse) ? menuResponse : [];
      setDrivers(nextDrivers);
      setMenuItems(nextMenuItems);
      setReservations(Array.isArray(reservationsResponse) ? reservationsResponse : []);
      setLoadoutForm((current) => ({
        ...buildDefaultInventoryForm(nextMenuItems, current.reason_note || 'Admin loadout'),
        menu_item_id: current.menu_item_id || (nextMenuItems[0] ? String(nextMenuItems[0].id) : ''),
        quantity: current.quantity || '1',
      }));
      setAdjustForm((current) => ({
        ...buildDefaultAdjustForm(nextMenuItems, current.reason_note || 'Admin adjustment'),
        menu_item_id: current.menu_item_id || (nextMenuItems[0] ? String(nextMenuItems[0].id) : ''),
        new_quantity: current.new_quantity || '0',
      }));
      setTransferForm((current) => ({
        ...buildDefaultInventoryForm(nextMenuItems, current.reason_note || 'Admin transfer'),
        to_driver_id: current.to_driver_id || '',
        menu_item_id: current.menu_item_id || (nextMenuItems[0] ? String(nextMenuItems[0].id) : ''),
        quantity: current.quantity || '1',
      }));

      if (!selectedDriverId && nextDrivers[0]) {
        setSelectedDriverId(String(nextDrivers[0].id));
      }
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

  async function loadDriverStock(driverId: string) {
    if (!driverId) {
      setDriverStock([]);
      return;
    }

    try {
      const response = await adminRequest<DriverInventorySummary[]>(token, `/inventory/drivers/${driverId}/stock`);
      setDriverStock(Array.isArray(response) ? response : []);
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    }
  }

  useEffect(() => {
    void loadOverview();
  }, [token]);

  useEffect(() => {
    if (selectedDriverId) {
      void loadDriverStock(selectedDriverId);
    }
  }, [selectedDriverId, token]);

  const selectedDriver = drivers.find((driver) => String(driver.id) === selectedDriverId) ?? null;

  async function releaseReservation(reservationId: number) {
    if (!window.confirm('Release this reservation?')) {
      return;
    }

    setBusyAction(`release-${reservationId}`);
    try {
      await adminRequest(token, `/inventory/reservations/${reservationId}/release`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await Promise.all([loadOverview(), selectedDriverId ? loadDriverStock(selectedDriverId) : Promise.resolve()]);
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

  async function cleanupExpiredReservations() {
    if (!window.confirm('Clean up expired reservations now?')) {
      return;
    }

    setBusyAction('cleanup');
    try {
      await adminRequest(token, '/inventory/cleanup-expired', {
        method: 'POST',
      });
      await Promise.all([loadOverview(), selectedDriverId ? loadDriverStock(selectedDriverId) : Promise.resolve()]);
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

  async function submitLoadout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDriverId) {
      setError('Select a driver first.');
      return;
    }

    setBusyAction('loadout');
    try {
      await adminRequest(token, `/inventory/drivers/${selectedDriverId}/loadout`, {
        method: 'POST',
        body: JSON.stringify({
          menu_item_id: Number(loadoutForm.menu_item_id),
          quantity: Number(loadoutForm.quantity),
          reason_note: loadoutForm.reason_note.trim() || 'Admin loadout',
        }),
      });
      await Promise.all([loadOverview(), loadDriverStock(selectedDriverId)]);
      setLoadoutForm((current) => ({ ...current, quantity: '1' }));
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

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDriverId) {
      setError('Select a driver first.');
      return;
    }

    setBusyAction('adjust');
    try {
      await adminRequest(token, `/inventory/drivers/${selectedDriverId}/adjust`, {
        method: 'POST',
        body: JSON.stringify({
          menu_item_id: Number(adjustForm.menu_item_id),
          new_quantity: Number(adjustForm.new_quantity),
          reason_note: adjustForm.reason_note.trim() || 'Admin adjustment',
        }),
      });
      await Promise.all([loadOverview(), loadDriverStock(selectedDriverId)]);
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

  async function handleTransferSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDriverId) {
      setError('Select the source driver first.');
      return;
    }

    const toDriverId = Number(transferForm.to_driver_id);
    if (!toDriverId) {
      setError('Choose the destination driver.');
      return;
    }

    setBusyAction('transfer');
    try {
      await adminRequest(token, '/inventory/transfer', {
        method: 'POST',
        body: JSON.stringify({
          from_driver_id: Number(selectedDriverId),
          to_driver_id: toDriverId,
          menu_item_id: Number(transferForm.menu_item_id),
          quantity: Number(transferForm.quantity),
          reason_note: transferForm.reason_note.trim() || 'Admin transfer',
        }),
      });
      await Promise.all([loadOverview(), loadDriverStock(selectedDriverId)]);
      setTransferForm((current) => ({ ...current, quantity: '1', to_driver_id: '' }));
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

  return (
    <section className="stack">
      <section className="page-grid">
        <StatCard label="Active Reservations" value={`${reservations.length}`} tone={reservations.length ? 'warning' : 'default'} />
        <StatCard label="Tracked Drivers" value={`${drivers.length}`} />
        <StatCard label="Catalog Items" value={`${menuItems.length}`} tone="olive" />
      </section>

      <section className="two-column-layout">
        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Reservations</p>
              <h3>Active holds on stock</h3>
            </div>
            <div className="inline-actions">
              <button className="secondary-button" onClick={() => void loadOverview()} type="button">
                Refresh
              </button>
              <button className="ghost-button" disabled={busyAction === 'cleanup'} onClick={() => void cleanupExpiredReservations()} type="button">
                {busyAction === 'cleanup' ? 'Cleaning…' : 'Cleanup Expired'}
              </button>
            </div>
          </div>

          {error ? <div className="inline-error">{error}</div> : null}

          {loading ? (
            <div className="empty-panel compact-empty">Loading reservations…</div>
          ) : reservations.length ? (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Created</th>
                    <th>Expires</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {reservations.map((reservation) => (
                    <tr key={reservation.id}>
                      <td>{reservation.order_number}</td>
                      <td>{reservation.menu_item_name}</td>
                      <td>{reservation.reserved_qty}</td>
                      <td>{formatDateTime(reservation.created_at)}</td>
                      <td>{formatDateTime(reservation.expires_at)}</td>
                      <td>
                        <button
                          className="ghost-button compact-button"
                          disabled={busyAction === `release-${reservation.id}`}
                          onClick={() => void releaseReservation(reservation.id)}
                          type="button"
                        >
                          {busyAction === `release-${reservation.id}` ? 'Releasing…' : 'Release'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyPanel title="No reservations" copy="Inventory reservations will appear here while orders are waiting to be fulfilled." />
          )}
        </article>

        <article className="panel detail-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Driver Stock</p>
              <h3>Loadout, adjust, and transfer</h3>
            </div>
          </div>

          <label className="field">
            <span>Driver</span>
            <select value={selectedDriverId} onChange={(event) => setSelectedDriverId(event.target.value)}>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name} • {driver.active_orders} active
                </option>
              ))}
            </select>
          </label>

          {selectedDriver ? (
            <dl className="detail-grid">
              <DetailItem label="Status" value={<StatusPill tone={selectedDriver.is_online ? 'approved' : 'cancelled'}>{selectedDriver.is_online ? 'Online' : 'Offline'}</StatusPill>} />
              <DetailItem label="Pickup" value={selectedDriver.pickup_address?.name || 'Not assigned'} />
              <DetailItem label="Capacity" value={`${selectedDriver.max_concurrent_orders}`} />
              <DetailItem label="Distance" value={`${selectedDriver.max_delivery_distance_miles} mi`} />
            </dl>
          ) : null}

          {driverStock.length ? (
            <div className="table-shell compact-table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {driverStock.map((stock) => (
                    <tr key={`${stock.menu_item_id}-${stock.updated_at ?? 'current'}`}>
                      <td>{stock.menu_item_name}</td>
                      <td>{stock.on_hand_qty}</td>
                      <td>{formatDateTime(stock.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyPanel title="No driver stock" copy="This driver has no allocated stock yet." />
          )}

          <div className="module-grid">
            <form className="summary-card stack" onSubmit={submitLoadout}>
              <div>
                <p className="eyebrow">Loadout</p>
                <h4>Push stock to driver</h4>
              </div>
              <label className="field">
                <span>Menu item</span>
                <select
                  value={loadoutForm.menu_item_id}
                  onChange={(event) => setLoadoutForm((current) => ({ ...current, menu_item_id: event.target.value }))}
                >
                  {menuItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Quantity</span>
                <input
                  min="1"
                  step="1"
                  type="number"
                  value={loadoutForm.quantity}
                  onChange={(event) => setLoadoutForm((current) => ({ ...current, quantity: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Note</span>
                <input
                  value={loadoutForm.reason_note}
                  onChange={(event) => setLoadoutForm((current) => ({ ...current, reason_note: event.target.value }))}
                />
              </label>
              <button className="primary-button" disabled={busyAction === 'loadout' || !selectedDriverId} type="submit">
                {busyAction === 'loadout' ? 'Loading…' : 'Load Out'}
              </button>
            </form>

            <form className="summary-card stack" onSubmit={submitAdjustment}>
              <div>
                <p className="eyebrow">Adjust</p>
                <h4>Set final quantity</h4>
              </div>
              <label className="field">
                <span>Menu item</span>
                <select
                  value={adjustForm.menu_item_id}
                  onChange={(event) => setAdjustForm((current) => ({ ...current, menu_item_id: event.target.value }))}
                >
                  {menuItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>New quantity</span>
                <input
                  min="0"
                  step="1"
                  type="number"
                  value={adjustForm.new_quantity}
                  onChange={(event) => setAdjustForm((current) => ({ ...current, new_quantity: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Note</span>
                <input
                  value={adjustForm.reason_note}
                  onChange={(event) => setAdjustForm((current) => ({ ...current, reason_note: event.target.value }))}
                />
              </label>
              <button className="primary-button" disabled={busyAction === 'adjust' || !selectedDriverId} type="submit">
                {busyAction === 'adjust' ? 'Adjusting…' : 'Adjust Stock'}
              </button>
            </form>

            <form className="summary-card stack" onSubmit={handleTransferSubmit}>
              <div>
                <p className="eyebrow">Transfer</p>
                <h4>Move stock between drivers</h4>
              </div>
              <label className="field">
                <span>Destination driver</span>
                <select
                  value={transferForm.to_driver_id}
                  onChange={(event) => setTransferForm((current) => ({ ...current, to_driver_id: event.target.value }))}
                >
                  <option value="">Select driver</option>
                  {drivers
                    .filter((driver) => String(driver.id) !== selectedDriverId)
                    .map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {driver.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span>Menu item</span>
                <select
                  value={transferForm.menu_item_id}
                  onChange={(event) => setTransferForm((current) => ({ ...current, menu_item_id: event.target.value }))}
                >
                  {menuItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Quantity</span>
                <input
                  min="1"
                  step="1"
                  type="number"
                  value={transferForm.quantity}
                  onChange={(event) => setTransferForm((current) => ({ ...current, quantity: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Note</span>
                <input
                  value={transferForm.reason_note}
                  onChange={(event) => setTransferForm((current) => ({ ...current, reason_note: event.target.value }))}
                />
              </label>
              <button className="primary-button" disabled={busyAction === 'transfer' || !selectedDriverId} type="submit">
                {busyAction === 'transfer' ? 'Transferring…' : 'Transfer Stock'}
              </button>
            </form>
          </div>
        </article>
      </section>
    </section>
  );
}
