const tg = window.Telegram?.WebApp || null;

const state = {
    sessionToken: localStorage.getItem('miniappSessionToken') || '',
    cart: JSON.parse(localStorage.getItem('miniappCart') || '[]'),
    customer: null,
    config: null,
    menu: [],
    orders: [],
    addresses: [],
    pickupAddresses: [],
    deliveryType: 'delivery',
    deliveryFeeCents: 0,
    deliveryZone: 'Pickup',
};

document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    initTelegram();
    bootstrap();
});

function bindEvents() {
    document.getElementById('inviteForm').addEventListener('submit', onInviteSubmit);
    document.getElementById('addressForm').addEventListener('submit', onAddressSubmit);
    document.getElementById('checkoutForm').addEventListener('submit', onCheckoutSubmit);
    document.getElementById('refreshMenuButton').addEventListener('click', loadMenu);
    document.getElementById('refreshOrdersButton').addEventListener('click', loadOrders);
    document.getElementById('refreshFeeButton').addEventListener('click', refreshDeliveryFee);
    document.getElementById('clearCartButton').addEventListener('click', clearCart);
    document.getElementById('deliveryAddressSelect').addEventListener('change', refreshDeliveryFee);
    document.getElementById('pickupAddressSelect').addEventListener('change', refreshDeliveryFee);
    document.getElementById('manualAddressInput').addEventListener('blur', refreshDeliveryFee);

    document.querySelectorAll('.tab').forEach((button) => {
        button.addEventListener('click', () => setActiveTab(button.dataset.tab));
    });

    document.querySelectorAll('.pill').forEach((button) => {
        button.addEventListener('click', () => setDeliveryType(button.dataset.deliveryType));
    });

    document.getElementById('menuGrid').addEventListener('click', onMenuClick);
    document.getElementById('cartItems').addEventListener('click', onCartClick);
    document.getElementById('addressesList').addEventListener('click', onAddressClick);
}

function initTelegram() {
    if (!tg) {
        setAuthStatus('Open this page inside Telegram to authenticate.', true);
        return;
    }

    tg.ready();
    tg.expand();
    if (tg.themeParams?.bg_color) {
        document.documentElement.style.setProperty('--bg', tg.themeParams.bg_color);
    }
}

async function bootstrap() {
    const inviteInput = document.getElementById('inviteCodeInput');
    if (tg?.initDataUnsafe?.start_param) {
        inviteInput.value = tg.initDataUnsafe.start_param;
    }

    if (state.sessionToken) {
        try {
            await hydrateApp();
            return;
        } catch (error) {
            clearSession();
        }
    }

    if (!tg?.initData) {
        setAuthStatus('Telegram context is missing. Launch the Mini App from the bot.', true);
        return;
    }

    try {
        await authenticate(inviteInput.value.trim());
    } catch (error) {
        const parsed = extractError(error);
        if (parsed.code === 'invite_required') {
            setAuthStatus(parsed.message, false);
            showAuthScreen();
            return;
        }
        setAuthStatus(parsed.message || 'Authentication failed.', true);
    }
}

async function authenticate(inviteCode = '') {
    setAuthStatus('Authenticating with Telegram…');

    const response = await fetch('/miniapp-api/auth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            init_data: tg?.initData || '',
            invite_code: inviteCode || undefined,
        }),
    });
    const payload = await response.json();

    if (!response.ok) {
        throw payload;
    }

    state.sessionToken = payload.session_token;
    localStorage.setItem('miniappSessionToken', state.sessionToken);
    await hydrateApp(payload);
}

async function hydrateApp(authPayload = null) {
    if (authPayload?.customer) {
        state.customer = authPayload.customer;
    }

    const [config, menu, orders, addresses, pickupAddresses] = await Promise.all([
        apiRequest('/miniapp-api/config'),
        apiRequest('/miniapp-api/menu'),
        apiRequest('/miniapp-api/orders'),
        apiRequest('/miniapp-api/addresses'),
        apiRequest('/miniapp-api/pickup-addresses'),
    ]);

    state.config = config;
    state.customer = config.customer;
    state.menu = menu;
    state.orders = orders;
    state.addresses = addresses;
    state.pickupAddresses = pickupAddresses;

    renderEverything();
    showApp();
    await refreshDeliveryFee();
}

async function apiRequest(path, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
    };
    if (state.sessionToken) {
        headers.Authorization = `Bearer ${state.sessionToken}`;
    }

    const response = await fetch(path, {
        ...options,
        headers,
    });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();

    if (!response.ok) {
        if (response.status === 401) {
            clearSession();
            showAuthScreen();
        }
        throw payload;
    }

    return payload;
}

function renderEverything() {
    renderHero();
    renderHome();
    renderMenu();
    renderOrders();
    renderAddresses();
    renderCheckoutSelectors();
    renderCart();
}

function renderHero() {
    const customer = state.customer || {};
    document.getElementById('accountBadge').textContent = customer.account_status || 'Active';
    document.getElementById('heroSubtitle').textContent = customer.display_name
        ? `Signed in as ${customer.display_name}. Dispatch stays payment-gated until admin approval.`
        : 'Invite-only ordering inside Telegram.';
}

function renderHome() {
    const config = state.config || {};
    const customer = state.customer || {};
    const orders = state.orders || [];
    const pendingApproval = orders.filter((order) => !order.payment_confirmed && order.status !== 'cancelled').length;

    document.getElementById('welcomeTitle').textContent = customer.display_name || 'Welcome';
    document.getElementById('welcomeMessage').textContent =
        config.contact?.welcome_message || 'Your access is active. Use the menu tab to place an order.';
    document.getElementById('inviteCodeValue').textContent = customer.invite_code || 'Pending';
    document.getElementById('aliasValue').textContent = customer.alias_username || customer.alias_email || 'Not set';
    document.getElementById('orderCountStat').textContent = `${orders.length}`;
    document.getElementById('pendingApprovalStat').textContent = `${pendingApproval}`;
    document.getElementById('btcDiscountStat').textContent = `${config.btc_discount_percent || 0}%`;

    const supportParts = [
        config.contact?.telegram_username ? `Telegram: @${config.contact.telegram_username.replace(/^@/, '')}` : null,
        config.contact?.phone_number ? `Phone: ${config.contact.phone_number}` : null,
        config.contact?.email_address ? `Email: ${config.contact.email_address}` : null,
        config.contact?.additional_info || null,
    ].filter(Boolean);
    document.getElementById('supportInfo').textContent = supportParts.join(' • ') || 'Support contact not configured yet.';
}

function renderMenu() {
    const grid = document.getElementById('menuGrid');
    if (!state.menu.length) {
        grid.innerHTML = `<article class="card"><p class="muted">No active menu items are available right now.</p></article>`;
        return;
    }

    const grouped = {};
    state.menu.forEach((item) => {
        grouped[item.category] = grouped[item.category] || [];
        grouped[item.category].push(item);
    });

    grid.innerHTML = Object.entries(grouped).map(([category, items]) => `
        <section class="card">
            <div class="section-head compact">
                <div>
                    <p class="eyebrow">${category}</p>
                    <h3>${items.length} item${items.length === 1 ? '' : 's'}</h3>
                </div>
            </div>
            <div class="stack">
                ${items.map((item) => `
                    <article class="menu-card">
                        <div class="menu-meta">
                            <span class="chip">${category}</span>
                            <span class="badge">${item.available_qty} available</span>
                        </div>
                        <div>
                            <h3>${item.name}</h3>
                            <p class="muted">${item.description || 'No description provided.'}</p>
                        </div>
                        <div class="section-head compact">
                            <strong>${formatCurrency(item.price_cents)}</strong>
                            <button
                                class="btn btn-primary btn-small"
                                data-add-menu="${item.id}"
                                ${item.available_qty <= 0 ? 'disabled' : ''}
                            >
                                ${item.available_qty <= 0 ? 'Out' : 'Add'}
                            </button>
                        </div>
                    </article>
                `).join('')}
            </div>
        </section>
    `).join('');
}

function renderOrders() {
    const list = document.getElementById('ordersList');
    if (!state.orders.length) {
        list.innerHTML = `<article class="card"><p class="muted">No orders yet. Build your cart from the menu tab.</p></article>`;
        return;
    }

    list.innerHTML = state.orders.map((order) => `
        <article class="order-card">
            <div class="section-head compact">
                <div>
                    <p class="eyebrow">${order.order_number}</p>
                    <h3>${formatCurrency(order.total_cents)}</h3>
                </div>
                <div class="order-meta">
                    <span class="badge ${order.status}">${humanize(order.status)}</span>
                    <span class="badge ${order.payment_confirmed ? 'approved' : ''}">
                        ${order.payment_confirmed ? 'Payment Approved' : 'Awaiting Approval'}
                    </span>
                </div>
            </div>
            <p class="muted">${order.items.map((item) => `${item.name} x${item.quantity}`).join(', ')}</p>
            <div class="order-meta">
                <span>${order.payment_label}</span>
                <span>${humanize(order.delivery_or_pickup)}</span>
                <span>${formatDate(order.created_at)}</span>
            </div>
            ${order.notes ? `<p class="helper">${order.notes}</p>` : ''}
        </article>
    `).join('');
}

function renderAddresses() {
    const list = document.getElementById('addressesList');
    if (!state.addresses.length) {
        list.innerHTML = `<article class="address-card"><p class="muted">No saved addresses yet.</p></article>`;
    } else {
        list.innerHTML = state.addresses.map((address) => `
            <article class="address-card">
                <div class="section-head compact">
                    <div>
                        <h3>${address.label || 'Address'}</h3>
                        <p class="muted">${address.address_text}</p>
                    </div>
                    <div class="address-meta">
                        ${address.is_default ? '<span class="badge approved">Default</span>' : ''}
                    </div>
                </div>
                <div class="cart-item-actions">
                    ${!address.is_default ? `<button class="btn btn-ghost btn-small" data-address-default="${address.id}">Set default</button>` : ''}
                    <button class="btn btn-ghost btn-small" data-address-delete="${address.id}">Delete</button>
                </div>
            </article>
        `).join('');
    }

    renderCheckoutSelectors();
}

function renderCheckoutSelectors() {
    const deliverySelect = document.getElementById('deliveryAddressSelect');
    const pickupSelect = document.getElementById('pickupAddressSelect');

    deliverySelect.innerHTML = `
        <option value="">Use manual address</option>
        ${state.addresses.map((address) => `
            <option value="${address.id}" ${address.is_default ? 'selected' : ''}>
                ${address.label || 'Address'}${address.is_default ? ' (Default)' : ''}
            </option>
        `).join('')}
    `;

    pickupSelect.innerHTML = state.pickupAddresses.map((pickup) => `
        <option value="${pickup.id}">${pickup.name} - ${pickup.address}</option>
    `).join('');
}

function renderCart() {
    const cartItems = document.getElementById('cartItems');
    const checkoutForm = document.getElementById('checkoutForm');

    if (!state.cart.length) {
        cartItems.innerHTML = `<article class="cart-item"><p class="muted">Cart is empty. Add items from the menu tab.</p></article>`;
        checkoutForm.style.display = 'none';
    } else {
        checkoutForm.style.display = 'grid';
        cartItems.innerHTML = state.cart.map((item) => `
            <article class="cart-item">
                <div>
                    <strong>${item.name}</strong>
                    <p class="helper">${formatCurrency(item.price_cents)} each</p>
                </div>
                <div class="cart-item-actions">
                    <button class="icon-btn" data-cart-action="decrement" data-cart-id="${item.menu_id}">−</button>
                    <button class="icon-btn" disabled>${item.quantity}</button>
                    <button class="icon-btn" data-cart-action="increment" data-cart-id="${item.menu_id}">+</button>
                </div>
            </article>
        `).join('');
    }

    updateTotals();
    persistCart();
}

function updateTotals() {
    const subtotal = state.cart.reduce((total, item) => total + (item.price_cents * item.quantity), 0);
    const deliveryFee = state.deliveryType === 'pickup' ? 0 : state.deliveryFeeCents;
    const total = subtotal + deliveryFee;

    document.getElementById('subtotalValue').textContent = formatCurrency(subtotal);
    document.getElementById('deliveryFeeValue').textContent = formatCurrency(deliveryFee);
    document.getElementById('totalValue').textContent = formatCurrency(total);
    document.getElementById('checkoutHint').textContent =
        state.deliveryType === 'pickup'
            ? 'Pickup orders still require payment approval before release.'
            : `Current zone: ${state.deliveryZone}. Dispatch only starts after payment approval.`;
}

function persistCart() {
    localStorage.setItem('miniappCart', JSON.stringify(state.cart));
    document.getElementById('cartCard').classList.toggle('hidden', !state.sessionToken);
}

function showApp() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appContent').classList.remove('hidden');
    document.getElementById('cartCard').classList.remove('hidden');
    setActiveTab(state.activeTab || 'home');
}

function showAuthScreen() {
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('appContent').classList.add('hidden');
    document.getElementById('cartCard').classList.add('hidden');
}

function setAuthStatus(message, isError = false) {
    const status = document.getElementById('authStatus');
    status.textContent = message;
    status.style.color = isError ? '#8f2f21' : '';
}

function setActiveTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.tab').forEach((button) => {
        button.classList.toggle('active', button.dataset.tab === tab);
    });
    document.querySelectorAll('.panel').forEach((panel) => {
        panel.classList.toggle('active', panel.id === `${tab}Panel`);
    });
}

function setDeliveryType(type) {
    state.deliveryType = type;
    document.querySelectorAll('.pill').forEach((button) => {
        button.classList.toggle('active', button.dataset.deliveryType === type);
    });
    document.getElementById('deliveryFields').classList.toggle('hidden', type !== 'delivery');
    document.getElementById('pickupFields').classList.toggle('hidden', type !== 'pickup');
    refreshDeliveryFee();
}

function onMenuClick(event) {
    const button = event.target.closest('[data-add-menu]');
    if (!button) {
        return;
    }
    const menuId = Number(button.dataset.addMenu);
    const menuItem = state.menu.find((item) => item.id === menuId);
    if (!menuItem) {
        return;
    }
    const existing = state.cart.find((item) => item.menu_id === menuId);
    if (existing) {
        existing.quantity += 1;
    } else {
        state.cart.push({
            menu_id: menuItem.id,
            name: menuItem.name,
            price_cents: menuItem.price_cents,
            quantity: 1,
        });
    }
    renderCart();
    showToast(`${menuItem.name} added to cart`);
    tg?.HapticFeedback?.impactOccurred?.('light');
}

function onCartClick(event) {
    const button = event.target.closest('[data-cart-action]');
    if (!button) {
        return;
    }
    const menuId = Number(button.dataset.cartId);
    const item = state.cart.find((entry) => entry.menu_id === menuId);
    if (!item) {
        return;
    }

    if (button.dataset.cartAction === 'increment') {
        item.quantity += 1;
    } else {
        item.quantity -= 1;
        if (item.quantity <= 0) {
            state.cart = state.cart.filter((entry) => entry.menu_id !== menuId);
        }
    }
    renderCart();
}

function onAddressClick(event) {
    const defaultButton = event.target.closest('[data-address-default]');
    if (defaultButton) {
        setDefaultAddress(Number(defaultButton.dataset.addressDefault));
        return;
    }

    const deleteButton = event.target.closest('[data-address-delete]');
    if (deleteButton) {
        deleteAddress(Number(deleteButton.dataset.addressDelete));
    }
}

async function onInviteSubmit(event) {
    event.preventDefault();
    try {
        await authenticate(document.getElementById('inviteCodeInput').value.trim());
    } catch (error) {
        const parsed = extractError(error);
        setAuthStatus(parsed.message || 'Failed to activate invite.', true);
    }
}

async function onAddressSubmit(event) {
    event.preventDefault();
    try {
        await apiRequest('/miniapp-api/addresses', {
            method: 'POST',
            body: JSON.stringify({
                label: document.getElementById('addressLabel').value.trim() || 'Address',
                address_text: document.getElementById('addressText').value.trim(),
                is_default: document.getElementById('addressDefault').checked,
            }),
        });

        document.getElementById('addressForm').reset();
        await loadAddresses();
        showToast('Address saved');
    } catch (error) {
        showToast(extractError(error).message || 'Failed to save address', true);
    }
}

async function onCheckoutSubmit(event) {
    event.preventDefault();

    if (!state.cart.length) {
        showToast('Add items before checkout', true);
        return;
    }

    const deliveryAddressId = Number(document.getElementById('deliveryAddressSelect').value) || null;
    const manualAddress = document.getElementById('manualAddressInput').value.trim();
    const pickupAddressId = Number(document.getElementById('pickupAddressSelect').value) || null;

    if (state.deliveryType === 'delivery' && !deliveryAddressId && !manualAddress) {
        showToast('Select or enter a delivery address', true);
        return;
    }
    if (state.deliveryType === 'pickup' && !pickupAddressId) {
        showToast('Select a pickup location', true);
        return;
    }

    try {
        const payload = {
            items: state.cart.map((item) => ({
                menu_id: item.menu_id,
                name: item.name,
                quantity: item.quantity,
                price_cents: item.price_cents,
            })),
            delivery_or_pickup: state.deliveryType,
            delivery_address_id: deliveryAddressId,
            delivery_address_text: deliveryAddressId ? null : manualAddress,
            pickup_address_id: pickupAddressId,
            payment_type: document.getElementById('paymentTypeSelect').value,
            delivery_slot_et: document.getElementById('deliverySlotInput').value || null,
            notes: document.getElementById('orderNotesInput').value.trim() || null,
        };

        const result = await apiRequest('/miniapp-api/orders', {
            method: 'POST',
            body: JSON.stringify(payload),
        });

        state.cart = [];
        renderCart();
        document.getElementById('checkoutForm').reset();
        setDeliveryType('delivery');
        await loadOrders();
        showToast(result.message || 'Order created');
        tg?.HapticFeedback?.notificationOccurred?.('success');

        if (result.payment_url && confirm('Bitcoin payment generated. Open the payment link now?')) {
            if (tg?.openLink) {
                tg.openLink(result.payment_url);
            } else {
                window.open(result.payment_url, '_blank');
            }
        }
    } catch (error) {
        showToast(extractError(error).message || 'Failed to place order', true);
    }
}

async function loadMenu() {
    try {
        state.menu = await apiRequest('/miniapp-api/menu');
        renderMenu();
    } catch (error) {
        showToast(extractError(error).message || 'Failed to refresh menu', true);
    }
}

async function loadOrders() {
    try {
        state.orders = await apiRequest('/miniapp-api/orders');
        renderHome();
        renderOrders();
    } catch (error) {
        showToast(extractError(error).message || 'Failed to load orders', true);
    }
}

async function loadAddresses() {
    try {
        state.addresses = await apiRequest('/miniapp-api/addresses');
        renderAddresses();
        await refreshDeliveryFee();
    } catch (error) {
        showToast(extractError(error).message || 'Failed to load addresses', true);
    }
}

async function refreshDeliveryFee() {
    if (state.deliveryType === 'pickup') {
        state.deliveryFeeCents = 0;
        state.deliveryZone = 'Pickup';
        updateTotals();
        return;
    }

    const deliveryAddressId = Number(document.getElementById('deliveryAddressSelect').value) || null;
    const manualAddress = document.getElementById('manualAddressInput').value.trim();

    if (!deliveryAddressId && !manualAddress) {
        state.deliveryFeeCents = 0;
        state.deliveryZone = 'Awaiting address';
        updateTotals();
        return;
    }

    try {
        const fee = await apiRequest('/miniapp-api/delivery-fee', {
            method: 'POST',
            body: JSON.stringify({
                delivery_or_pickup: 'delivery',
                delivery_address_id: deliveryAddressId,
                delivery_address_text: deliveryAddressId ? null : manualAddress,
            }),
        });
        state.deliveryFeeCents = fee.delivery_fee_cents || 0;
        state.deliveryZone = fee.delivery_zone || 'Delivery';
        updateTotals();
    } catch (error) {
        state.deliveryFeeCents = 0;
        state.deliveryZone = 'Unavailable';
        updateTotals();
        showToast(extractError(error).message || 'Failed to calculate delivery fee', true);
    }
}

async function setDefaultAddress(addressId) {
    try {
        await apiRequest(`/miniapp-api/addresses/${addressId}/default`, {
            method: 'PUT',
        });
        await loadAddresses();
        showToast('Default address updated');
    } catch (error) {
        showToast(extractError(error).message || 'Failed to update default address', true);
    }
}

async function deleteAddress(addressId) {
    if (!confirm('Delete this address?')) {
        return;
    }
    try {
        await apiRequest(`/miniapp-api/addresses/${addressId}`, {
            method: 'DELETE',
        });
        await loadAddresses();
        showToast('Address deleted');
    } catch (error) {
        showToast(extractError(error).message || 'Failed to delete address', true);
    }
}

function clearCart() {
    state.cart = [];
    renderCart();
}

function clearSession() {
    state.sessionToken = '';
    localStorage.removeItem('miniappSessionToken');
}

function formatCurrency(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function formatDate(value) {
    if (!value) {
        return 'Unknown date';
    }
    return new Date(value).toLocaleString();
}

function humanize(value) {
    return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function extractError(error) {
    if (typeof error === 'string') {
        return { message: error };
    }
    const detail = error?.detail || error;
    if (typeof detail === 'string') {
        return { message: detail };
    }
    if (detail?.message || detail?.code) {
        return detail;
    }
    return { message: 'Unexpected request failure' };
}

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    toast.style.background = isError ? 'rgba(143, 47, 33, 0.94)' : 'rgba(28, 28, 23, 0.92)';
    window.clearTimeout(showToast._timer);
    showToast._timer = window.setTimeout(() => {
        toast.classList.add('hidden');
    }, 3200);
}
