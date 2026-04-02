import { startTransition, useDeferredValue, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { ApiError, buildBasicAuthToken, extractErrorMessage } from '@shared/api';
import { formatCurrency, formatDate, formatDateTime, humanize } from '@shared/format';
import type {
  CustomerSummary,
  DashboardStats,
  DriverSummary,
  InviteSummary,
  OrderDetail,
  OrderSummary,
} from '@shared/types';

import { adminRequest, isMobileViewport } from './admin-api';
import ContactView from './ContactView';
import InventoryView from './InventoryView';
import MenuManagementView from './MenuManagementView';
import PaymentsView from './PaymentsView';
import PickupView from './PickupView';
import SettingsView from './SettingsView';
import { DetailItem, EmptyPanel, ErrorPanel, LoadingPanel, StatCard, StatusPill, ViewErrorBoundary } from './admin-ui';

const ADMIN_AUTH_STORAGE_KEY = 'delivery_bot.admin_auth';

type ViewKey =
  | 'dashboard'
  | 'orders'
  | 'drivers'
  | 'customers'
  | 'invites'
  | 'pickup'
  | 'menu'
  | 'inventory'
  | 'payments'
  | 'settings'
  | 'contact';

const NAV_ITEMS: Array<{ key: ViewKey; label: string; description: string }> = [
  { key: 'dashboard', label: 'Dashboard', description: 'Operational summary' },
  { key: 'orders', label: 'Orders', description: 'Review, approve, assign' },
  { key: 'drivers', label: 'Drivers', description: 'Availability and limits' },
  { key: 'customers', label: 'Customers', description: 'Accounts and aliases' },
  { key: 'invites', label: 'Invites', description: 'Private onboarding' },
  { key: 'pickup', label: 'Pickup', description: 'Locations and routing' },
  { key: 'menu', label: 'Menu', description: 'Catalog, stock, and photos' },
  { key: 'inventory', label: 'Inventory', description: 'Reservations and driver stock' },
  { key: 'payments', label: 'Payments', description: 'Approvals and BTC review' },
  { key: 'settings', label: 'Settings', description: 'Global payment controls' },
  { key: 'contact', label: 'Contact', description: 'Welcome and support' },
];

function getStoredAdminToken(): string {
  return localStorage.getItem(ADMIN_AUTH_STORAGE_KEY) || '';
}

function storeAdminToken(token: string): void {
  localStorage.setItem(ADMIN_AUTH_STORAGE_KEY, token);
}

function clearAdminToken(): void {
  localStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
}

function formatPickupEtaSummary(
  pickupEta: OrderDetail['latest_pickup_eta'] | undefined | null,
): string {
  if (!pickupEta) {
    return 'Not shared';
  }
  return `${pickupEta.eta_minutes} min • ${formatDateTime(pickupEta.created_at)}`;
}

function App() {
  const [token, setToken] = useState<string>(getStoredAdminToken);
  const [activeView, setActiveView] = useState<ViewKey>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loginError, setLoginError] = useState<string>('');
  const [loginPending, setLoginPending] = useState(false);

  async function handleLogin(username: string, password: string) {
    const nextToken = buildBasicAuthToken(username, password);
    setLoginPending(true);
    setLoginError('');

    try {
      await adminRequest<DashboardStats>(nextToken, '/dashboard/stats');
      storeAdminToken(nextToken);
      setToken(nextToken);
    } catch (error) {
      setLoginError(extractErrorMessage(error));
    } finally {
      setLoginPending(false);
    }
  }

  function handleUnauthorized() {
    clearAdminToken();
    setSidebarOpen(false);
    setToken('');
  }

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidebarOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  useEffect(() => {
    if (sidebarOpen && isMobileViewport()) {
      document.body.classList.add('sidebar-locked');
    } else {
      document.body.classList.remove('sidebar-locked');
    }

    return () => {
      document.body.classList.remove('sidebar-locked');
    };
  }, [sidebarOpen]);

  function handleViewChange(nextView: ViewKey) {
    startTransition(() => {
      setActiveView(nextView);
    });

    if (isMobileViewport()) {
      setSidebarOpen(false);
    }
  }

  if (!token) {
    return <LoginScreen pending={loginPending} error={loginError} onLogin={handleLogin} />;
  }

  return (
    <div className="admin-shell">
      <button
        aria-label="Close navigation"
        className={`sidebar-overlay ${sidebarOpen ? 'visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
        type="button"
      />

      <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <p className="eyebrow">React Admin</p>
          <h1>Delivery Ops</h1>
          <p>Private dispatch console for payments, invites, and customer operations.</p>
        </div>

        <nav className="nav-list">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${activeView === item.key ? 'active' : ''}`}
              onClick={() => handleViewChange(item.key)}
            >
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </nav>

        <button
          className="secondary-button logout-button"
          onClick={() => {
            clearAdminToken();
            setSidebarOpen(false);
            setToken('');
          }}
        >
          Logout
        </button>
      </aside>

      <main className="admin-main">
        <header className="page-header">
          <div className="page-header-main">
            <button className="menu-toggle-button" onClick={() => setSidebarOpen(true)} type="button">
              Menu
            </button>
            <div>
              <p className="eyebrow">Operations</p>
              <h2>{NAV_ITEMS.find((item) => item.key === activeView)?.label}</h2>
            </div>
          </div>
          <div className="page-header-actions">
            <span className="page-chip">Basic Auth Session</span>
          </div>
        </header>

        {activeView === 'dashboard' && <DashboardView token={token} onUnauthorized={handleUnauthorized} />}
        {activeView === 'orders' && <OrdersView token={token} onUnauthorized={handleUnauthorized} />}
        {activeView === 'drivers' && <DriversView token={token} onUnauthorized={handleUnauthorized} />}
        {activeView === 'customers' && <CustomersView token={token} onUnauthorized={handleUnauthorized} />}
        {activeView === 'invites' && <InvitesView token={token} onUnauthorized={handleUnauthorized} />}
        {activeView === 'pickup' && <PickupView token={token} onUnauthorized={handleUnauthorized} />}
        {activeView === 'menu' && <MenuManagementView token={token} onUnauthorized={handleUnauthorized} />}
        {activeView === 'inventory' && <InventoryView token={token} onUnauthorized={handleUnauthorized} />}
        {activeView === 'payments' && <PaymentsView token={token} onUnauthorized={handleUnauthorized} />}
        {activeView === 'settings' && <SettingsView token={token} onUnauthorized={handleUnauthorized} />}
        {activeView === 'contact' && (
          <ViewErrorBoundary key="contact-view" title="Contact settings failed to load.">
            <ContactView token={token} onUnauthorized={handleUnauthorized} />
          </ViewErrorBoundary>
        )}
      </main>
    </div>
  );
}

function LoginScreen({
  pending,
  error,
  onLogin,
}: {
  pending: boolean;
  error: string;
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onLogin(username, password);
  }

  return (
    <div className="login-shell">
      <section className="login-card">
        <p className="eyebrow">Delivery Bot</p>
        <h1>React Admin Console</h1>
        <p className="login-copy">
          Sign in with the existing admin basic-auth credentials to manage dispatch, payments, invites, and customer operations.
        </p>

        <form className="stack" onSubmit={submit}>
          <label className="field">
            <span>Username</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error ? <div className="inline-error">{error}</div> : null}
          <button className="primary-button" disabled={pending} type="submit">
            {pending ? 'Checking…' : 'Enter Admin'}
          </button>
        </form>
      </section>
    </div>
  );
}

function DashboardView({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    adminRequest<DashboardStats>(token, '/dashboard/stats')
      .then((response) => {
        if (!cancelled) {
          setStats(response);
        }
      })
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) {
          onUnauthorized();
          return;
        }
        if (!cancelled) {
          setError(extractErrorMessage(cause));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token, onUnauthorized]);

  if (error) {
    return <ErrorPanel message={error} />;
  }

  if (!stats) {
    return <LoadingPanel label="Loading dashboard" />;
  }

  return (
    <section className="page-grid">
      <StatCard label="Total Orders" value={`${stats.total_orders}`} />
      <StatCard label="Revenue" value={`$${stats.total_revenue.toFixed(2)}`} tone="olive" />
      <StatCard label="Active Customers" value={`${stats.active_customers}`} />
      <StatCard label="Pending Orders" value={`${stats.pending_orders}`} tone="warning" />
      <StatCard label="Completed Orders" value={`${stats.completed_orders}`} tone="olive" />
      <article className="panel emphasis-panel">
        <p className="eyebrow">Operations</p>
        <h3>React covers the full admin surface.</h3>
        <p>
          Orders, drivers, customers, invites, pickup, menu, inventory, payments, settings, and contact are all wired against the existing FastAPI routes.
        </p>
      </article>
    </section>
  );
}

function OrdersView({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [drivers, setDrivers] = useState<DriverSummary[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [error, setError] = useState('');
  const deferredSearch = useDeferredValue(search);

  async function loadOrders() {
    try {
      setError('');
      const response = await adminRequest<OrderSummary[]>(token, '/orders?limit=100');
      setOrders(Array.isArray(response) ? response : []);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    }
  }

  useEffect(() => {
    void loadOrders();
  }, [token]);

  async function loadOrderDetails(orderNumber: string) {
    try {
      setError('');
      const detail = await adminRequest<OrderDetail>(token, `/orders/${orderNumber}`);
      setSelectedOrder(detail);
      setSelectedDriverId('');

      if (detail.payment_confirmed) {
        const availableDrivers = await adminRequest<DriverSummary[]>(token, `/orders/${orderNumber}/available-drivers`);
        setDrivers(availableDrivers);
      } else {
        setDrivers([]);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    }
  }

  async function markPaid(orderNumber: string) {
    try {
      await adminRequest(token, `/payments/mark-paid/${orderNumber}`, {
        method: 'POST',
        body: JSON.stringify({ notes: 'Confirmed from React admin' }),
      });
      await loadOrders();
      await loadOrderDetails(orderNumber);
    } catch (cause) {
      setError(extractErrorMessage(cause));
    }
  }

  async function assignDriver() {
    if (!selectedOrder || !selectedDriverId) {
      return;
    }

    try {
      await adminRequest(token, `/orders/${selectedOrder.order_number}/assign-driver`, {
        method: 'POST',
        body: JSON.stringify({ driver_id: Number(selectedDriverId) }),
      });
      await loadOrders();
      await loadOrderDetails(selectedOrder.order_number);
    } catch (cause) {
      setError(extractErrorMessage(cause));
    }
  }

  const filteredOrders = orders.filter((order) => {
    const searchTarget = `${order.order_number} ${order.customer_telegram_id ?? ''}`.toLowerCase();
    const matchesSearch = searchTarget.includes(deferredSearch.trim().toLowerCase());
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <section className="two-column-layout">
      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Orders</p>
            <h3>Payment-gated dispatch</h3>
          </div>
          <button className="secondary-button" onClick={() => void loadOrders()}>
            Refresh
          </button>
        </div>

        <div className="toolbar">
          <input
            className="search-input"
            placeholder="Search by order or Telegram ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="placed">Placed</option>
            <option value="assigned">Assigned</option>
            <option value="out_for_delivery">Out for delivery</option>
            <option value="delivered">Delivered</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {error ? <div className="inline-error">{error}</div> : null}

        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Total</th>
                <th>Type</th>
                <th>Status</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr key={order.order_number} onClick={() => void loadOrderDetails(order.order_number)}>
                  <td>{order.order_number}</td>
                  <td>{order.customer_telegram_id ?? 'N/A'}</td>
                  <td>{formatCurrency(order.total_cents)}</td>
                  <td>{humanize(order.delivery_or_pickup)}</td>
                  <td>
                    <StatusPill tone={order.status}>{humanize(order.status)}</StatusPill>
                  </td>
                  <td>
                    <StatusPill tone={order.payment_confirmed ? 'approved' : 'pending'}>
                      {order.payment_confirmed ? 'Approved' : 'Awaiting Approval'}
                    </StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel detail-panel">
        {selectedOrder ? (
          <>
            <div className="panel-header">
              <div>
                <p className="eyebrow">Order Detail</p>
                <h3>{selectedOrder.order_number}</h3>
              </div>
              <StatusPill tone={selectedOrder.status}>{humanize(selectedOrder.status)}</StatusPill>
            </div>

            <dl className="detail-grid">
              <DetailItem
                label="Customer"
                value={
                  selectedOrder.customer?.display_name
                    ? `${selectedOrder.customer.display_name} • ${selectedOrder.customer.telegram_id ?? 'N/A'}`
                    : `${selectedOrder.customer?.telegram_id ?? 'N/A'}`
                }
              />
              <DetailItem label="Payment" value={humanize(selectedOrder.payment_type)} />
              <DetailItem label="Approved" value={selectedOrder.payment_confirmed ? 'Yes' : 'No'} />
              <DetailItem label="Created" value={formatDateTime(selectedOrder.created_at)} />
              <DetailItem label="Delivery Type" value={humanize(selectedOrder.delivery_type)} />
              <DetailItem label="Total" value={formatCurrency(selectedOrder.total_cents)} />
            </dl>

            <div className="detail-block">
              <h4>Items</h4>
              <ul className="detail-list">
                {selectedOrder.items.map((item) => (
                  <li key={`${selectedOrder.order_number}-${item.menu_id}`}>
                    <span>{item.name}</span>
                    <strong>
                      {item.quantity} × {formatCurrency(item.price_cents)}
                    </strong>
                  </li>
                ))}
              </ul>
            </div>

            <div className="detail-block">
              <h4>Routing</h4>
              <p>{selectedOrder.delivery_address || selectedOrder.pickup_address || 'Address not available'}</p>
            </div>

            {selectedOrder.delivery_type === 'pickup' ? (
              <div className="detail-block">
                <h4>Pickup Coordination</h4>
                <dl className="detail-grid">
                  <DetailItem label="Latest ETA" value={formatPickupEtaSummary(selectedOrder.latest_pickup_eta)} />
                  <DetailItem
                    label="Arrival Proof"
                    value={
                      selectedOrder.latest_pickup_arrival_photo
                        ? `Uploaded • ${formatDateTime(selectedOrder.latest_pickup_arrival_photo.created_at)}`
                        : 'Not uploaded'
                    }
                  />
                </dl>

                {selectedOrder.latest_pickup_eta?.note ? (
                  <p className="detail-copy">Customer ETA note: {selectedOrder.latest_pickup_eta.note}</p>
                ) : null}

                {selectedOrder.latest_pickup_arrival_photo ? (
                  <div className="evidence-grid">
                    <img
                      className="evidence-image"
                      src={selectedOrder.latest_pickup_arrival_photo.photo_url}
                      alt={`Pickup arrival proof for ${selectedOrder.order_number}`}
                    />
                    <div className="stack">
                      <p className="detail-copy">
                        Latest proof from{' '}
                        {selectedOrder.latest_pickup_arrival_photo.customer_name
                          || selectedOrder.latest_pickup_arrival_photo.customer_telegram_id
                          || 'customer'}
                        .
                      </p>
                      {selectedOrder.latest_pickup_arrival_photo.parking_note ? (
                        <p className="detail-copy">
                          Parking note: {selectedOrder.latest_pickup_arrival_photo.parking_note}
                        </p>
                      ) : null}
                      <a
                        className="text-link"
                        href={selectedOrder.latest_pickup_arrival_photo.photo_url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open full image
                      </a>
                    </div>
                  </div>
                ) : null}

                {selectedOrder.pickup_eta_updates?.length ? (
                  <div className="detail-block">
                    <h4>ETA History</h4>
                    <ul className="detail-list">
                      {selectedOrder.pickup_eta_updates.map((update) => (
                        <li key={`eta-${update.id}`}>
                          <span>
                            {update.eta_minutes} min
                            {update.note ? ` • ${update.note}` : ''}
                          </span>
                          <strong>{formatDateTime(update.created_at)}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {selectedOrder.pickup_arrival_photos?.length ? (
                  <div className="detail-block">
                    <h4>Arrival Proof History</h4>
                    <ul className="detail-list">
                      {selectedOrder.pickup_arrival_photos.map((photo) => (
                        <li key={`pickup-photo-${photo.id}`}>
                          <span>{photo.parking_note || 'Arrival photo uploaded'}</span>
                          <strong>{formatDateTime(photo.created_at)}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!selectedOrder.payment_confirmed ? (
              <button className="primary-button" onClick={() => void markPaid(selectedOrder.order_number)}>
                Mark Payment Approved
              </button>
            ) : (
              <div className="stack">
                <label className="field">
                  <span>Assign Driver</span>
                  <select value={selectedDriverId} onChange={(event) => setSelectedDriverId(event.target.value)}>
                    <option value="">Select driver</option>
                    {drivers.map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {driver.name} • {driver.active_orders} active • {driver.is_online ? 'online' : 'offline'}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="primary-button" disabled={!selectedDriverId} onClick={() => void assignDriver()}>
                  Assign Driver
                </button>
              </div>
            )}
          </>
        ) : (
          <EmptyPanel title="Select an order" copy="Pick an order from the list to review payment state and driver assignment." />
        )}
      </article>
    </section>
  );
}

function DriversView({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [drivers, setDrivers] = useState<DriverSummary[]>([]);
  const [error, setError] = useState('');

  async function loadDrivers() {
    try {
      const response = await adminRequest<DriverSummary[]>(token, '/drivers?limit=100');
      setDrivers(Array.isArray(response) ? response : []);
      setError('');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    }
  }

  useEffect(() => {
    void loadDrivers();
  }, [token]);

  async function toggleOnline(driver: DriverSummary) {
    try {
      await adminRequest(token, `/drivers/${driver.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_online: !driver.is_online }),
      });
      await loadDrivers();
    } catch (cause) {
      setError(extractErrorMessage(cause));
    }
  }

  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Drivers</p>
          <h3>Availability and dispatch limits</h3>
        </div>
        <button className="secondary-button" onClick={() => void loadDrivers()}>
          Refresh
        </button>
      </div>
      {error ? <div className="inline-error">{error}</div> : null}
      <div className="card-grid">
        {drivers.map((driver) => (
          <article key={driver.id} className="summary-card">
            <div className="card-head">
              <div>
                <h4>{driver.name}</h4>
                <p>{driver.telegram_id}</p>
              </div>
              <StatusPill tone={driver.is_online ? 'approved' : 'pending'}>
                {driver.is_online ? 'Online' : 'Offline'}
              </StatusPill>
            </div>
            <dl className="detail-grid">
              <DetailItem label="Active Orders" value={`${driver.active_orders}`} />
              <DetailItem label="Delivered" value={`${driver.delivered_orders}`} />
              <DetailItem label="Max Distance" value={`${driver.max_delivery_distance_miles} mi`} />
              <DetailItem label="Capacity" value={`${driver.max_concurrent_orders}`} />
            </dl>
            <button className="secondary-button" onClick={() => void toggleOnline(driver)}>
              Set {driver.is_online ? 'Offline' : 'Online'}
            </button>
          </article>
        ))}
      </div>
    </article>
  );
}

function CustomersView({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    let cancelled = false;

    adminRequest<CustomerSummary[]>(token, '/customers?limit=200')
      .then((response) => {
        if (!cancelled) {
          setCustomers(Array.isArray(response) ? response : []);
        }
      })
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) {
          onUnauthorized();
          return;
        }
        if (!cancelled) {
          setError(extractErrorMessage(cause));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const filteredCustomers = customers.filter((customer) => {
    const haystack = `${customer.telegram_id} ${customer.alias_username ?? ''} ${customer.alias_email ?? ''} ${customer.display_name ?? ''}`.toLowerCase();
    return haystack.includes(deferredSearch.trim().toLowerCase());
  });

  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Customers</p>
          <h3>Invite-bound profiles</h3>
        </div>
        <input
          className="search-input compact-search"
          placeholder="Search customer"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {error ? <div className="inline-error">{error}</div> : null}
      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th>Telegram</th>
              <th>Alias</th>
              <th>Status</th>
              <th>Invite</th>
              <th>Orders</th>
              <th>Last Login</th>
            </tr>
          </thead>
          <tbody>
            {filteredCustomers.map((customer) => (
              <tr key={customer.id}>
                <td>{customer.telegram_id}</td>
                <td>{customer.alias_username || customer.alias_email || customer.display_name || 'N/A'}</td>
                <td>
                  <StatusPill tone={customer.account_status || 'pending'}>
                    {humanize(customer.account_status)}
                  </StatusPill>
                </td>
                <td>{customer.invite_code || '—'}</td>
                <td>{customer.order_count || 0}</td>
                <td>{formatDateTime(customer.last_login_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function InvitesView({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [invites, setInvites] = useState<InviteSummary[]>([]);
  const [aliasUsername, setAliasUsername] = useState('');
  const [aliasEmail, setAliasEmail] = useState('');
  const [targetRole, setTargetRole] = useState<'customer' | 'driver'>('customer');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  async function loadInvites() {
    try {
      const response = await adminRequest<InviteSummary[]>(token, '/invites');
      setInvites(Array.isArray(response) ? response : []);
      setError('');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        onUnauthorized();
        return;
      }
      setError(extractErrorMessage(cause));
    }
  }

  useEffect(() => {
    void loadInvites();
  }, [token]);

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await adminRequest(token, '/invites', {
        method: 'POST',
        body: JSON.stringify({
          alias_username: aliasUsername || null,
          alias_email: aliasEmail || null,
          target_role: targetRole,
          notes: notes || null,
        }),
      });
      setAliasUsername('');
      setAliasEmail('');
      setTargetRole('customer');
      setNotes('');
      await loadInvites();
    } catch (cause) {
      setError(extractErrorMessage(cause));
    }
  }

  async function revokeInvite(inviteId: number) {
    try {
      await adminRequest(token, `/invites/${inviteId}/revoke`, { method: 'POST' });
      await loadInvites();
    } catch (cause) {
      setError(extractErrorMessage(cause));
    }
  }

  return (
    <section className="two-column-layout">
      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Invites</p>
            <h3>Create private access codes</h3>
          </div>
        </div>
        <form className="stack" onSubmit={createInvite}>
          <label className="field">
            <span>Invite role</span>
            <select value={targetRole} onChange={(event) => setTargetRole(event.target.value as 'customer' | 'driver')}>
              <option value="customer">Customer</option>
              <option value="driver">Driver</option>
            </select>
          </label>
          <label className="field">
            <span>Alias username</span>
            <input value={aliasUsername} onChange={(event) => setAliasUsername(event.target.value)} placeholder="private_member" />
          </label>
          <label className="field">
            <span>Alias email</span>
            <input value={aliasEmail} onChange={(event) => setAliasEmail(event.target.value)} placeholder="member@example.com" />
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} placeholder="Internal reference" />
          </label>
          <button className="primary-button" type="submit">
            Create Invite
          </button>
          {error ? <div className="inline-error">{error}</div> : null}
        </form>
      </article>

      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Issued Codes</p>
            <h3>Current invite ledger</h3>
          </div>
          <button className="secondary-button" onClick={() => void loadInvites()}>
            Refresh
          </button>
        </div>
        <div className="invite-list">
          {invites.map((invite) => (
            <article key={invite.id} className="summary-card">
              <div className="card-head">
                <div>
                  <h4>{invite.code}</h4>
                  <p>{invite.alias_username || invite.alias_email || 'No alias preset'}</p>
                </div>
                <StatusPill tone={invite.status}>{humanize(invite.status)}</StatusPill>
              </div>
              <dl className="detail-grid">
                <DetailItem label="Role" value={humanize(invite.target_role)} />
                <DetailItem label="Claimed By" value={`${invite.claimed_by_telegram_id ?? '—'}`} />
                <DetailItem label="Created" value={formatDate(invite.created_at)} />
              </dl>
              {invite.notes ? <p className="muted-copy">{invite.notes}</p> : null}
              {invite.status === 'pending' ? (
                <button className="secondary-button" onClick={() => void revokeInvite(invite.id)}>
                  Revoke
                </button>
              ) : null}
            </article>
          ))}
        </div>
      </article>
    </section>
  );
}

export default App;
