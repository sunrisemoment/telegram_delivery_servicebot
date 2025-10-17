const API_BASE = '/admin';

// Global state
const appState = {
    currentTab: 'dashboard',
    chartInstances: {},
    modalStack: []
};

// Tab management
async function showTab(tabName, event = null) {
    if (tabName === "payments") {
        // window.location.href = '/admin/payment-confirmation.html';
        window.location.replace('/admin/payment-confirmation.html');
        return;
    }
    // Update sidebar active state
    document.querySelectorAll('.sidebar li').forEach(li => {
        li.classList.remove('active');
    });
    
    // If called from click event, set active class on clicked element
    if (event) {
        event.target.classList.add('active');
    } else {
        // If called programmatically, find and activate the corresponding tab
        const sidebarItems = document.querySelectorAll('.sidebar li');
        for (let item of sidebarItems) {
            if (item.textContent.includes(getTabDisplayName(tabName))) {
                item.classList.add('active');
                break;
            }
        }
    }
    
    // Update app state
    appState.currentTab = tabName;
    
    // Show loading
    document.getElementById('mainContent').innerHTML = `
        <div class="loading" id="loading">
            <div class="loading-spinner"></div>
            <p>Loading ${getTabDisplayName(tabName)}...</p>
        </div>
    `;
    
    // Load tab content
    try {
        const response = await fetch(`partials/${tabName}.html`);
        if (!response.ok) throw new Error('Failed to load tab content');
        
        const content = await response.text();
        document.getElementById('mainContent').innerHTML = content;
        
        // Initialize tab-specific functionality
        const initFunctionName = `init${camelCase(tabName)}`;
        if (typeof window[initFunctionName] === 'function') {
            await window[initFunctionName]();
        }
        
        // Load tab data
        const loadFunctionName = `load${camelCase(tabName)}`;
        if (typeof window[loadFunctionName] === 'function') {
            await window[loadFunctionName]();
        }

        if (tabName === 'contact') {
            initContactManagement();
        }

        if (tabName === 'settings') {
            await initSettingsPage();
        }
        
    } catch (error) {
        console.error(`Error loading tab ${tabName}:`, error);
        document.getElementById('mainContent').innerHTML = `
            <div class="error-state">
                <h1>Error loading ${getTabDisplayName(tabName)}</h1>
                <p>${error.message}</p>
                <button class="btn btn-primary" onclick="showTab('${tabName}')">Retry</button>
            </div>
        `;
    }
}

// Utility functions
function camelCase(str) {
    return str.replace(/_([a-z])/g, (g) => g[1].toUpperCase())
              .replace(/^[a-z]/, (g) => g.toUpperCase());
}

function getTabDisplayName(tabName) {
    const names = {
        'dashboard': 'Dashboard',
        'pickup_locations': 'Pickup Locations',
        'orders': 'Orders',
        'customers': 'Customers',
        'drivers': 'Drivers',
        'menu': 'Menu',
        'inventory': 'Inventory',
        'payments': 'Payments'
    };
    return names[tabName] || tabName;
}

function formatCurrency(amount) {
    return `$${(amount / 100).toFixed(2)}`;
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
}

function formatDateTime(dateString) {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
}

// Modal management
function showModal(modalId, content = '', options = {}) {
    let modal = document.getElementById(modalId);
    if (!modal) {
        modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content ${options.scrollable ? 'scrollable' : ''}">
                ${content}
            </div>
        `;
        document.getElementById('modalContainer').appendChild(modal);
        
        // Close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modalId);
            }
        });
    } else {
        const modalContent = modal.querySelector('.modal-content');
        if (options.scrollable) {
            modalContent.classList.add('scrollable');
        } else {
            modalContent.classList.remove('scrollable');
        }
        modalContent.innerHTML = content;
    }
    
    modal.style.display = 'block';
    appState.modalStack.push(modalId);
    
    // Add escape key listener
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal(modalId);
        }
    };
    modal._escapeHandler = escapeHandler;
    document.addEventListener('keydown', escapeHandler);
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
        
        // Remove escape key listener
        if (modal._escapeHandler) {
            document.removeEventListener('keydown', modal._escapeHandler);
        }
        
        // Remove from stack
        const index = appState.modalStack.indexOf(modalId);
        if (index > -1) {
            appState.modalStack.splice(index, 1);
        }
    }
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
        if (modal._escapeHandler) {
            document.removeEventListener('keydown', modal._escapeHandler);
        }
    });
    appState.modalStack = [];
}

// Authentication
function logout() {
    localStorage.removeItem('adminAuth');
    window.location.href = '/admin/login.html';
}

// Error handling for axios
axios.interceptors.response.use(
    response => response,
    error => {
        const status = error?.response?.status;
        if (status === 401 || status === 403) {
            logout();
        }
        return Promise.reject(error);
    }
);

// Chart management
function destroyChart(chartName) {
    if (appState.chartInstances[chartName]) {
        appState.chartInstances[chartName].destroy();
        appState.chartInstances[chartName] = null;
    }
}

function destroyAllCharts() {
    Object.keys(appState.chartInstances).forEach(chartName => {
        destroyChart(chartName);
    });
}

// Notification system
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`; // success, error, content, warning, message, close
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-message">${message}</span>
            <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
}

function showLoading(text = 'Loading...') {
    // Prevent multiple spinners
    if (document.getElementById('global-loading-spinner')) return;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'global-loading-spinner';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'rgba(0, 0, 0, 0.5)';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '9999';
    overlay.style.color = '#fff';
    overlay.style.fontFamily = 'sans-serif';
    overlay.style.fontSize = '18px';

    // Create spinner
    const spinner = document.createElement('div');
    spinner.style.border = '6px solid #f3f3f3';
    spinner.style.borderTop = '6px solid #3498db';
    spinner.style.borderRadius = '50%';
    spinner.style.width = '50px';
    spinner.style.height = '50px';
    spinner.style.animation = 'spin 1s linear infinite';
    spinner.style.marginBottom = '15px';

    // Create text
    const loadingText = document.createElement('div');
    loadingText.textContent = text;

    // Append
    overlay.appendChild(spinner);
    overlay.appendChild(loadingText);
    document.body.appendChild(overlay);

    // Spinner animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
}

function hideLoading() {
  const overlay = document.getElementById('global-loading-spinner');
  if (overlay) overlay.remove();
}

// Add notification styles
const notificationStyles = document.createElement('style');
notificationStyles.textContent = `
    .notification {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        min-width: 300px;
        max-width: 500px;
        animation: slideIn 0.3s ease-out;
    }
    
    .notification-content {
        background: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        border-left: 4px solid #3498db;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    
    .notification-success .notification-content { border-left-color: #27ae60; }
    .notification-error .notification-content { border-left-color: #e74c3c; }
    .notification-warning .notification-content { border-left-color: #f39c12; }
    
    .notification-message {
        flex: 1;
        margin-right: 10px;
    }
    
    .notification-close {
        background: none;
        border: none;
        font-size: 18px;
        cursor: pointer;
        color: #666;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    .error-state {
        text-align: center;
        padding: 40px;
        color: #666;
    }
    
    .error-state h1 {
        color: #e74c3c;
        margin-bottom: 20px;
    }
`;
document.head.appendChild(notificationStyles);

// Export functions for modules
window.API_BASE = API_BASE;
window.appState = appState;
window.formatCurrency = formatCurrency;
window.formatDate = formatDate;
window.formatDateTime = formatDateTime;
window.showModal = showModal;
window.closeModal = closeModal;
window.closeAllModals = closeAllModals;
window.showNotification = showNotification;
window.destroyChart = destroyChart;
window.destroyAllCharts = destroyAllCharts;
window.showLoading = showLoading;
window.hideLoading = hideLoading;