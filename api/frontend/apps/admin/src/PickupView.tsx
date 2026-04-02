import { useDeferredValue, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { extractErrorMessage } from '@shared/api';
import type { PickupAddressSummary } from '@shared/types';

import { adminRequest, isUnauthorizedError } from './admin-api';
import { EmptyPanel, StatusPill } from './admin-ui';

function emptyPickupForm() {
  return {
    name: '',
    address: '',
    instructions: '',
    active: true,
  };
}

export default function PickupView({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [locations, setLocations] = useState<PickupAddressSummary[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyPickupForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const deferredSearch = useDeferredValue(search);

  async function loadLocations() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') {
        params.set('active_only', String(statusFilter === 'active'));
      }
      if (deferredSearch.trim()) {
        params.set('search', deferredSearch.trim());
      }

      const response = await adminRequest<PickupAddressSummary[]>(
        token,
        `/pickup-addresses${params.size ? `?${params.toString()}` : ''}`,
      );
      setLocations(Array.isArray(response) ? response : []);
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
    void loadLocations();
  }, [token, statusFilter, deferredSearch]);

  function resetForm() {
    setSelectedLocationId(null);
    setForm(emptyPickupForm());
  }

  function selectLocation(location: PickupAddressSummary) {
    setSelectedLocationId(location.id);
    setForm({
      name: location.name,
      address: location.address,
      instructions: location.instructions || '',
      active: location.active,
    });
  }

  async function saveLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.name.trim() || !form.address.trim()) {
      setError('Name and address are required.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        address: form.address.trim(),
        instructions: form.instructions.trim() || null,
        active: form.active,
      };

      if (selectedLocationId) {
        await adminRequest(token, `/pickup-addresses/${selectedLocationId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await adminRequest(token, '/pickup-addresses', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      resetForm();
      await loadLocations();
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

  async function setLocationActive(location: PickupAddressSummary, nextActive: boolean) {
    const confirmMessage = nextActive
      ? `Restore pickup location "${location.name}"?`
      : `Deactivate pickup location "${location.name}"?`;
    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      if (nextActive) {
        await adminRequest(token, `/pickup-addresses/${location.id}`, {
          method: 'PUT',
          body: JSON.stringify({ active: true }),
        });
      } else {
        await adminRequest(token, `/pickup-addresses/${location.id}`, {
          method: 'DELETE',
        });
      }

      if (selectedLocationId === location.id && !nextActive) {
        resetForm();
      }
      await loadLocations();
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    }
  }

  return (
    <section className="two-column-layout">
      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Pickup</p>
            <h3>Pickup location ledger</h3>
          </div>
          <div className="inline-actions">
            <button className="secondary-button" onClick={() => void loadLocations()} type="button">
              Refresh
            </button>
            <button className="secondary-button" onClick={resetForm} type="button">
              New Location
            </button>
          </div>
        </div>

        <div className="toolbar">
          <input
            className="search-input"
            placeholder="Search locations"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        </div>

        {error ? <div className="inline-error">{error}</div> : null}

        {loading ? (
          <div className="empty-panel compact-empty">Loading pickup locations…</div>
        ) : locations.length ? (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Address</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((location) => (
                  <tr
                    key={location.id}
                    className={selectedLocationId === location.id ? 'selected-row' : ''}
                    onClick={() => selectLocation(location)}
                  >
                    <td>{location.name}</td>
                    <td>{location.address}</td>
                    <td>
                      <StatusPill tone={location.active ? 'approved' : 'cancelled'}>
                        {location.active ? 'Active' : 'Inactive'}
                      </StatusPill>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="secondary-button compact-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            selectLocation(location);
                          }}
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="ghost-button compact-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void setLocationActive(location, !location.active);
                          }}
                          type="button"
                        >
                          {location.active ? 'Deactivate' : 'Restore'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyPanel title="No pickup locations" copy="Create a pickup location so drivers and pickup customers have a destination." />
        )}
      </article>

      <article className="panel detail-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">{selectedLocationId ? 'Edit Location' : 'Create Location'}</p>
            <h3>{selectedLocationId ? 'Update pickup point' : 'Add a new pickup point'}</h3>
          </div>
          {selectedLocationId ? (
            <StatusPill tone={form.active ? 'approved' : 'cancelled'}>
              {form.active ? 'Active' : 'Inactive'}
            </StatusPill>
          ) : null}
        </div>

        <form className="stack" onSubmit={saveLocation}>
          <label className="field">
            <span>Location name</span>
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Main Store"
            />
          </label>
          <label className="field">
            <span>Address</span>
            <textarea
              rows={5}
              value={form.address}
              onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
              placeholder="123 Main St, Atlanta, GA"
            />
          </label>
          <label className="field">
            <span>Instructions</span>
            <textarea
              rows={4}
              value={form.instructions}
              onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))}
              placeholder="Parking, door, or desk instructions"
            />
          </label>
          <label className="checkbox-row">
            <input
              checked={form.active}
              onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
              type="checkbox"
            />
            <span>Active for assignment and pickup checkout</span>
          </label>
          <div className="inline-actions">
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? 'Saving…' : selectedLocationId ? 'Update Location' : 'Create Location'}
            </button>
            <button className="secondary-button" onClick={resetForm} type="button">
              Reset
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}
