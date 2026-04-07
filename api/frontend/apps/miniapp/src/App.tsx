import { useDeferredValue, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { ApiError, extractErrorMessage, requestJson, requestWithBearer } from '@shared/api';
import { formatCurrency, formatDateTime, humanize } from '@shared/format';
import type {
  CustomerAddress,
  MenuItem,
  MiniAppConfig,
  MiniAppCustomer,
  MiniAppDriverOffer,
  MiniAppDriverProfile,
  MiniAppOrder,
  MiniAppRole,
  PickupLocation,
  ReferralSummary,
  SupportTicketSummary,
} from '@shared/types';

const MINIAPP_API_BASE = import.meta.env.VITE_MINIAPP_API_BASE ?? '/miniapp-api';
const SESSION_STORAGE_KEY = 'delivery_bot.miniapp_session';
const LEGACY_SESSION_STORAGE_KEY = 'miniappSessionToken';
const CART_STORAGE_KEY = 'delivery_bot.miniapp_cart';
const LEGACY_CART_STORAGE_KEY = 'miniappCart';

type ViewKey = 'home' | 'menu' | 'orders' | 'account';
type DeliveryMode = 'delivery' | 'pickup';
type ToastTone = 'default' | 'error';
type AuthTone = 'default' | 'error';
type PaymentType = 'cash' | 'cashapp' | 'apple_cash' | 'btc';

interface CartItem {
  menu_id: number;
  name: string;
  price_cents: number;
  quantity: number;
}

interface AuthResponse {
  session_token: string;
  expires_at: string;
  customer: MiniAppCustomer;
  invite: {
    code?: string | null;
    status?: string | null;
    target_role?: MiniAppRole | null;
    alias_username?: string | null;
    alias_email?: string | null;
  };
}

interface DeliveryFeeResponse {
  delivery_fee_cents: number;
  delivery_zone: string;
  delivery_type: string;
}

interface CreateOrderResponse {
  order: MiniAppOrder;
  payment_url?: string | null;
  payment_label: string;
  message: string;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: {
    start_param?: string;
  };
  themeParams?: {
    bg_color?: string;
    secondary_bg_color?: string;
    text_color?: string;
    button_color?: string;
    button_text_color?: string;
  };
  ready(): void;
  expand(): void;
  openLink?(url: string): void;
  close?(): void;
  HapticFeedback?: {
    impactOccurred?(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred?(type: 'error' | 'success' | 'warning'): void;
  };
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

function getTelegramApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.Telegram?.WebApp ?? null;
}

function normalizeInviteCode(value: string | null | undefined): string {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 32);
}

function getWindowLaunchParams(): URLSearchParams[] {
  if (typeof window === 'undefined') {
    return [new URLSearchParams(), new URLSearchParams()];
  }

  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return [searchParams, hashParams];
}

function getLaunchParam(...keys: string[]): string {
  const sources = getWindowLaunchParams();
  for (const source of sources) {
    for (const key of keys) {
      const value = source.get(key)?.trim();
      if (value) {
        return value;
      }
    }
  }
  return '';
}

function resolveTelegramLaunchContext(): {
  telegram: TelegramWebApp | null;
  initData: string;
  startParam: string;
} {
  const telegram = getTelegramApp();
  const initData = telegram?.initData?.trim() || getLaunchParam('tgWebAppData');
  const startParam = normalizeInviteCode(
    telegram?.initDataUnsafe?.start_param?.trim() || getLaunchParam('tgWebAppStartParam', 'startapp'),
  );

  return {
    telegram,
    initData,
    startParam,
  };
}

function getStoredSessionToken(): string {
  return localStorage.getItem(SESSION_STORAGE_KEY) || localStorage.getItem(LEGACY_SESSION_STORAGE_KEY) || '';
}

function storeSessionToken(token: string): void {
  localStorage.setItem(SESSION_STORAGE_KEY, token);
  localStorage.setItem(LEGACY_SESSION_STORAGE_KEY, token);
}

function clearStoredSessionToken(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
  localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
}

function getStoredCart(): CartItem[] {
  const rawValue = localStorage.getItem(CART_STORAGE_KEY) || localStorage.getItem(LEGACY_CART_STORAGE_KEY) || '[]';
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function storeCart(cart: CartItem[]): void {
  const serialized = JSON.stringify(cart);
  localStorage.setItem(CART_STORAGE_KEY, serialized);
  localStorage.setItem(LEGACY_CART_STORAGE_KEY, serialized);
}

function getApiDetailCode(error: unknown): string | undefined {
  if (error instanceof ApiError && error.detail && typeof error.detail === 'object') {
    const maybeCode = (error.detail as { code?: unknown }).code;
    return typeof maybeCode === 'string' ? maybeCode : undefined;
  }
  if (error && typeof error === 'object') {
    const maybeCode = (error as { code?: unknown }).code;
    return typeof maybeCode === 'string' ? maybeCode : undefined;
  }
  return undefined;
}

function buildSupportText(config: MiniAppConfig | null): string {
  if (!config) {
    return 'Support contact is not configured yet.';
  }

  const parts = [
    config.contact.telegram_username
      ? `Telegram: @${config.contact.telegram_username.replace(/^@/, '')}`
      : null,
    config.contact.phone_number ? `Phone: ${config.contact.phone_number}` : null,
    config.contact.email_address ? `Email: ${config.contact.email_address}` : null,
    config.contact.additional_info || null,
  ].filter(Boolean);

  return parts.join(' • ') || 'Support contact is not configured yet.';
}

function formatPickupEtaValue(order: MiniAppOrder): string {
  if (!order.latest_pickup_eta) {
    return 'Not shared yet';
  }
  return `${order.latest_pickup_eta.eta_minutes} min away • ${formatDateTime(order.latest_pickup_eta.created_at)}`;
}

function openExternalLink(url: string): void {
  const telegram = getTelegramApp();
  if (telegram?.openLink) {
    telegram.openLink(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function normalizePhoneHref(phone: string): string {
  const normalized = phone.replace(/[^\d+]/g, '');
  return normalized ? `tel:${normalized}` : `tel:${phone}`;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', 'true');
  input.style.position = 'absolute';
  input.style.left = '-9999px';
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  document.body.removeChild(input);
}

async function miniappRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  return requestWithBearer<T>(`${MINIAPP_API_BASE}${path}`, token, init);
}

function App() {
  const [sessionToken, setSessionToken] = useState<string>(getStoredSessionToken);
  const [booting, setBooting] = useState(true);
  const [hydrating, setHydrating] = useState(false);
  const [authPending, setAuthPending] = useState(false);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [savingDriverProfile, setSavingDriverProfile] = useState(false);
  const [driverActionOrderNumber, setDriverActionOrderNumber] = useState('');
  const [pickupEtaOrderNumber, setPickupEtaOrderNumber] = useState('');
  const [pickupPhotoOrderNumber, setPickupPhotoOrderNumber] = useState('');
  const [activeView, setActiveView] = useState<ViewKey>('home');
  const [authStatus, setAuthStatus] = useState('Waiting for Telegram Mini App context.');
  const [authTone, setAuthTone] = useState<AuthTone>('default');
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);
  const [inviteCode, setInviteCode] = useState('');

  const [config, setConfig] = useState<MiniAppConfig | null>(null);
  const [customer, setCustomer] = useState<MiniAppCustomer | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [menuSearch, setMenuSearch] = useState('');
  const [orders, setOrders] = useState<MiniAppOrder[]>([]);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [pickupLocations, setPickupLocations] = useState<PickupLocation[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicketSummary[]>([]);
  const [referrals, setReferrals] = useState<ReferralSummary[]>([]);
  const [driverOffers, setDriverOffers] = useState<MiniAppDriverOffer[]>([]);
  const [cart, setCart] = useState<CartItem[]>(getStoredCart);
  const [submittingSupportTicket, setSubmittingSupportTicket] = useState(false);
  const [creatingReferral, setCreatingReferral] = useState(false);
  const [offerActionId, setOfferActionId] = useState<number | null>(null);

  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('delivery');
  const [deliveryAddressId, setDeliveryAddressId] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [pickupAddressId, setPickupAddressId] = useState('');
  const [paymentType, setPaymentType] = useState<PaymentType>('cash');
  const [deliverySlot, setDeliverySlot] = useState('');
  const [notes, setNotes] = useState('');
  const [deliveryFeeCents, setDeliveryFeeCents] = useState(0);
  const [deliveryZone, setDeliveryZone] = useState('Awaiting address');

  const [newAddressLabel, setNewAddressLabel] = useState('Home');
  const [newAddressText, setNewAddressText] = useState('');
  const [newAddressDefault, setNewAddressDefault] = useState(false);

  const appRole: MiniAppRole = config?.app_role || customer?.app_role || 'customer';
  const isDriverApp = appRole === 'driver';
  const driverProfile: MiniAppDriverProfile | null = config?.driver_profile || null;
  const availableViews: ViewKey[] = isDriverApp ? ['home', 'orders', 'account'] : ['home', 'menu', 'orders', 'account'];
  const deferredMenuSearch = useDeferredValue(menuSearch);
  const subtotalCents = cart.reduce((sum, item) => sum + item.price_cents * item.quantity, 0);
  const totalCents = subtotalCents + (deliveryMode === 'pickup' ? 0 : deliveryFeeCents);
  const pendingApprovalCount = orders.filter((order) => !order.payment_confirmed && order.status !== 'cancelled').length;
  const supportText = buildSupportText(config);
  const authenticated = Boolean(sessionToken && customer && config);

  function pushToast(message: string, tone: ToastTone = 'default') {
    setToast({ message, tone });
  }

  function resetAuthedState(nextAuthMessage?: string, tone: AuthTone = 'error') {
    setSessionToken('');
    setConfig(null);
    setCustomer(null);
    setMenu([]);
    setOrders([]);
    setAddresses([]);
    setPickupLocations([]);
    setSupportTickets([]);
    setReferrals([]);
    setDriverOffers([]);
    setDeliveryFeeCents(0);
    setDeliveryZone('Awaiting address');
    setActiveView('home');
    clearStoredSessionToken();
    if (nextAuthMessage) {
      setAuthStatus(nextAuthMessage);
      setAuthTone(tone);
    }
  }

  async function loadAppData(token: string) {
    setHydrating(true);
    setError('');

    try {
      const configResponse = await miniappRequest<MiniAppConfig>(token, '/config');
      const nextRole: MiniAppRole = configResponse.app_role || configResponse.customer.app_role || 'customer';
      const [ordersResponse, menuResponse, addressesResponse, pickupResponse, supportResponse, referralsResponse, offersResponse] =
        await Promise.all([
          miniappRequest<MiniAppOrder[]>(token, '/orders'),
          nextRole === 'customer' ? miniappRequest<MenuItem[]>(token, '/menu') : Promise.resolve<MenuItem[]>([]),
          nextRole === 'customer'
            ? miniappRequest<CustomerAddress[]>(token, '/addresses')
            : Promise.resolve<CustomerAddress[]>([]),
          nextRole === 'customer'
            ? miniappRequest<PickupLocation[]>(token, '/pickup-addresses')
            : Promise.resolve<PickupLocation[]>([]),
          miniappRequest<SupportTicketSummary[]>(token, '/support-tickets'),
          nextRole === 'customer'
            ? miniappRequest<ReferralSummary[]>(token, '/referrals')
            : Promise.resolve<ReferralSummary[]>([]),
          nextRole === 'driver'
            ? miniappRequest<MiniAppDriverOffer[]>(token, '/driver/offers')
            : Promise.resolve<MiniAppDriverOffer[]>([]),
        ]);
      setConfig(configResponse);
      setCustomer(configResponse.customer);
      setOrders(Array.isArray(ordersResponse) ? ordersResponse : []);
      setSupportTickets(Array.isArray(supportResponse) ? supportResponse : []);
      if (nextRole === 'customer') {
        setMenu(Array.isArray(menuResponse) ? menuResponse : []);
        setAddresses(Array.isArray(addressesResponse) ? addressesResponse : []);
        setPickupLocations(Array.isArray(pickupResponse) ? pickupResponse : []);
        setReferrals(Array.isArray(referralsResponse) ? referralsResponse : []);
        setDriverOffers([]);
      } else {
        setMenu([]);
        setAddresses([]);
        setPickupLocations([]);
        setReferrals([]);
        setDriverOffers(Array.isArray(offersResponse) ? offersResponse : []);
        setCart([]);
        setDeliveryFeeCents(0);
        setDeliveryZone('Driver mode');
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
      } else {
        setError(extractErrorMessage(cause));
      }
      throw cause;
    } finally {
      setHydrating(false);
    }
  }

  async function authenticate(nextInviteCode = '') {
    const { initData } = resolveTelegramLaunchContext();
    if (!initData) {
      throw new Error('Telegram Mini App context is missing. Launch this from the bot.');
    }

    const authResponse = await requestJson<AuthResponse>(`${MINIAPP_API_BASE}/auth/telegram`, {
      method: 'POST',
      body: JSON.stringify({
        init_data: initData,
        invite_code: normalizeInviteCode(nextInviteCode) || undefined,
      }),
    });

    await loadAppData(authResponse.session_token);
    setSessionToken(authResponse.session_token);
    setCustomer(authResponse.customer);
    setAuthStatus('Mini App access is active.');
    setAuthTone('default');
  }

  async function refreshConfig(token = sessionToken) {
    if (!token) {
      return;
    }
    try {
      const configResponse = await miniappRequest<MiniAppConfig>(token, '/config');
      setConfig(configResponse);
      setCustomer(configResponse.customer);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
        return;
      }
      pushToast(extractErrorMessage(cause), 'error');
    }
  }

  async function refreshMenu(token = sessionToken) {
    if (!token) {
      return;
    }
    try {
      const menuResponse = await miniappRequest<MenuItem[]>(token, '/menu');
      setMenu(Array.isArray(menuResponse) ? menuResponse : []);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
        return;
      }
      pushToast(extractErrorMessage(cause), 'error');
    }
  }

  async function refreshOrders(token = sessionToken) {
    if (!token) {
      return;
    }
    try {
      const ordersResponse = await miniappRequest<MiniAppOrder[]>(token, '/orders');
      setOrders(Array.isArray(ordersResponse) ? ordersResponse : []);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
        return;
      }
      pushToast(extractErrorMessage(cause), 'error');
    }
  }

  async function refreshAddresses(token = sessionToken) {
    if (!token) {
      return;
    }
    try {
      const addressesResponse = await miniappRequest<CustomerAddress[]>(token, '/addresses');
      setAddresses(Array.isArray(addressesResponse) ? addressesResponse : []);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
        return;
      }
      pushToast(extractErrorMessage(cause), 'error');
    }
  }

  async function refreshSupportTickets(token = sessionToken) {
    if (!token) {
      return;
    }
    try {
      const supportResponse = await miniappRequest<SupportTicketSummary[]>(token, '/support-tickets');
      setSupportTickets(Array.isArray(supportResponse) ? supportResponse : []);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
        return;
      }
      pushToast(extractErrorMessage(cause), 'error');
    }
  }

  async function refreshReferrals(token = sessionToken) {
    if (!token || isDriverApp) {
      return;
    }
    try {
      const referralsResponse = await miniappRequest<ReferralSummary[]>(token, '/referrals');
      setReferrals(Array.isArray(referralsResponse) ? referralsResponse : []);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
        return;
      }
      pushToast(extractErrorMessage(cause), 'error');
    }
  }

  async function refreshDriverOffers(token = sessionToken) {
    if (!token || !isDriverApp) {
      return;
    }
    try {
      const offersResponse = await miniappRequest<MiniAppDriverOffer[]>(token, '/driver/offers');
      setDriverOffers(Array.isArray(offersResponse) ? offersResponse : []);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
        return;
      }
      pushToast(extractErrorMessage(cause), 'error');
    }
  }

  async function createSupportTicket(
    subject: string,
    message: string,
    category: string,
    priority: string,
    orderNumber?: string,
  ): Promise<boolean> {
    if (!sessionToken) {
      return false;
    }

    setSubmittingSupportTicket(true);
    try {
      await miniappRequest<SupportTicketSummary>(sessionToken, '/support-tickets', {
        method: 'POST',
        body: JSON.stringify({
          subject,
          message,
          category,
          priority,
          order_number: orderNumber || null,
        }),
      });
      await refreshSupportTickets(sessionToken);
      pushToast('Support ticket submitted');
      getTelegramApp()?.HapticFeedback?.notificationOccurred?.('success');
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
        return false;
      }
      pushToast(extractErrorMessage(cause), 'error');
      getTelegramApp()?.HapticFeedback?.notificationOccurred?.('error');
      return false;
    } finally {
      setSubmittingSupportTicket(false);
    }
  }

  async function createReferralInvite(aliasUsername?: string, aliasEmail?: string, notes?: string): Promise<boolean> {
    if (!sessionToken || isDriverApp) {
      return false;
    }

    setCreatingReferral(true);
    try {
      await miniappRequest<{ message: string; referral: ReferralSummary }>(sessionToken, '/referrals', {
        method: 'POST',
        body: JSON.stringify({
          alias_username: aliasUsername || null,
          alias_email: aliasEmail || null,
          notes: notes || null,
        }),
      });
      await refreshReferrals(sessionToken);
      pushToast('Referral invite created');
      getTelegramApp()?.HapticFeedback?.notificationOccurred?.('success');
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
        return false;
      }
      pushToast(extractErrorMessage(cause), 'error');
      getTelegramApp()?.HapticFeedback?.notificationOccurred?.('error');
      return false;
    } finally {
      setCreatingReferral(false);
    }
  }

  async function respondToDriverOffer(offerId: number, action: 'accept' | 'decline') {
    if (!sessionToken || !isDriverApp) {
      return;
    }

    setOfferActionId(offerId);
    try {
      await miniappRequest(sessionToken, `/driver/offers/${offerId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      await Promise.all([refreshOrders(sessionToken), refreshDriverOffers(sessionToken), refreshConfig(sessionToken)]);
      if (action === 'accept') {
        setActiveView('orders');
      }
      pushToast(`Offer ${action}ed`);
      getTelegramApp()?.HapticFeedback?.notificationOccurred?.('success');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
        return;
      }
      pushToast(extractErrorMessage(cause), 'error');
      getTelegramApp()?.HapticFeedback?.notificationOccurred?.('error');
    } finally {
      setOfferActionId(null);
    }
  }

  async function updateDriverProfile(patch: Partial<Pick<MiniAppDriverProfile, 'is_online' | 'accepts_delivery' | 'accepts_pickup'>>) {
    if (!sessionToken || !isDriverApp) {
      return;
    }

    setSavingDriverProfile(true);
    try {
      await miniappRequest<MiniAppDriverProfile>(sessionToken, '/driver/profile', {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      await Promise.all([refreshConfig(sessionToken), refreshDriverOffers(sessionToken)]);
      pushToast('Driver profile updated');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
        return;
      }
      pushToast(extractErrorMessage(cause), 'error');
    } finally {
      setSavingDriverProfile(false);
    }
  }

  async function updateDriverOrderStatus(orderNumber: string, status: 'out_for_delivery' | 'delivered') {
    if (!sessionToken || !isDriverApp) {
      return;
    }

    setDriverActionOrderNumber(orderNumber);
    try {
      await miniappRequest(sessionToken, `/driver/orders/${orderNumber}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      await Promise.all([refreshOrders(sessionToken), refreshConfig(sessionToken)]);
      pushToast(`Order ${orderNumber} marked ${humanize(status)}`);
      getTelegramApp()?.HapticFeedback?.notificationOccurred?.('success');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
        return;
      }
      pushToast(extractErrorMessage(cause), 'error');
      getTelegramApp()?.HapticFeedback?.notificationOccurred?.('error');
    } finally {
      setDriverActionOrderNumber('');
    }
  }

  async function submitPickupEta(orderNumber: string, etaMinutes: number, note?: string) {
    if (!sessionToken || isDriverApp) {
      return;
    }

    setPickupEtaOrderNumber(orderNumber);
    try {
      await miniappRequest(sessionToken, `/orders/${orderNumber}/pickup-eta`, {
        method: 'POST',
        body: JSON.stringify({
          eta_minutes: etaMinutes,
          note: note?.trim() || null,
        }),
      });
      await refreshOrders(sessionToken);
      pushToast(`Pickup ETA sent for ${orderNumber}`);
      getTelegramApp()?.HapticFeedback?.notificationOccurred?.('success');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
        return;
      }
      pushToast(extractErrorMessage(cause), 'error');
      getTelegramApp()?.HapticFeedback?.notificationOccurred?.('error');
    } finally {
      setPickupEtaOrderNumber('');
    }
  }

  async function uploadPickupArrivalPhoto(orderNumber: string, photo: File, parkingNote?: string) {
    if (!sessionToken || isDriverApp) {
      return;
    }

    const formData = new FormData();
    formData.append('photo', photo);
    if (parkingNote?.trim()) {
      formData.append('parking_note', parkingNote.trim());
    }

    setPickupPhotoOrderNumber(orderNumber);
    try {
      await miniappRequest(sessionToken, `/orders/${orderNumber}/pickup-arrival-photo`, {
        method: 'POST',
        body: formData,
      });
      await refreshOrders(sessionToken);
      pushToast(`Pickup arrival proof uploaded for ${orderNumber}`);
      getTelegramApp()?.HapticFeedback?.notificationOccurred?.('success');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
        return;
      }
      pushToast(extractErrorMessage(cause), 'error');
      getTelegramApp()?.HapticFeedback?.notificationOccurred?.('error');
    } finally {
      setPickupPhotoOrderNumber('');
    }
  }

  async function logout() {
    if (sessionToken) {
      try {
        await miniappRequest(sessionToken, '/logout', { method: 'POST' });
      } catch {
        // Best-effort logout.
      }
    }
    resetAuthedState('Mini App session cleared. Re-open from Telegram to sign back in.', 'default');
  }

  function addToCart(item: MenuItem) {
    setCart((currentCart) => {
      const existing = currentCart.find((entry) => entry.menu_id === item.id);
      if (existing) {
        return currentCart.map((entry) =>
          entry.menu_id === item.id
            ? { ...entry, quantity: Math.min(entry.quantity + 1, item.available_qty || entry.quantity + 1) }
            : entry,
        );
      }
      return [
        ...currentCart,
        {
          menu_id: item.id,
          name: item.name,
          price_cents: item.price_cents,
          quantity: 1,
        },
      ];
    });
    getTelegramApp()?.HapticFeedback?.impactOccurred?.('light');
    pushToast(`${item.name} added to cart`);
  }

  function updateCartQuantity(menuId: number, delta: number) {
    setCart((currentCart) =>
      currentCart
        .map((entry) =>
          entry.menu_id === menuId
            ? { ...entry, quantity: Math.max(entry.quantity + delta, 0) }
            : entry,
        )
        .filter((entry) => entry.quantity > 0),
    );
  }

  function clearCart() {
    setCart([]);
  }

  async function handleSaveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionToken) {
      return;
    }

    setSavingAddress(true);
    try {
      await miniappRequest(sessionToken, '/addresses', {
        method: 'POST',
        body: JSON.stringify({
          label: newAddressLabel.trim() || 'Address',
          address_text: newAddressText.trim(),
          is_default: newAddressDefault,
        }),
      });
      setNewAddressLabel('Home');
      setNewAddressText('');
      setNewAddressDefault(false);
      await refreshAddresses(sessionToken);
      pushToast('Address saved');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
        return;
      }
      pushToast(extractErrorMessage(cause), 'error');
    } finally {
      setSavingAddress(false);
    }
  }

  async function handleSetDefaultAddress(addressId: number) {
    if (!sessionToken) {
      return;
    }

    try {
      await miniappRequest(sessionToken, `/addresses/${addressId}/default`, { method: 'PUT' });
      await refreshAddresses(sessionToken);
      pushToast('Default address updated');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
        return;
      }
      pushToast(extractErrorMessage(cause), 'error');
    }
  }

  async function handleDeleteAddress(addressId: number) {
    if (!sessionToken || !window.confirm('Delete this address?')) {
      return;
    }

    try {
      await miniappRequest(sessionToken, `/addresses/${addressId}`, { method: 'DELETE' });
      await refreshAddresses(sessionToken);
      pushToast('Address deleted');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
        return;
      }
      pushToast(extractErrorMessage(cause), 'error');
    }
  }

  async function handlePlaceOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionToken) {
      return;
    }
    if (!cart.length) {
      pushToast('Add items before checkout.', 'error');
      return;
    }

    const resolvedManualAddress = manualAddress.trim();
    const resolvedDeliveryAddressId = deliveryAddressId ? Number(deliveryAddressId) : null;
    const resolvedPickupAddressId = pickupAddressId ? Number(pickupAddressId) : null;

    if (deliveryMode === 'delivery' && !resolvedDeliveryAddressId && !resolvedManualAddress) {
      pushToast('Select or enter a delivery address.', 'error');
      return;
    }
    if (deliveryMode === 'pickup' && !resolvedPickupAddressId) {
      pushToast('Select a pickup location.', 'error');
      return;
    }

    setPlacingOrder(true);
    try {
      const response = await miniappRequest<CreateOrderResponse>(sessionToken, '/orders', {
        method: 'POST',
        body: JSON.stringify({
          items: cart.map((item) => ({
            menu_id: item.menu_id,
            name: item.name,
            quantity: item.quantity,
            price_cents: item.price_cents,
          })),
          delivery_or_pickup: deliveryMode,
          delivery_address_id: deliveryMode === 'delivery' && resolvedDeliveryAddressId ? resolvedDeliveryAddressId : null,
          delivery_address_text:
            deliveryMode === 'delivery' && !resolvedDeliveryAddressId ? resolvedManualAddress : null,
          pickup_address_id: deliveryMode === 'pickup' ? resolvedPickupAddressId : null,
          payment_type: paymentType,
          delivery_slot_et: deliverySlot || null,
          notes: notes.trim() || null,
        }),
      });

      setCart([]);
      setNotes('');
      setDeliverySlot('');
      setPaymentType('cash');
      setActiveView('orders');
      await Promise.all([refreshOrders(sessionToken), refreshMenu(sessionToken)]);
      pushToast(response.message || `Order ${response.order.order_number} created`);
      getTelegramApp()?.HapticFeedback?.notificationOccurred?.('success');

      if (response.payment_url) {
        openExternalLink(response.payment_url);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
        return;
      }
      pushToast(extractErrorMessage(cause), 'error');
      getTelegramApp()?.HapticFeedback?.notificationOccurred?.('error');
    } finally {
      setPlacingOrder(false);
    }
  }

  async function handleAuthenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthPending(true);
    setAuthStatus('Authenticating with Telegram…');
    setAuthTone('default');

    try {
      await authenticate(inviteCode.trim());
      setBooting(false);
    } catch (cause) {
      setAuthStatus(extractErrorMessage(cause));
      setAuthTone(getApiDetailCode(cause) === 'invite_required' ? 'default' : 'error');
    } finally {
      setAuthPending(false);
    }
  }

  useEffect(() => {
    if (sessionToken) {
      storeSessionToken(sessionToken);
    } else {
      clearStoredSessionToken();
    }
  }, [sessionToken]);

  useEffect(() => {
    storeCart(cart);
  }, [cart]);

  useEffect(() => {
    if (isDriverApp && activeView === 'menu') {
      setActiveView('home');
    }
  }, [activeView, isDriverApp]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timeout = window.setTimeout(() => {
      setToast(null);
    }, 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (manualAddress.trim()) {
      return;
    }

    const defaultAddress = addresses.find((address) => address.is_default) ?? addresses[0];

    if (!defaultAddress) {
      if (deliveryAddressId) {
        setDeliveryAddressId('');
      }
      return;
    }

    if (!deliveryAddressId) {
      setDeliveryAddressId(String(defaultAddress.id));
      return;
    }

    if (!addresses.some((address) => String(address.id) === deliveryAddressId)) {
      setDeliveryAddressId(String(defaultAddress.id));
    }
  }, [addresses, deliveryAddressId, manualAddress]);

  useEffect(() => {
    if (!pickupLocations.length) {
      if (pickupAddressId) {
        setPickupAddressId('');
      }
      return;
    }

    if (!pickupAddressId || !pickupLocations.some((location) => String(location.id) === pickupAddressId)) {
      setPickupAddressId(String(pickupLocations[0].id));
    }
  }, [pickupLocations, pickupAddressId]);

  useEffect(() => {
    const { telegram, initData, startParam } = resolveTelegramLaunchContext();

    if (telegram) {
      telegram.ready();
      telegram.expand();
      if (telegram.themeParams?.bg_color) {
        document.documentElement.style.setProperty('--tg-bg', telegram.themeParams.bg_color);
      }
      if (telegram.themeParams?.button_color) {
        document.documentElement.style.setProperty('--tg-button', telegram.themeParams.button_color);
      }
      if (telegram.themeParams?.button_text_color) {
        document.documentElement.style.setProperty('--tg-button-text', telegram.themeParams.button_text_color);
      }
    }

    if (startParam) {
      setInviteCode(startParam);
    }

    let cancelled = false;

    async function bootstrap() {
      if (sessionToken) {
        try {
          await loadAppData(sessionToken);
          if (!cancelled) {
            setAuthStatus('Session restored.');
            setAuthTone('default');
            setBooting(false);
          }
          return;
        } catch {
          if (cancelled) {
            return;
          }
        }
      }

      if (!initData) {
        if (!cancelled) {
          setAuthStatus('Open this Mini App from the Telegram bot to authenticate.');
          setAuthTone('error');
          setBooting(false);
        }
        return;
      }

      try {
        await authenticate(startParam);
        if (!cancelled) {
          setBooting(false);
        }
      } catch (cause) {
        if (!cancelled) {
          setAuthStatus(extractErrorMessage(cause));
          setAuthTone(getApiDetailCode(cause) === 'invite_required' ? 'default' : 'error');
          setBooting(false);
        }
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionToken) {
      return undefined;
    }
    if (isDriverApp) {
      setDeliveryFeeCents(0);
      setDeliveryZone('Driver mode');
      return undefined;
    }

    if (deliveryMode === 'pickup') {
      setDeliveryFeeCents(0);
      setDeliveryZone('Pickup');
      return undefined;
    }

    const resolvedManualAddress = manualAddress.trim();
    if (!deliveryAddressId && !resolvedManualAddress) {
      setDeliveryFeeCents(0);
      setDeliveryZone('Awaiting address');
      return undefined;
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        const feeResponse = await miniappRequest<DeliveryFeeResponse>(sessionToken, '/delivery-fee', {
          method: 'POST',
          body: JSON.stringify({
            delivery_or_pickup: 'delivery',
            delivery_address_id: deliveryAddressId ? Number(deliveryAddressId) : null,
            delivery_address_text: deliveryAddressId ? null : resolvedManualAddress,
          }),
        });

        if (!cancelled) {
          setDeliveryFeeCents(feeResponse.delivery_fee_cents || 0);
          setDeliveryZone(feeResponse.delivery_zone || 'Delivery');
        }
      } catch (cause) {
        if (cancelled) {
          return;
        }
        if (cause instanceof ApiError && cause.status === 401) {
          resetAuthedState('Mini App session expired. Reopen the app from Telegram.', 'error');
          return;
        }
        setDeliveryFeeCents(0);
        setDeliveryZone('Unavailable');
      }
    }, resolvedManualAddress ? 320 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [sessionToken, isDriverApp, deliveryMode, deliveryAddressId, manualAddress]);

  const filteredMenu = menu.filter((item) => {
    const haystack = `${item.category} ${item.name} ${item.description ?? ''}`.toLowerCase();
    return haystack.includes(deferredMenuSearch.trim().toLowerCase());
  });

  const groupedMenu = filteredMenu.reduce<Record<string, MenuItem[]>>((groups, item) => {
    const key = item.category || 'Menu';
    groups[key] = groups[key] || [];
    groups[key].push(item);
    return groups;
  }, {});

  return (
    <div className="miniapp-shell">
      <header className="miniapp-hero">
        <div>
          <p className="eyebrow">Private Delivery Club</p>
          <h1>{isDriverApp ? 'Driver dispatch inside Telegram.' : 'Invite-only ordering inside Telegram.'}</h1>
          <p className="hero-copy">
            {isDriverApp
              ? 'Review assigned orders, update delivery status, and control driver availability without leaving Telegram.'
              : 'Order, save delivery addresses, and track payment-gated dispatch from the Mini App instead of the bot chat.'}
          </p>
        </div>
        <div className={`hero-badge ${authenticated ? 'active' : 'locked'}`}>
          {authenticated ? `${humanize(appRole)} • ${humanize(customer?.account_status || 'active')}` : 'Locked'}
        </div>
      </header>

      {booting ? (
        <article className="surface loading-surface">
          <p className="eyebrow">Booting</p>
          <h2>Checking Telegram session</h2>
          <p>Verifying your Mini App session and loading the current workspace.</p>
        </article>
      ) : authenticated ? (
        <div className={`miniapp-layout ${isDriverApp ? 'driver-layout' : ''}`}>
          <main className="content-column">
            <nav className="tabbar">
              {availableViews.map((view) => (
                <button
                  key={view}
                  className={`tab ${activeView === view ? 'active' : ''}`}
                  onClick={() => setActiveView(view)}
                >
                  {humanize(view)}
                </button>
              ))}
            </nav>

            {error ? <div className="inline-banner error">{error}</div> : null}
            {hydrating ? <div className="inline-banner">Refreshing Mini App data…</div> : null}

            {activeView === 'home' ? (
              <HomeView
                appRole={appRole}
                customer={customer}
                config={config}
                driverProfile={driverProfile}
                orders={orders}
                supportTickets={supportTickets}
                referrals={referrals}
                driverOffers={driverOffers}
                pendingApprovalCount={pendingApprovalCount}
                orderCount={orders.length}
                supportText={supportText}
                submittingSupportTicket={submittingSupportTicket}
                creatingReferral={creatingReferral}
                offerActionId={offerActionId}
                onRefreshSupportTickets={() => void refreshSupportTickets()}
                onRefreshReferrals={() => void refreshReferrals()}
                onRefreshDriverOffers={() => void refreshDriverOffers()}
                onCreateSupportTicket={createSupportTicket}
                onCreateReferral={createReferralInvite}
                onRespondToOffer={respondToDriverOffer}
              />
            ) : null}

            {!isDriverApp && activeView === 'menu' ? (
              <MenuView
                groupedMenu={groupedMenu}
                menuSearch={menuSearch}
                onMenuSearch={setMenuSearch}
                onRefresh={() => void refreshMenu()}
                onAddToCart={addToCart}
              />
            ) : null}

            {activeView === 'orders' ? (
              <OrdersView
                appRole={appRole}
                orders={orders}
                busyOrderNumber={driverActionOrderNumber}
                pickupEtaBusyOrderNumber={pickupEtaOrderNumber}
                pickupPhotoBusyOrderNumber={pickupPhotoOrderNumber}
                onRefresh={() => void refreshOrders()}
                onDriverStatusChange={updateDriverOrderStatus}
                onPickupEtaUpdate={submitPickupEta}
                onPickupArrivalUpload={uploadPickupArrivalPhoto}
              />
            ) : null}

            {activeView === 'account' ? (
              <AccountView
                appRole={appRole}
                customer={customer}
                driverProfile={driverProfile}
                supportText={supportText}
                addresses={addresses}
                newAddressLabel={newAddressLabel}
                newAddressText={newAddressText}
                newAddressDefault={newAddressDefault}
                savingAddress={savingAddress}
                savingDriverProfile={savingDriverProfile}
                onNewAddressLabel={setNewAddressLabel}
                onNewAddressText={setNewAddressText}
                onNewAddressDefault={setNewAddressDefault}
                onSaveAddress={handleSaveAddress}
                onSetDefaultAddress={handleSetDefaultAddress}
                onDeleteAddress={handleDeleteAddress}
                onDriverProfileChange={(patch) => void updateDriverProfile(patch)}
                onLogout={() => void logout()}
              />
            ) : null}
          </main>

          {!isDriverApp ? (
            <aside className="cart-column">
              <CartView
                cart={cart}
                subtotalCents={subtotalCents}
                totalCents={totalCents}
                deliveryFeeCents={deliveryMode === 'pickup' ? 0 : deliveryFeeCents}
                deliveryZone={deliveryZone}
                deliveryMode={deliveryMode}
                deliveryAddressId={deliveryAddressId}
                manualAddress={manualAddress}
                pickupAddressId={pickupAddressId}
                paymentType={paymentType}
                deliverySlot={deliverySlot}
                notes={notes}
                addresses={addresses}
                pickupLocations={pickupLocations}
                placingOrder={placingOrder}
                onDeliveryMode={setDeliveryMode}
                onDeliveryAddressChange={(value) => {
                  setDeliveryAddressId(value);
                  if (value) {
                    setManualAddress('');
                  }
                }}
                onManualAddressChange={(value) => {
                  setManualAddress(value);
                  if (value.trim()) {
                    setDeliveryAddressId('');
                  }
                }}
                onPickupAddressChange={setPickupAddressId}
                onPaymentType={setPaymentType}
                onDeliverySlot={setDeliverySlot}
                onNotes={setNotes}
                onQuantityChange={updateCartQuantity}
                onClearCart={clearCart}
                onSubmit={handlePlaceOrder}
              />
            </aside>
          ) : null}
        </div>
      ) : (
        <AuthView
          inviteCode={inviteCode}
          pending={authPending}
          authStatus={authStatus}
          authTone={authTone}
          onInviteCode={(value) => setInviteCode(normalizeInviteCode(value))}
          onSubmit={handleAuthenticate}
        />
      )}

      {toast ? <div className={`toast ${toast.tone}`}>{toast.message}</div> : null}
    </div>
  );
}

function AuthView({
  inviteCode,
  pending,
  authStatus,
  authTone,
  onInviteCode,
  onSubmit,
}: {
  inviteCode: string;
  pending: boolean;
  authStatus: string;
  authTone: AuthTone;
  onInviteCode: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <article className="surface auth-surface">
      <p className="eyebrow">Mini App Access</p>
      <h2>Authenticate through Telegram</h2>
      <p className="muted-copy">
        This Mini App is restricted to invited customers and drivers. If this is your first visit, redeem your invite code here and your Telegram account will be bound to the assigned private profile.
      </p>

      <form className="stack" onSubmit={onSubmit}>
        <label className="field">
          <span>Invite code</span>
          <input
            value={inviteCode}
            onChange={(event) => onInviteCode(event.target.value)}
            placeholder="Enter invite code"
            maxLength={32}
          />
        </label>
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? 'Authenticating…' : 'Activate Access'}
        </button>
      </form>

      <div className={`inline-banner ${authTone === 'error' ? 'error' : ''}`}>{authStatus}</div>
    </article>
  );
}

function HomeView({
  appRole,
  customer,
  config,
  driverProfile,
  orders,
  supportTickets,
  referrals,
  driverOffers,
  pendingApprovalCount,
  orderCount,
  supportText,
  submittingSupportTicket,
  creatingReferral,
  offerActionId,
  onRefreshSupportTickets,
  onRefreshReferrals,
  onRefreshDriverOffers,
  onCreateSupportTicket,
  onCreateReferral,
  onRespondToOffer,
}: {
  appRole: MiniAppRole;
  customer: MiniAppCustomer | null;
  config: MiniAppConfig | null;
  driverProfile: MiniAppDriverProfile | null;
  orders: MiniAppOrder[];
  supportTickets: SupportTicketSummary[];
  referrals: ReferralSummary[];
  driverOffers: MiniAppDriverOffer[];
  pendingApprovalCount: number;
  orderCount: number;
  supportText: string;
  submittingSupportTicket: boolean;
  creatingReferral: boolean;
  offerActionId: number | null;
  onRefreshSupportTickets: () => void;
  onRefreshReferrals: () => void;
  onRefreshDriverOffers: () => void;
  onCreateSupportTicket: (
    subject: string,
    message: string,
    category: string,
    priority: string,
    orderNumber?: string,
  ) => Promise<boolean>;
  onCreateReferral: (aliasUsername?: string, aliasEmail?: string, notes?: string) => Promise<boolean>;
  onRespondToOffer: (offerId: number, action: 'accept' | 'decline') => void;
}) {
  if (appRole === 'driver') {
    return (
      <section className="view-stack">
        <div className="feature-grid">
          <article className="surface feature-panel">
            <p className="eyebrow">Driver</p>
            <h2>{driverProfile?.name || customer?.display_name || 'Private Driver'}</h2>
            <p className="muted-copy">
              {config?.contact.welcome_message || 'Your private driver workspace is active inside Telegram.'}
            </p>
            <dl className="detail-grid">
              <DetailItem label="Invite" value={customer?.invite_code || 'Pending'} />
              <DetailItem label="Status" value={driverProfile?.is_online ? 'Online' : 'Offline'} />
              <DetailItem
                label="Modes"
                value={[
                  driverProfile?.accepts_delivery ? 'Delivery' : null,
                  driverProfile?.accepts_pickup ? 'Pickup' : null,
                ].filter(Boolean).join(' / ') || 'Unavailable'}
              />
              <DetailItem
                label="Pickup Hub"
                value={driverProfile?.pickup_address?.name || 'Unassigned'}
              />
              <DetailItem
                label="Working Hours"
                value={driverProfile?.working_hours_summary || 'Always available'}
              />
            </dl>
          </article>

          <article className="surface stats-panel">
            <StatTile label="Assigned" value={`${driverProfile?.active_orders || 0}`} />
            <StatTile label="Pending Offers" value={`${driverOffers.length}`} />
            <StatTile label="Delivered" value={`${driverProfile?.delivered_orders || 0}`} tone="olive" />
            <StatTile
              label="Capacity"
              value={`${driverProfile?.active_orders || 0}/${driverProfile?.max_concurrent_orders || 1}`}
              tone="warning"
            />
          </article>
        </div>

        <DriverOffersPanel
          offers={driverOffers}
          respondingOfferId={offerActionId}
          onRefresh={onRefreshDriverOffers}
          onRespond={onRespondToOffer}
        />

        <article className="surface support-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Dispatch</p>
              <h3>Coordinator contact</h3>
            </div>
          </div>
          <p className="muted-copy">{supportText}</p>
        </article>

        <SupportPanel
          appRole={appRole}
          tickets={supportTickets}
          orders={orders}
          submitting={submittingSupportTicket}
          onRefresh={onRefreshSupportTickets}
          onCreate={onCreateSupportTicket}
        />
      </section>
    );
  }

  return (
    <section className="view-stack">
      <div className="feature-grid">
        <article className="surface feature-panel">
          <p className="eyebrow">Welcome</p>
          <h2>{customer?.display_name || 'Private Member'}</h2>
          <p className="muted-copy">
            {config?.contact.welcome_message || 'Your private delivery access is active.'}
          </p>
          <dl className="detail-grid">
            <DetailItem label="Invite" value={customer?.invite_code || 'Pending'} />
            <DetailItem
              label="Alias"
              value={customer?.alias_username || customer?.alias_email || customer?.display_name || 'Not set'}
            />
          </dl>
        </article>

        <article className="surface stats-panel">
          <StatTile label="Orders" value={`${orderCount}`} />
          <StatTile label="Pending Approval" value={`${pendingApprovalCount}`} tone="warning" />
          <StatTile label="BTC Discount" value={`${config?.btc_discount_percent || 0}%`} tone="olive" />
        </article>
      </div>

      <article className="surface support-panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">Support</p>
            <h3>Dispatcher contact</h3>
          </div>
        </div>
        <p className="muted-copy">{supportText}</p>
      </article>

      <div className="feature-grid">
        <ReferralPanel
          referrals={referrals}
          creating={creatingReferral}
          onRefresh={onRefreshReferrals}
          onCreate={onCreateReferral}
        />
        <SupportPanel
          appRole={appRole}
          tickets={supportTickets}
          orders={orders}
          submitting={submittingSupportTicket}
          onRefresh={onRefreshSupportTickets}
          onCreate={onCreateSupportTicket}
        />
      </div>
    </section>
  );
}

function DriverOffersPanel({
  offers,
  respondingOfferId,
  onRefresh,
  onRespond,
}: {
  offers: MiniAppDriverOffer[];
  respondingOfferId: number | null;
  onRefresh: () => void;
  onRespond: (offerId: number, action: 'accept' | 'decline') => void;
}) {
  return (
    <article className="surface">
      <div className="section-head">
        <div>
          <p className="eyebrow">Offer Queue</p>
          <h3>Pending dispatch offers</h3>
        </div>
        <button className="secondary-button" onClick={onRefresh} type="button">
          Refresh
        </button>
      </div>

      {offers.length ? (
        <div className="offer-stack">
          {offers.map((offer) => (
            <article key={offer.id} className="offer-card">
              <div className="section-head compact">
                <div>
                  <p className="eyebrow">{offer.order_number || `Offer ${offer.id}`}</p>
                  <h4>{humanize(offer.delivery_or_pickup || 'dispatch')}</h4>
                </div>
                <StatusPill tone={offer.status}>{humanize(offer.status)}</StatusPill>
              </div>

              <dl className="detail-grid">
                <DetailItem label="Destination" value={offer.destination || 'Pending destination'} />
                <DetailItem label="Total" value={formatCurrency(offer.total_cents || 0)} />
                <DetailItem label="Offer #" value={`${offer.sequence_number}`} />
                <DetailItem label="Respond By" value={formatDateTime(offer.expires_at)} />
              </dl>

              <div className="row-actions">
                <button
                  className="primary-button compact-button"
                  disabled={respondingOfferId === offer.id}
                  onClick={() => onRespond(offer.id, 'accept')}
                  type="button"
                >
                  {respondingOfferId === offer.id ? 'Updating…' : 'Accept'}
                </button>
                <button
                  className="ghost-button compact-button"
                  disabled={respondingOfferId === offer.id}
                  onClick={() => onRespond(offer.id, 'decline')}
                  type="button"
                >
                  Decline
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptySurface title="No pending offers" copy="New dispatch offers will appear here with accept and decline controls." compact />
      )}
    </article>
  );
}

function SupportPanel({
  appRole,
  tickets,
  orders,
  submitting,
  onRefresh,
  onCreate,
}: {
  appRole: MiniAppRole;
  tickets: SupportTicketSummary[];
  orders: MiniAppOrder[];
  submitting: boolean;
  onRefresh: () => void;
  onCreate: (
    subject: string,
    message: string,
    category: string,
    priority: string,
    orderNumber?: string,
  ) => Promise<boolean>;
}) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState('normal');
  const [orderNumber, setOrderNumber] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await onCreate(subject.trim(), message.trim(), category, priority, orderNumber || undefined);
    if (created) {
      setSubject('');
      setMessage('');
      setCategory('general');
      setPriority('normal');
      setOrderNumber('');
    }
  }

  return (
    <article className="surface">
      <div className="section-head">
        <div>
          <p className="eyebrow">Support Queue</p>
          <h3>{appRole === 'driver' ? 'Driver issues and dispatch questions' : 'Order and account support'}</h3>
        </div>
        <button className="secondary-button" onClick={onRefresh} type="button">
          Refresh
        </button>
      </div>

      <form className="stack" onSubmit={handleSubmit}>
        <label className="field">
          <span>Subject</span>
          <input
            maxLength={120}
            placeholder="Short summary"
            required
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        </label>

        <div className="support-form-grid">
          <label className="field">
            <span>Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="general">General</option>
              <option value="payment">Payment</option>
              <option value="dispatch">Dispatch</option>
              <option value="pickup">Pickup</option>
              <option value="technical">Technical</option>
            </select>
          </label>
          <label className="field">
            <span>Priority</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
        </div>

        <label className="field">
          <span>Related order</span>
          <select value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)}>
            <option value="">No order selected</option>
            {orders.map((order) => (
              <option key={`support-order-${order.order_number}`} value={order.order_number}>
                {order.order_number} • {humanize(order.delivery_or_pickup)} • {humanize(order.status)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Message</span>
          <textarea
            placeholder="Describe the issue, timing, and what you need from dispatch."
            required
            rows={4}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>

        <button
          className="primary-button"
          disabled={submitting || !subject.trim() || !message.trim()}
          type="submit"
        >
          {submitting ? 'Sending…' : 'Open Support Ticket'}
        </button>
      </form>

      <div className="detail-block">
        <h4>Recent tickets</h4>
        {tickets.length ? (
          <div className="ticket-stack">
            {tickets.map((ticket) => (
              <article key={ticket.id} className="ticket-card">
                <div className="section-head compact">
                  <div>
                    <strong>{ticket.subject}</strong>
                    <p className="helper-text">
                      {humanize(ticket.category)} • {humanize(ticket.priority)} • {formatDateTime(ticket.created_at)}
                    </p>
                  </div>
                  <StatusPill tone={ticket.status}>{humanize(ticket.status)}</StatusPill>
                </div>
                <p className="helper-text">{ticket.message}</p>
                {ticket.resolution_note ? (
                  <p className="helper-text">Resolution: {ticket.resolution_note}</p>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptySurface title="No support tickets yet" copy="New tickets you create here will show status updates from the admin queue." compact />
        )}
      </div>
    </article>
  );
}

function ReferralPanel({
  referrals,
  creating,
  onRefresh,
  onCreate,
}: {
  referrals: ReferralSummary[];
  creating: boolean;
  onRefresh: () => void;
  onCreate: (aliasUsername?: string, aliasEmail?: string, notes?: string) => Promise<boolean>;
}) {
  const [aliasUsername, setAliasUsername] = useState('');
  const [aliasEmail, setAliasEmail] = useState('');
  const [notes, setNotes] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await onCreate(
      aliasUsername.trim() || undefined,
      aliasEmail.trim() || undefined,
      notes.trim() || undefined,
    );
    if (created) {
      setAliasUsername('');
      setAliasEmail('');
      setNotes('');
    }
  }

  return (
    <article className="surface">
      <div className="section-head">
        <div>
          <p className="eyebrow">Referrals</p>
          <h3>Create a private invite</h3>
        </div>
        <button className="secondary-button" onClick={onRefresh} type="button">
          Refresh
        </button>
      </div>

      <form className="stack" onSubmit={handleSubmit}>
        <label className="field">
          <span>Alias username</span>
          <input
            placeholder="private_member"
            value={aliasUsername}
            onChange={(event) => setAliasUsername(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Alias email</span>
          <input
            placeholder="member@example.com"
            value={aliasEmail}
            onChange={(event) => setAliasEmail(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Internal note</span>
          <textarea
            placeholder="Reference name, relationship, or use case"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        <button className="primary-button" disabled={creating} type="submit">
          {creating ? 'Creating…' : 'Create Referral Invite'}
        </button>
      </form>

      <div className="detail-block">
        <h4>Referral ledger</h4>
        {referrals.length ? (
          <div className="ticket-stack">
            {referrals.map((referral) => (
              <article key={referral.id} className="ticket-card">
                <div className="section-head compact">
                  <div>
                    <strong>{referral.invite_code || 'Pending code'}</strong>
                    <p className="helper-text">{formatDateTime(referral.created_at)}</p>
                  </div>
                  <StatusPill tone={referral.status}>{humanize(referral.status)}</StatusPill>
                </div>
                <p className="helper-text">
                  Reward: {humanize(referral.reward_status)} {referral.referred_name ? `• Claimed by ${referral.referred_name}` : ''}
                </p>
                {referral.notes ? <p className="helper-text">{referral.notes}</p> : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptySurface title="No referrals yet" copy="Generate a private invite here and track when it gets claimed." compact />
        )}
      </div>
    </article>
  );
}

function MenuView({
  groupedMenu,
  menuSearch,
  onMenuSearch,
  onRefresh,
  onAddToCart,
}: {
  groupedMenu: Record<string, MenuItem[]>;
  menuSearch: string;
  onMenuSearch: (value: string) => void;
  onRefresh: () => void;
  onAddToCart: (item: MenuItem) => void;
}) {
  const categories = Object.entries(groupedMenu);

  return (
    <section className="view-stack">
      <article className="surface">
        <div className="section-head">
          <div>
            <p className="eyebrow">Menu</p>
            <h2>Live storefront inventory</h2>
          </div>
          <button className="secondary-button" onClick={onRefresh}>
            Refresh
          </button>
        </div>

        <div className="toolbar">
          <input
            className="search-input"
            placeholder="Search menu"
            value={menuSearch}
            onChange={(event) => onMenuSearch(event.target.value)}
          />
        </div>
      </article>

      {categories.length ? (
        <div className="menu-sections">
          {categories.map(([category, items]) => (
            <article key={category} className="surface menu-section">
              <div className="section-head compact">
                <div>
                  <p className="eyebrow">{category}</p>
                  <h3>{items.length} available</h3>
                </div>
              </div>

              <div className="item-stack">
                {items.map((item) => (
                  <article key={item.id} className="menu-item-card">
                    <div className="menu-item-topline">
                      <span className="chip">{category}</span>
                      <span className="badge">{item.available_qty} available</span>
                    </div>
                    <div className="menu-item-copy">
                      <h4>{item.name}</h4>
                      <p>{item.description || 'No description provided yet.'}</p>
                    </div>
                    <div className="menu-item-footer">
                      <strong>{formatCurrency(item.price_cents)}</strong>
                      <button
                        className="primary-button compact-button"
                        disabled={item.available_qty <= 0}
                        onClick={() => onAddToCart(item)}
                      >
                        {item.available_qty <= 0 ? 'Out of stock' : 'Add'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptySurface
          title="No menu items found"
          copy="Try a different search term or refresh the storefront inventory."
        />
      )}
    </section>
  );
}

function OrdersView({
  appRole,
  orders,
  busyOrderNumber,
  pickupEtaBusyOrderNumber,
  pickupPhotoBusyOrderNumber,
  onRefresh,
  onDriverStatusChange,
  onPickupEtaUpdate,
  onPickupArrivalUpload,
}: {
  appRole: MiniAppRole;
  orders: MiniAppOrder[];
  busyOrderNumber: string;
  pickupEtaBusyOrderNumber: string;
  pickupPhotoBusyOrderNumber: string;
  onRefresh: () => void;
  onDriverStatusChange: (orderNumber: string, status: 'out_for_delivery' | 'delivered') => Promise<void>;
  onPickupEtaUpdate: (orderNumber: string, etaMinutes: number, note?: string) => Promise<void>;
  onPickupArrivalUpload: (orderNumber: string, photo: File, parkingNote?: string) => Promise<void>;
}) {
  async function handlePickupEtaSubmit(event: FormEvent<HTMLFormElement>, orderNumber: string) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const etaMinutes = Number(formData.get('eta_minutes'));
    const note = String(formData.get('note') || '');
    if (!Number.isFinite(etaMinutes) || etaMinutes < 1) {
      return;
    }

    await onPickupEtaUpdate(orderNumber, etaMinutes, note);
    event.currentTarget.reset();
  }

  async function handlePickupArrivalSubmit(event: FormEvent<HTMLFormElement>, orderNumber: string) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const photo = formData.get('photo');
    if (!(photo instanceof File) || photo.size <= 0) {
      return;
    }

    await onPickupArrivalUpload(orderNumber, photo, String(formData.get('parking_note') || ''));
    event.currentTarget.reset();
  }

  if (appRole === 'driver') {
    return (
      <section className="view-stack">
        <article className="surface">
          <div className="section-head">
            <div>
              <p className="eyebrow">Orders</p>
              <h2>Assigned dispatch queue</h2>
            </div>
            <button className="secondary-button" onClick={onRefresh}>
              Refresh
            </button>
          </div>
        </article>

        {orders.length ? (
          <div className="order-list">
            {orders.map((order) => {
              const canStartDelivery = ['assigned', 'preparing', 'ready', 'scheduled'].includes(order.status);
              const canCompleteDelivery = order.status === 'out_for_delivery';
              const destination = order.delivery_address_text || order.pickup_address_text || 'Pending';
              const isBusy = busyOrderNumber === order.order_number;
              return (
                <article key={order.order_number} className="surface order-card">
                  <div className="section-head compact">
                    <div>
                      <p className="eyebrow">{order.order_number}</p>
                      <h3>{formatCurrency(order.total_cents)}</h3>
                    </div>
                    <div className="status-row">
                      <StatusPill tone={order.status}>{humanize(order.status)}</StatusPill>
                      <StatusPill tone={order.payment_confirmed ? 'approved' : 'pending'}>
                        {order.payment_confirmed ? 'Dispatch Cleared' : 'Awaiting Payment'}
                      </StatusPill>
                    </div>
                  </div>

                  <p className="muted-copy">{order.items.map((item) => `${item.name} x${item.quantity}`).join(', ')}</p>

                  <dl className="detail-grid">
                    <DetailItem label="Customer" value={order.customer_name || 'Unknown'} />
                    <DetailItem label="Phone" value={order.customer_phone || 'Not provided'} />
                    <DetailItem
                      label="Telegram ID"
                      value={order.customer_telegram_id ? String(order.customer_telegram_id) : 'Not provided'}
                    />
                    <DetailItem label="Type" value={humanize(order.delivery_or_pickup)} />
                    <DetailItem label="Destination" value={destination} />
                    <DetailItem label="Payment" value={order.payment_label} />
                    <DetailItem label="Created" value={formatDateTime(order.created_at)} />
                  </dl>

                  {order.notes ? <p className="helper-text">{order.notes}</p> : null}

                  {order.customer_phone || order.customer_telegram_id ? (
                    <div className="row-actions">
                      {order.customer_phone ? (
                        <>
                          <a
                            className="secondary-button compact-button action-link"
                            href={normalizePhoneHref(order.customer_phone)}
                          >
                            Call Customer
                          </a>
                          <button
                            className="ghost-button compact-button"
                            onClick={() => {
                              void copyText(order.customer_phone || '');
                            }}
                            type="button"
                          >
                            Copy Phone
                          </button>
                        </>
                      ) : null}
                      {order.customer_telegram_id ? (
                        <button
                          className="ghost-button compact-button"
                          onClick={() => {
                            void copyText(String(order.customer_telegram_id));
                          }}
                          type="button"
                        >
                          Copy Telegram ID
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {order.delivery_or_pickup === 'pickup' ? (
                    <div className="pickup-signal-panel">
                      <div className="section-head compact">
                        <div>
                          <p className="eyebrow">Pickup Signal</p>
                          <h4>{formatPickupEtaValue(order)}</h4>
                        </div>
                        <span className="badge">
                          {order.latest_pickup_arrival_photo ? 'Arrival photo uploaded' : 'Waiting on arrival photo'}
                        </span>
                      </div>

                      {order.latest_pickup_eta?.note ? (
                        <p className="helper-text">Latest customer note: {order.latest_pickup_eta.note}</p>
                      ) : null}

                      {order.latest_pickup_arrival_photo ? (
                        <div className="pickup-proof">
                          <img
                            className="pickup-proof-image"
                            src={order.latest_pickup_arrival_photo.photo_url}
                            alt={`Pickup proof for ${order.order_number}`}
                          />
                          <div className="stack">
                            <p className="helper-text">
                              Uploaded {formatDateTime(order.latest_pickup_arrival_photo.created_at)} by{' '}
                              {order.latest_pickup_arrival_photo.customer_name
                                || order.latest_pickup_arrival_photo.customer_telegram_id
                                || 'customer'}
                              .
                            </p>
                            {order.latest_pickup_arrival_photo.parking_note ? (
                              <p className="helper-text">
                                Parking note: {order.latest_pickup_arrival_photo.parking_note}
                              </p>
                            ) : null}
                            <a
                              className="pickup-proof-link"
                              href={order.latest_pickup_arrival_photo.photo_url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Open full image
                            </a>
                          </div>
                        </div>
                      ) : (
                        <p className="helper-text">The customer has not uploaded arrival proof yet.</p>
                      )}
                    </div>
                  ) : null}

                  <div className="row-actions">
                    {canStartDelivery ? (
                      <button
                        className="primary-button compact-button"
                        disabled={isBusy || !order.payment_confirmed}
                        onClick={() => onDriverStatusChange(order.order_number, 'out_for_delivery')}
                      >
                        {isBusy ? 'Updating…' : 'Start Delivery'}
                      </button>
                    ) : null}
                    {canCompleteDelivery ? (
                      <button
                        className="secondary-button compact-button"
                        disabled={isBusy}
                        onClick={() => onDriverStatusChange(order.order_number, 'delivered')}
                      >
                        {isBusy ? 'Updating…' : 'Mark Delivered'}
                      </button>
                    ) : null}
                    {!order.payment_confirmed ? (
                      <span className="helper-text">Dispatch is blocked until payment is approved.</span>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptySurface title="No assigned orders" copy="When dispatch assigns you an order, it will appear here." />
        )}
      </section>
    );
  }

  return (
    <section className="view-stack">
      <article className="surface">
        <div className="section-head">
          <div>
            <p className="eyebrow">Orders</p>
            <h2>Your recent activity</h2>
          </div>
          <button className="secondary-button" onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </article>

      {orders.length ? (
        <div className="order-list">
          {orders.map((order) => (
            <article key={order.order_number} className="surface order-card">
              <div className="section-head compact">
                <div>
                  <p className="eyebrow">{order.order_number}</p>
                  <h3>{formatCurrency(order.total_cents)}</h3>
                </div>
                <div className="status-row">
                  <StatusPill tone={order.status}>{humanize(order.status)}</StatusPill>
                  <StatusPill tone={order.payment_confirmed ? 'approved' : 'pending'}>
                    {order.payment_confirmed ? 'Payment Approved' : 'Awaiting Approval'}
                  </StatusPill>
                </div>
              </div>

              <p className="muted-copy">{order.items.map((item) => `${item.name} x${item.quantity}`).join(', ')}</p>

              <dl className="detail-grid">
                <DetailItem label="Payment" value={order.payment_label} />
                <DetailItem label="Type" value={humanize(order.delivery_or_pickup)} />
                <DetailItem
                  label="Destination"
                  value={order.delivery_address_text || order.pickup_address_text || 'Pending'}
                />
                <DetailItem label="Created" value={formatDateTime(order.created_at)} />
              </dl>

              {order.notes ? <p className="helper-text">{order.notes}</p> : null}

              {order.delivery_or_pickup === 'pickup' ? (
                <div className="pickup-signal-panel">
                  <div className="section-head compact">
                    <div>
                      <p className="eyebrow">Pickup Coordination</p>
                      <h4>{formatPickupEtaValue(order)}</h4>
                    </div>
                    <span className="badge">
                      {order.latest_pickup_arrival_photo ? 'Arrival photo on file' : 'Share arrival photo'}
                    </span>
                  </div>

                  {order.latest_pickup_eta?.note ? (
                    <p className="helper-text">Latest ETA note: {order.latest_pickup_eta.note}</p>
                  ) : (
                    <p className="helper-text">
                      Share your ETA and parking photo here so the driver can stage your pickup handoff.
                    </p>
                  )}

                  {order.latest_pickup_arrival_photo ? (
                    <div className="pickup-proof">
                      <img
                        className="pickup-proof-image"
                        src={order.latest_pickup_arrival_photo.photo_url}
                        alt={`Pickup proof for ${order.order_number}`}
                      />
                      <div className="stack">
                        <p className="helper-text">
                          Last uploaded {formatDateTime(order.latest_pickup_arrival_photo.created_at)}.
                        </p>
                        {order.latest_pickup_arrival_photo.parking_note ? (
                          <p className="helper-text">
                            Parking note: {order.latest_pickup_arrival_photo.parking_note}
                          </p>
                        ) : null}
                        <a
                          className="pickup-proof-link"
                          href={order.latest_pickup_arrival_photo.photo_url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open image
                        </a>
                      </div>
                    </div>
                  ) : null}

                  {['cancelled', 'delivered'].includes(order.status) ? (
                    <p className="helper-text">Pickup coordination is closed for this order.</p>
                  ) : (
                    <div className="pickup-action-grid">
                      <form
                        className="pickup-form"
                        onSubmit={(event) => void handlePickupEtaSubmit(event, order.order_number)}
                      >
                        <label className="field">
                          <span>ETA in minutes</span>
                          <input defaultValue={15} max={240} min={1} name="eta_minutes" step={5} type="number" />
                        </label>
                        <label className="field">
                          <span>ETA note</span>
                          <textarea
                            name="note"
                            placeholder="Gate, vehicle, or timing note"
                            rows={2}
                          />
                        </label>
                        <button
                          className="secondary-button compact-button"
                          disabled={pickupEtaBusyOrderNumber === order.order_number}
                          type="submit"
                        >
                          {pickupEtaBusyOrderNumber === order.order_number ? 'Sending…' : 'Share ETA'}
                        </button>
                      </form>

                      <form
                        className="pickup-form"
                        onSubmit={(event) => void handlePickupArrivalSubmit(event, order.order_number)}
                      >
                        <label className="field">
                          <span>Arrival photo</span>
                          <input accept="image/*" name="photo" required type="file" />
                        </label>
                        <label className="field">
                          <span>Parking note</span>
                          <textarea
                            name="parking_note"
                            placeholder="Parking lot, vehicle color, or landmark"
                            rows={2}
                          />
                        </label>
                        <button
                          className="primary-button compact-button"
                          disabled={pickupPhotoBusyOrderNumber === order.order_number}
                          type="submit"
                        >
                          {pickupPhotoBusyOrderNumber === order.order_number ? 'Uploading…' : 'Upload Arrival Proof'}
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <EmptySurface title="No orders yet" copy="Build a cart from the menu tab and place your first Mini App order." />
      )}
    </section>
  );
}

function AccountView({
  appRole,
  customer,
  driverProfile,
  supportText,
  addresses,
  newAddressLabel,
  newAddressText,
  newAddressDefault,
  savingAddress,
  savingDriverProfile,
  onNewAddressLabel,
  onNewAddressText,
  onNewAddressDefault,
  onSaveAddress,
  onSetDefaultAddress,
  onDeleteAddress,
  onDriverProfileChange,
  onLogout,
}: {
  appRole: MiniAppRole;
  customer: MiniAppCustomer | null;
  driverProfile: MiniAppDriverProfile | null;
  supportText: string;
  addresses: CustomerAddress[];
  newAddressLabel: string;
  newAddressText: string;
  newAddressDefault: boolean;
  savingAddress: boolean;
  savingDriverProfile: boolean;
  onNewAddressLabel: (value: string) => void;
  onNewAddressText: (value: string) => void;
  onNewAddressDefault: (value: boolean) => void;
  onSaveAddress: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSetDefaultAddress: (addressId: number) => void;
  onDeleteAddress: (addressId: number) => void;
  onDriverProfileChange: (
    patch: Partial<Pick<MiniAppDriverProfile, 'is_online' | 'accepts_delivery' | 'accepts_pickup'>>,
  ) => void;
  onLogout: () => void;
}) {
  if (appRole === 'driver') {
    return (
      <section className="view-stack">
        <article className="surface">
          <div className="section-head">
            <div>
              <p className="eyebrow">Account</p>
              <h2>Private driver profile</h2>
            </div>
            <button className="secondary-button" onClick={onLogout}>
              Logout
            </button>
          </div>
          <dl className="detail-grid">
            <DetailItem label="Invite" value={customer?.invite_code || 'Pending'} />
            <DetailItem label="Role" value={humanize(appRole)} />
            <DetailItem label="Status" value={driverProfile?.is_online ? 'Online' : 'Offline'} />
            <DetailItem label="Last Login" value={formatDateTime(customer?.last_login_at)} />
          </dl>
        </article>

        <div className="feature-grid account-grid">
          <article className="surface">
            <div className="section-head compact">
              <div>
                <p className="eyebrow">Availability</p>
                <h3>Dispatch controls</h3>
              </div>
            </div>

            <div className="driver-toggle-grid">
              <button
                className={`toggle-button ${driverProfile?.is_online ? 'active' : ''}`}
                disabled={savingDriverProfile}
                onClick={() => onDriverProfileChange({ is_online: !driverProfile?.is_online })}
                type="button"
              >
                {driverProfile?.is_online ? 'Online' : 'Offline'}
              </button>
              <button
                className={`toggle-button ${driverProfile?.accepts_delivery ? 'active' : ''}`}
                disabled={savingDriverProfile}
                onClick={() => onDriverProfileChange({ accepts_delivery: !driverProfile?.accepts_delivery })}
                type="button"
              >
                Delivery
              </button>
              <button
                className={`toggle-button ${driverProfile?.accepts_pickup ? 'active' : ''}`}
                disabled={savingDriverProfile}
                onClick={() => onDriverProfileChange({ accepts_pickup: !driverProfile?.accepts_pickup })}
                type="button"
              >
                Pickup
              </button>
            </div>

            <dl className="detail-grid">
              <DetailItem label="Capacity" value={`${driverProfile?.max_concurrent_orders || 1} active orders`} />
              <DetailItem label="Range" value={`${driverProfile?.max_delivery_distance_miles || 15} mi`} />
              <DetailItem
                label="Pickup Hub"
                value={driverProfile?.pickup_address ? `${driverProfile.pickup_address.name}` : 'Not assigned'}
              />
              <DetailItem label="Hub Address" value={driverProfile?.pickup_address?.address || 'Not assigned'} />
            </dl>
          </article>

          <article className="surface">
            <div className="section-head compact">
              <div>
                <p className="eyebrow">Support</p>
                <h3>Dispatch contact</h3>
              </div>
            </div>
            <p className="muted-copy">{supportText}</p>
          </article>
        </div>
      </section>
    );
  }

  return (
    <section className="view-stack">
      <article className="surface">
        <div className="section-head">
          <div>
            <p className="eyebrow">Account</p>
            <h2>Private member profile</h2>
          </div>
          <button className="secondary-button" onClick={onLogout}>
            Logout
          </button>
        </div>
        <dl className="detail-grid">
          <DetailItem label="Invite" value={customer?.invite_code || 'Pending'} />
          <DetailItem label="Status" value={humanize(customer?.account_status || 'active')} />
          <DetailItem
            label="Alias"
            value={customer?.alias_username || customer?.alias_email || customer?.display_name || 'Not set'}
          />
          <DetailItem label="Last Login" value={formatDateTime(customer?.last_login_at)} />
        </dl>
      </article>

      <div className="feature-grid account-grid">
        <article className="surface">
          <div className="section-head compact">
            <div>
              <p className="eyebrow">Addresses</p>
              <h3>Saved delivery spots</h3>
            </div>
          </div>

          <div className="address-stack">
            {addresses.length ? (
              addresses.map((address) => (
                <article key={address.id} className="address-card">
                  <div className="section-head compact">
                    <div>
                      <h4>{address.label || 'Address'}</h4>
                      <p>{address.address_text}</p>
                    </div>
                    {address.is_default ? <StatusPill tone="approved">Default</StatusPill> : null}
                  </div>

                  <div className="row-actions">
                    {!address.is_default ? (
                      <button className="secondary-button compact-button" onClick={() => onSetDefaultAddress(address.id)}>
                        Set Default
                      </button>
                    ) : null}
                    <button className="ghost-button compact-button" onClick={() => onDeleteAddress(address.id)}>
                      Delete
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <EmptySurface title="No addresses yet" copy="Add a saved address so delivery fee calculation can reuse it." compact />
            )}
          </div>
        </article>

        <article className="surface">
          <div className="section-head compact">
            <div>
              <p className="eyebrow">Add Address</p>
              <h3>Save a delivery location</h3>
            </div>
          </div>

          <form className="stack" onSubmit={onSaveAddress}>
            <label className="field">
              <span>Label</span>
              <input value={newAddressLabel} onChange={(event) => onNewAddressLabel(event.target.value)} />
            </label>
            <label className="field">
              <span>Address</span>
              <textarea
                rows={5}
                value={newAddressText}
                onChange={(event) => onNewAddressText(event.target.value)}
                placeholder="Enter full delivery address"
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={newAddressDefault}
                onChange={(event) => onNewAddressDefault(event.target.checked)}
              />
              <span>Set as default</span>
            </label>
            <button className="primary-button" disabled={savingAddress || !newAddressText.trim()} type="submit">
              {savingAddress ? 'Saving…' : 'Save Address'}
            </button>
          </form>
        </article>
      </div>
    </section>
  );
}

function CartView({
  cart,
  subtotalCents,
  totalCents,
  deliveryFeeCents,
  deliveryZone,
  deliveryMode,
  deliveryAddressId,
  manualAddress,
  pickupAddressId,
  paymentType,
  deliverySlot,
  notes,
  addresses,
  pickupLocations,
  placingOrder,
  onDeliveryMode,
  onDeliveryAddressChange,
  onManualAddressChange,
  onPickupAddressChange,
  onPaymentType,
  onDeliverySlot,
  onNotes,
  onQuantityChange,
  onClearCart,
  onSubmit,
}: {
  cart: CartItem[];
  subtotalCents: number;
  totalCents: number;
  deliveryFeeCents: number;
  deliveryZone: string;
  deliveryMode: DeliveryMode;
  deliveryAddressId: string;
  manualAddress: string;
  pickupAddressId: string;
  paymentType: PaymentType;
  deliverySlot: string;
  notes: string;
  addresses: CustomerAddress[];
  pickupLocations: PickupLocation[];
  placingOrder: boolean;
  onDeliveryMode: (value: DeliveryMode) => void;
  onDeliveryAddressChange: (value: string) => void;
  onManualAddressChange: (value: string) => void;
  onPickupAddressChange: (value: string) => void;
  onPaymentType: (value: PaymentType) => void;
  onDeliverySlot: (value: string) => void;
  onNotes: (value: string) => void;
  onQuantityChange: (menuId: number, delta: number) => void;
  onClearCart: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <article className="surface cart-panel">
      <div className="section-head compact">
        <div>
          <p className="eyebrow">Checkout</p>
          <h2>Your cart</h2>
        </div>
          <button className="ghost-button compact-button" onClick={onClearCart} type="button">
            Clear
          </button>
      </div>

      <div className="cart-items">
        {cart.length ? (
          cart.map((item) => (
            <article key={item.menu_id} className="cart-line">
              <div>
                <strong>{item.name}</strong>
                <p>{formatCurrency(item.price_cents)} each</p>
              </div>
              <div className="quantity-control">
                <button className="ghost-button quantity-button" onClick={() => onQuantityChange(item.menu_id, -1)} type="button">
                  -
                </button>
                <span>{item.quantity}</span>
                <button className="ghost-button quantity-button" onClick={() => onQuantityChange(item.menu_id, 1)} type="button">
                  +
                </button>
              </div>
            </article>
          ))
        ) : (
          <EmptySurface title="Cart is empty" copy="Add items from the menu tab to begin checkout." compact />
        )}
      </div>

      <form className="stack checkout-form" onSubmit={onSubmit}>
        <div className="toggle-row">
          <button
            className={`toggle-button ${deliveryMode === 'delivery' ? 'active' : ''}`}
            onClick={() => onDeliveryMode('delivery')}
            type="button"
          >
            Delivery
          </button>
          <button
            className={`toggle-button ${deliveryMode === 'pickup' ? 'active' : ''}`}
            onClick={() => onDeliveryMode('pickup')}
            type="button"
          >
            Pickup
          </button>
        </div>

        {deliveryMode === 'delivery' ? (
          <div className="stack">
            <label className="field">
              <span>Saved address</span>
              <select value={deliveryAddressId} onChange={(event) => onDeliveryAddressChange(event.target.value)}>
                <option value="">Use manual address</option>
                {addresses.map((address) => (
                  <option key={address.id} value={address.id}>
                    {address.label || 'Address'}
                    {address.is_default ? ' (Default)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Manual address</span>
              <textarea
                rows={4}
                value={manualAddress}
                onChange={(event) => onManualAddressChange(event.target.value)}
                placeholder="Enter delivery address for this order"
              />
            </label>
          </div>
        ) : (
          <label className="field">
            <span>Pickup location</span>
            <select value={pickupAddressId} onChange={(event) => onPickupAddressChange(event.target.value)}>
              {pickupLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name} - {location.address}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          <span>Payment method</span>
          <select value={paymentType} onChange={(event) => onPaymentType(event.target.value as PaymentType)}>
            <option value="cash">Cash</option>
            <option value="cashapp">Cash App</option>
            <option value="apple_cash">Apple Cash</option>
            <option value="btc">Bitcoin</option>
          </select>
        </label>

        <label className="field">
          <span>Requested time</span>
          <input type="datetime-local" value={deliverySlot} onChange={(event) => onDeliverySlot(event.target.value)} />
        </label>

        <label className="field">
          <span>Notes</span>
          <textarea
            rows={4}
            value={notes}
            onChange={(event) => onNotes(event.target.value)}
            placeholder="Door code, parking notes, or pickup preference"
          />
        </label>

        <div className="summary-box">
          <div>
            <span>Subtotal</span>
            <strong>{formatCurrency(subtotalCents)}</strong>
          </div>
          <div>
            <span>Delivery fee</span>
            <strong>{formatCurrency(deliveryFeeCents)}</strong>
          </div>
          <div className="summary-total">
            <span>Total</span>
            <strong>{formatCurrency(totalCents)}</strong>
          </div>
          <p className="helper-text">
            {deliveryMode === 'pickup'
              ? 'Pickup orders still require payment approval before release.'
              : `Current delivery zone: ${deliveryZone}. Dispatch only starts after payment approval.`}
          </p>
        </div>

        <button className="primary-button" disabled={placingOrder || !cart.length} type="submit">
          {placingOrder ? 'Placing Order…' : 'Place Order'}
        </button>
      </form>
    </article>
  );
}

function StatTile({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'warning' | 'olive' }) {
  return (
    <article className={`stat-tile tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function StatusPill({ tone, children }: { tone: string; children: string }) {
  const normalizedTone =
    tone === 'approved' || tone === 'delivered' || tone === 'out_for_delivery'
      ? 'approved'
      : tone === 'pending' || tone === 'placed' || tone === 'assigned' || tone === 'preparing' || tone === 'ready' || tone === 'scheduled'
        ? 'pending'
        : tone === 'cancelled'
          ? 'cancelled'
          : 'neutral';

  return <span className={`status-pill ${normalizedTone}`}>{children}</span>;
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptySurface({ title, copy, compact = false }: { title: string; copy: string; compact?: boolean }) {
  return (
    <article className={`empty-surface ${compact ? 'compact' : ''}`}>
      <h3>{title}</h3>
      <p>{copy}</p>
    </article>
  );
}

export default App;
