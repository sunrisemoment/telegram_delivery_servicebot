// settings.js - Handles admin settings functionality

function loadSettingsTab() {
    return `
        <div class="content-header">
            <h1>⚙️ Settings</h1>
        </div>

        <div class="settings-container">
            <div class="alert success" id="settingsSuccessAlert"></div>
            <div class="alert error" id="settingsErrorAlert"></div>

            <!-- Payment Settings -->
            <div class="settings-section">
                <h2>Payment Settings</h2>
                <div class="settings-row">
                    <div class="settings-label">BTC Payment Discount (%)</div>
                    <div class="settings-value">
                        <input type="number" id="btcDiscountInput" min="0" max="100" step="1">
                        <button onclick="updateBtcDiscount()" id="updateBtcDiscountBtn">
                            Update
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function initSettingsPage() {
    try {
        showLoading();
        await loadBtcDiscount();
        hideLoading();
    } catch (error) {
        console.error('Error initializing settings page:', error);
        showNotification('Failed to load settings', 'error');
        hideLoading();
    }
}

async function loadBtcDiscount() {
    try {
        const response = await axios.get('/admin/settings/btc-discount');
        document.getElementById('btcDiscountInput').value = response.data.btc_discount_percent || 0;
    } catch (error) {
        console.error('Error loading BTC discount:', error);
        throw error;
    }
}

async function updateBtcDiscount() {
    const discountInput = document.getElementById('btcDiscountInput');
    const discount = parseInt(discountInput.value);

    if (isNaN(discount) || discount < 0 || discount > 100) {
        showNotification('Please enter a valid discount percentage (0-100)', 'error');
        return;
    }

    showLoading('Updating Payment Discount');

    try {
        const response = await axios.put('/admin/settings/btc-discount', {
            btc_discount_percent: discount
        });
        hideLoading();
        showNotification(`BTC discount updated to ${discount}%`, 'success');
    } catch (error) {
        console.error('Error updating BTC discount:', error);
        showNotification('Failed to update BTC discount', 'error');
        hideLoading();
    } finally {
        hideLoading();
    }
}