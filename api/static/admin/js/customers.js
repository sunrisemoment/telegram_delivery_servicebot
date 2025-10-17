async function initCustomers() {
    console.log('Customers module initialized');
}

async function loadCustomers() {
    try {
        const searchTerm = document.getElementById('customerSearch').value;
        let url = `${API_BASE}/customers?limit=100`;
        
        if (searchTerm) {
            url += `&search=${encodeURIComponent(searchTerm)}`;
        }
        
        const response = await axios.get(url);
        updateCustomersTable(response.data);
        
    } catch (error) {
        console.error('Error loading customers:', error);
        showNotification('Error loading customers', 'error');
    }
}

function updateCustomersTable(customers) {
    const tbody = document.querySelector('#customersTable tbody');
    if (!tbody) return;
    
    if (!customers || customers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 20px; color: #666;">
                    No customers found
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = customers.map(customer => {
        // Handle both old and new response structures
        const customerData = customer.customer || customer;
        const statistics = customer.statistics || {};
        const hasOrders = (statistics.total_orders || 0) > 0;
        
        return `
            <tr>
                <td>${customerData.telegram_id || 'N/A'}</td>
                <td>${customerData.phone || 'No phone'}</td>
                <td>${statistics.total_orders || customerData.order_count || 0}</td>
                <td>${formatCurrency((statistics.total_spent || 0) * 100)}</td>
                <td>${formatDate(customerData.created_at)}</td>
                <td>${customerData.verified ? '✅' : '❌'}</td>
                <td>
                    <button class="btn btn-primary btn-sm" onclick="viewCustomer(${customerData.id})">View</button>
                    <button class="btn btn-info btn-sm" onclick="sendMessageToCustomer(${customerData.id}, '${customerData.telegram_id}')">Message</button>
                    <button class="btn btn-warning btn-sm" onclick="editCustomer(${customerData.id})">Edit</button>
                    
                    ${!hasOrders ? `
                        <!-- No orders - safe to delete -->
                        <button class="btn btn-danger btn-sm" onclick="deleteCustomer(${customerData.id}, true)">
                            🗑️ Delete
                        </button>
                    ` : `
                        <!-- Has orders - show deactivate option -->
                        <div style="display: flex; flex-direction: column; gap: 5px; margin-top: 5px;">
                            <button class="btn btn-secondary btn-sm" onclick="deleteCustomer(${customerData.id}, false)">
                                Deactivate
                            </button>
                            <button class="btn btn-danger btn-sm" style="background: #dc3545; border-color: #dc3545;" 
                                    onclick="deleteCustomer(${customerData.id}, true)">
                                🗑️ Force Delete
                            </button>
                        </div>
                    `}
                </td>
            </tr>
        `;
    }).join('');
}

async function viewCustomer(customerId) {
    try {
        const response = await axios.get(`${API_BASE}/customers/${customerId}`);
        const customerData = response.data;
        const customer = customerData.customer;
        const statistics = customerData.statistics;
        const addresses = customerData.addresses || [];
        const recentOrders = customerData.recent_orders || [];

        const modalContent = `
            <div class="modal-header">
                <h3>Customer Details</h3>
            </div>
            <div class="modal-body">
                <div style="display: grid; gap: 20px;">
                    <!-- Customer Information Section -->
                    <div class="customer-section">
                        <h4 style="margin-bottom: 15px; color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 8px;">👤 Customer Information</h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                            <div>
                                <p><strong>Telegram ID:</strong> ${customer.telegram_id || 'N/A'}</p>
                                <p><strong>Phone:</strong> ${customer.phone || 'N/A'}</p>
                                <p><strong>Verified:</strong> ${customer.verified ? '✅ Yes' : '❌ No'}</p>
                            </div>
                            <div>
                                <p><strong>Customer ID:</strong> ${customer.id || 'N/A'}</p>
                                <p><strong>Joined:</strong> ${formatDateTime(customer.created_at)}</p>
                                <p><strong>Default Address ID:</strong> ${customer.default_address_id || 'Not set'}</p>
                            </div>
                        </div>
                    </div>

                    <!-- Statistics Section -->
                    <div class="customer-section">
                        <h4 style="margin-bottom: 15px; color: #2c3e50; border-bottom: 2px solid #27ae60; padding-bottom: 8px;">📊 Statistics</h4>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;">
                            <div style="text-align: center; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                                <div style="font-size: 24px; font-weight: bold; color: #3498db;">${statistics.total_orders || 0}</div>
                                <div style="font-size: 12px; color: #666;">Total Orders</div>
                            </div>
                            <div style="text-align: center; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                                <div style="font-size: 24px; font-weight: bold; color: #27ae60;">${formatCurrency((statistics.total_spent || 0) * 100)}</div>
                                <div style="font-size: 12px; color: #666;">Total Spent</div>
                            </div>
                            <div style="text-align: center; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                                <div style="font-size: 24px; font-weight: bold; color: #e67e22;">${formatCurrency((statistics.average_order_value || 0) * 100)}</div>
                                <div style="font-size: 12px; color: #666;">Avg Order Value</div>
                            </div>
                        </div>
                    </div>

                    <!-- Addresses Section -->
                    <div class="customer-section">
                        <h4 style="margin-bottom: 15px; color: #2c3e50; border-bottom: 2px solid #e67e22; padding-bottom: 8px;">📍 Addresses (${addresses.length})</h4>
                        ${addresses.length > 0 ? addresses.map(address => `
                            <div style="padding: 15px; background: #f8f9fa; border-radius: 8px; margin-bottom: 10px; border-left: 4px solid ${address.is_default ? '#27ae60' : '#95a5a6'};">
                                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                                    <strong>${address.label || 'Address'} ${address.is_default ? ' (Default)' : ''}</strong>
                                    <span style="font-size: 12px; color: #666;">ID: ${address.id}</span>
                                </div>
                                <p style="margin: 5px 0; color: #555;">${address.address_text}</p>
                                <div style="font-size: 12px; color: #888;">
                                    Created: ${formatDate(address.created_at)}
                                    ${address.updated_at !== address.created_at ? ` | Updated: ${formatDate(address.updated_at)}` : ''}
                                </div>
                            </div>
                        `).join('') : `
                            <div style="text-align: center; padding: 20px; color: #666; background: #f8f9fa; border-radius: 8px;">
                                No addresses saved
                            </div>
                        `}
                    </div>

                    <!-- Recent Orders Section -->
                    <div class="customer-section">
                        <h4 style="margin-bottom: 15px; color: #2c3e50; border-bottom: 2px solid #9b59b6; padding-bottom: 8px;">📦 Recent Orders (${recentOrders.length})</h4>
                        ${recentOrders.length > 0 ? `
                            <div style="max-height: 200px; overflow-y: auto;">
                                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                                    <thead>
                                        <tr style="background: #e8f4fd;">
                                            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Order #</th>
                                            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Date</th>
                                            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Total</th>
                                            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Status</th>
                                            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Type</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${recentOrders.map(order => `
                                            <tr>
                                                <td style="padding: 10px; border-bottom: 1px solid #eee;">
                                                    <a href="javascript:void(0)" onclick="viewOrder('${order.order_number}'); closeModal('customerDetailsModal')" 
                                                       style="color: #3498db; text-decoration: none; font-weight: 500;">
                                                        ${order.order_number}
                                                    </a>
                                                </td>
                                                <td style="padding: 10px; border-bottom: 1px solid #eee;">${formatDate(order.created_at)}</td>
                                                <td style="padding: 10px; border-bottom: 1px solid #eee;">${formatCurrency((order.total || 0) * 100)}</td>
                                                <td style="padding: 10px; border-bottom: 1px solid #eee;">
                                                    <span class="status-badge ${order.status}">${order.status}</span>
                                                </td>
                                                <td style="padding: 10px; border-bottom: 1px solid #eee; text-transform: capitalize;">${order.delivery_type || 'N/A'}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        ` : `
                            <div style="text-align: center; padding: 20px; color: #666; background: #f8f9fa; border-radius: 8px;">
                                No recent orders
                            </div>
                        `}
                    </div>

                    <!-- Quick Actions -->
                    <div class="customer-section">
                        <h4 style="margin-bottom: 15px; color: #2c3e50; border-bottom: 2px solid #e74c3c; padding-bottom: 8px;">⚡ Quick Actions</h4>
                        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                            <button class="btn btn-primary btn-sm btn-hide" onclick="createOrderForCustomer(${customer.id})">
                                📝 Create Order
                            </button>
                            <button class="btn btn-info btn-sm btn-hide" onclick="sendMessageToCustomer(${customer.id})">
                                💬 Send Message
                            </button>
                            <button class="btn btn-warning btn-sm btn-hide" onclick="editCustomer(${customer.id})">
                                ✏️ Edit Customer
                            </button>
                            ${statistics.total_orders === 0 ? `
                                <button class="btn btn-danger btn-sm" onclick="deleteCustomer(${customer.id}, true)">
                                    🗑️ Delete Customer
                                </button>
                            ` : `
                                <div style="display: flex; flex-direction: column; gap: 5px;">
                                    <button class="btn btn-secondary btn-sm" onclick="deleteCustomer(${customer.id}, false)">
                                        Deactivate Customer
                                    </button>
                                    <button class="btn btn-danger btn-sm" style="background: #dc3545; border-color: #dc3545;" 
                                            onclick="deleteCustomer(${customer.id}, true)">
                                        🗑️ Force Delete
                                    </button>
                                </div>
                            `}
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-primary" onclick="closeModal('customerDetailsModal')">Close</button>
            </div>
        `;
        
        showModal('customerDetailsModal', modalContent, { scrollable: true });
        
    } catch (error) {
        console.error('Error loading customer details:', error);
        showNotification('Error loading customer details', 'error');
    }
}

// Enhanced delete functionality with safe delete checks for customers
async function deleteCustomer(customerId, permanent = false) {
    if (permanent) {
        await permanentDeleteCustomer(customerId);
    } else {
        const message = `Are you sure you want to deactivate customer ${customerId}?`;
        if (!confirm(message)) return;
        
        try {
            await axios.put(`${API_BASE}/customers/${customerId}`, { active: false });
            showNotification('Customer deactivated!', 'success');
            loadCustomers();
        } catch (error) {
            console.error('Error deactivating customer:', error);
            const errorMsg = error.response?.data?.detail || 'Error deactivating customer';
            showNotification(`Error: ${errorMsg}`, 'error');
        }
    }
}

async function permanentDeleteCustomer(customerId) {
    try {
        // First check references
        const references = await axios.get(`${API_BASE}/customers/${customerId}/references`);
        
        if (references.data.can_safe_delete) {
            // Safe to delete
            const customer = references.data.customer;
            const confirmed = await showEnhancedConfirm(
                `Are you sure you want to PERMANENTLY DELETE customer "${customer.telegram_id || 'Unknown'}"? This action cannot be undone!`,
                'Permanent Delete Customer'
            );
            
            if (!confirmed) return;
            
            await axios.delete(`${API_BASE}/customers/${customerId}/permanent`);
            showNotification('Customer permanently deleted!', 'success');
            loadCustomers();
        } else {
            // Show references and offer force delete
            await showCustomerReferencesModal(references.data, customerId);
        }
    } catch (error) {
        console.error('Error checking customer references:', error);
        
        // If reference check fails, try direct deletion with warning
        const confirmed = await showEnhancedConfirm(
            `Could not check references for customer ${customerId}. Proceeding may cause errors if the customer has orders or other references. Continue anyway?`,
            'Warning: Reference Check Failed'
        );
        
        if (!confirmed) return;
        
        try {
            await axios.delete(`${API_BASE}/customers/${customerId}/permanent`);
            showNotification('Customer permanently deleted!', 'success');
            loadCustomers();
        } catch (deleteError) {
            console.error('Error deleting customer:', deleteError);
            const errorMsg = deleteError.response?.data?.detail || 'Error deleting customer';
            showNotification(`Error: ${errorMsg}`, 'error');
        }
    }
}

async function showCustomerReferencesModal(referenceData, customerId) {
    const references = referenceData.references;
    const customer = referenceData.customer;
    const statistics = referenceData.statistics || {};
    
    const modalContent = `
        <div class="modal-header" style="border-left: 5px solid #e74c3c;">
            <h3>⚠️ Cannot Safely Delete Customer</h3>
        </div>
        <div class="modal-body">
            <div style="margin-bottom: 15px;">
                <p><strong>Customer:</strong> ${customer.telegram_id || 'Unknown'} (ID: ${customer.id})</p>
                <p><strong>Phone:</strong> ${customer.phone || 'No phone'}</p>
                <p><strong>Joined:</strong> ${formatDateTime(customer.created_at)}</p>
            </div>
            
            <p>This customer has references in other parts of the system:</p>
            
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 15px 0;">
                <h4>References Found:</h4>
                <ul style="margin: 10px 0; padding-left: 20px;">
                    ${references.orders && references.orders.count > 0 ? 
                        `<li><strong>Orders:</strong> ${references.orders.count} orders</li>` : ''}
                    ${references.addresses && references.addresses.count > 0 ? 
                        `<li><strong>Addresses:</strong> ${references.addresses.count} saved addresses</li>` : ''}
                    ${references.payments && references.payments.count > 0 ? 
                        `<li><strong>Payments:</strong> ${references.payments.count} payment records</li>` : ''}
                </ul>
                
                ${statistics.total_orders > 0 ? `
                    <div style="margin-top: 10px;">
                        <strong>Customer Statistics:</strong>
                        <ul style="margin: 5px 0; padding-left: 20px;">
                            <li>Total Orders: ${statistics.total_orders || 0}</li>
                            <li>Total Spent: ${formatCurrency((statistics.total_spent || 0) * 100)}</li>
                            <li>Average Order Value: ${formatCurrency((statistics.average_order_value || 0) * 100)}</li>
                        </ul>
                    </div>
                ` : ''}
                
                ${references.orders && references.orders.sample && references.orders.sample.length > 0 ? `
                    <div style="margin-top: 10px;">
                        <strong>Recent Orders:</strong>
                        <ul style="margin: 5px 0; padding-left: 20px;">
                            ${references.orders.sample.map(order => 
                                `<li>Order #${order.order_number} - ${formatDate(order.created_at)} - ${order.status}</li>`
                            ).join('')}
                        </ul>
                    </div>
                ` : ''}
            </div>
            
            <div style="margin-top: 20px;">
                <button class="btn btn-danger" onclick="forceDeleteCustomer(${customerId})">
                    🗑️ Force Delete Anyway
                </button>
                <button class="btn btn-secondary" onclick="closeModal('customerReferencesModal')" style="margin-left: 10px;">
                    Cancel
                </button>
            </div>
            
            <div style="margin-top: 15px; font-size: 12px; color: #666;">
                <strong>Warning:</strong> Force deletion will remove all customer data including orders, addresses, and payment history. This action cannot be undone and will affect reporting.
            </div>
        </div>
    `;
    
    showModal('customerReferencesModal', modalContent);
}

async function forceDeleteCustomer(customerId) {
    const confirmed = await showEnhancedConfirm(
        `🚨 DANGER: This will permanently delete the customer and ALL associated data including:
        
        • All order history
        • Saved addresses  
        • Payment records
        • Customer statistics
        
        This action cannot be undone and will permanently affect your business reporting.
        
        Are you absolutely sure you want to proceed?`,
        'CONFIRM CUSTOMER FORCE DELETE'
    );
    
    if (!confirmed) return;
    
    try {
        const response = await axios.delete(`${API_BASE}/customers/${customerId}/force`);
        showNotification(`Customer force deleted! Removed: ${JSON.stringify(response.data.removed_references)}`, 'success');
        closeModal('customerReferencesModal');
        loadCustomers();
    } catch (error) {
        console.error('Error force deleting customer:', error);
        const errorMsg = error.response?.data?.detail || 'Error force deleting customer';
        showNotification(`Error: ${errorMsg}`, 'error');
    }
}

function showEnhancedConfirm(message, title = 'Confirm Action') {
    return new Promise((resolve) => {
        const modalContent = `
            <div class="modal-header" style="border-left: 5px solid #e74c3c;">
                <h3>${title}</h3>
            </div>
            <div class="modal-body">
                <div style="white-space: pre-line; line-height: 1.5;">${message}</div>
            </div>
            <div class="modal-footer">
                <button id="confirmYes" class="btn btn-danger" style="margin-right: 10px;">Yes, Delete Permanently</button>
                <button id="confirmNo" class="btn btn-secondary">Cancel</button>
            </div>
        `;
        
        showModal('enhancedConfirmModal', modalContent);
        
        document.getElementById('confirmYes').onclick = () => {
            closeModal('enhancedConfirmModal');
            resolve(true);
        };
        
        document.getElementById('confirmNo').onclick = () => {
            closeModal('enhancedConfirmModal');
            resolve(false);
        };
    });
}

async function sendMessageToCustomer(customerId, telegramId = null) {
    try {
        // If telegramId is not provided, fetch customer data
        let customerTelegramId = telegramId;
        let customerData = null;
        
        if (!customerTelegramId) {
            const response = await axios.get(`${API_BASE}/customers/${customerId}`);
            customerData = response.data.customer || response.data;
            customerTelegramId = customerData.telegram_id;
        }

        if (!customerTelegramId) {
            showNotification('Customer does not have a Telegram ID', 'error');
            return;
        }

        const modalContent = `
            <div class="modal-header">
                <h3>Send Message to Customer</h3>
            </div>
            <div class="modal-body">
                <form id="messageForm">
                    <div class="form-group">
                        <label>Customer Telegram ID:</label>
                        <input type="text" value="${customerTelegramId}" readonly class="form-control" style="background: #f8f9fa;">
                    </div>
                    <div class="form-group">
                        <label>Message Type:</label>
                        <select id="messageType" class="form-control">
                            <option value="custom">Custom Message</option>
                            <option value="order_update">Order Update</option>
                            <option value="promotion">Promotion</option>
                            <option value="notification">General Notification</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Message Template:</label>
                        <select id="messageTemplate" class="form-control" style="display: none;">
                            <option value="">Select a template...</option>
                            <option value="order_confirmed">Order Confirmed</option>
                            <option value="order_shipped">Order Shipped</option>
                            <option value="order_delivered">Order Delivered</option>
                            <option value="promo_10">10% Discount</option>
                            <option value="promo_free">Free Delivery</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Message:</label>
                        <textarea id="messageText" rows="6" placeholder="Type your message here..." required class="form-control" style="font-family: monospace;"></textarea>
                    </div>
                    <div class="form-group">
                        <label>Character Count:</label>
                        <span id="charCount" style="color: #666;">0</span>
                    </div>
                    <div id="messageResult"></div>
                </form>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-success" onclick="submitCustomerMessage(${customerId}, ${customerTelegramId})">Send Message</button>
                <button class="btn btn-secondary" onclick="closeModal('sendMessageModal')">Cancel</button>
            </div>
        `;

        showModal('sendMessageModal', modalContent);

        // Add character count
        const messageText = document.getElementById('messageText');
        const charCount = document.getElementById('charCount');
        const messageType = document.getElementById('messageType');
        const messageTemplate = document.getElementById('messageTemplate');
        
        messageText.addEventListener('input', () => {
            charCount.textContent = messageText.value.length;
            if (messageText.value.length > 4000) {
                charCount.style.color = '#e74c3c';
            } else if (messageText.value.length > 3000) {
                charCount.style.color = '#f39c12';
            } else {
                charCount.style.color = '#27ae60';
            }
        });

        // Show/hide template based on message type
        messageType.addEventListener('change', function() {
            if (this.value === 'custom') {
                messageTemplate.style.display = 'none';
            } else {
                messageTemplate.style.display = 'block';
            }
        });

        // Apply template when selected
        messageTemplate.addEventListener('change', function() {
            const templates = {
                'order_confirmed': '✅ Your order has been confirmed and is being processed. Thank you for your purchase!',
                'order_shipped': '🚚 Your order has been shipped and is on its way to you. You can track your delivery in the app.',
                'order_delivered': '📦 Your order has been delivered! We hope you enjoy your items. Thank you for shopping with us!',
                'promo_10': '🎉 Special offer! Get 10% off your next order with code: SAVE10. Valid for 7 days.',
                'promo_free': '🚚 Free delivery on your next order! Use code: FREESHIP at checkout. Limited time offer.'
            };
            
            if (templates[this.value]) {
                messageText.value = templates[this.value];
                charCount.textContent = messageText.value.length;
                charCount.style.color = '#27ae60';
            }
        });

    } catch (error) {
        console.error('Error preparing message modal:', error);
        showNotification('Error preparing message: ' + (error.response?.data?.detail || error.message), 'error');
    }
}

async function submitCustomerMessage(customerId, telegramId) {
    const messageText = document.getElementById('messageText').value;
    const messageType = document.getElementById('messageType').value;
    const resultDiv = document.getElementById('messageResult');
    
    if (!messageText.trim()) {
        resultDiv.innerHTML = '<div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">Please enter a message</div>';
        return;
    }
    
    if (messageText.length > 4096) {
        resultDiv.innerHTML = '<div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">Message too long (max 4096 characters)</div>';
        return;
    }
    
    try {
        resultDiv.innerHTML = '<div style="color: #0066cc; padding: 10px; background: #e6f2ff; border-radius: 5px;">Sending message...</div>';
        
        // Try different endpoint variations
        let response;
        try {
            response = await axios.post(`${API_BASE}/customers/${customerId}/send-message`, {
                telegram_id: parseInt(telegramId),
                message: messageText,
                message_type: messageType
            });
        } catch (endpointError) {
            // Fallback to alternative endpoint
            console.log('Trying alternative endpoint...');
            response = await axios.post(`${API_BASE}/send-message`, {
                customer_id: customerId,
                telegram_id: parseInt(telegramId),
                message: messageText,
                type: messageType
            });
        }
        
        if (response.data.success || response.data.status === 'sent') {
            resultDiv.innerHTML = '<div style="color: green; padding: 10px; background: #e6ffe6; border-radius: 5px;">Message sent successfully!</div>';
            setTimeout(() => {
                closeModal('sendMessageModal');
            }, 2000);
        } else {
            throw new Error(response.data.error || 'Failed to send message');
        }
        
    } catch (error) {
        console.error('Error sending message:', error);
        const errorMessage = error.response?.data?.detail || error.response?.data?.error || error.message;
        resultDiv.innerHTML = `
            <div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">
                Error sending message: ${errorMessage}
            </div>
        `;
    }
}

async function editCustomer(customerId) {
    try {
        const response = await axios.get(`${API_BASE}/customers/${customerId}`);
        const customerData = response.data;
        const customer = customerData.customer || customerData;
        const addresses = customerData.addresses || [];

        const modalContent = `
            <div class="modal-header">
                <h3>Edit Customer</h3>
            </div>
            <div class="modal-body">
                <form id="editCustomerForm">
                    <div class="form-group">
                        <label>Telegram ID:</label>
                        <input type="number" id="editTelegramId" value="${customer.telegram_id}" required class="form-control">
                    </div>
                    <div class="form-group">
                        <label>Phone Number:</label>
                        <input type="tel" id="editPhone" value="${customer.phone || ''}" class="form-control" placeholder="+1234567890">
                    </div>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="editVerified" ${customer.verified ? 'checked' : ''}>
                            Verified Customer
                        </label>
                    </div>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="editActive" ${customer.active !== false ? 'checked' : ''}>
                            Active Customer
                        </label>
                    </div>
                    
                    <div style="margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                        <h5 style="margin-bottom: 15px;">📍 Customer Addresses</h5>
                        ${addresses.length > 0 ? addresses.map((address, index) => `
                            <div style="padding: 15px; background: white; border-radius: 5px; margin-bottom: 10px; border: 1px solid #ddd; border-left: 4px solid ${address.is_default ? '#27ae60' : '#3498db'}">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                    <strong>${address.label || 'Address'} ${address.is_default ? '(Default)' : ''}</strong>
                                    <div>
                                        <button type="button" class="btn btn-warning btn-sm" onclick="editCustomerAddress(${customerId}, ${address.id})">Edit</button>
                                        ${!address.is_default ? `
                                            <button type="button" class="btn btn-danger btn-sm" onclick="deleteCustomerAddress(${customerId}, ${address.id})">Delete</button>
                                        ` : ''}
                                    </div>
                                </div>
                                <p style="margin: 0; color: #555;">${address.address_text}</p>
                                <small style="color: #888;">ID: ${address.id} | Created: ${formatDate(address.created_at)}</small>
                            </div>
                        `).join('') : `
                            <div style="text-align: center; padding: 20px; color: #666;">
                                No addresses saved
                            </div>
                        `}
                        <button type="button" class="btn btn-primary btn-sm" onclick="addNewCustomerAddress(${customerId})" style="margin-top: 10px;">
                            + Add New Address
                        </button>
                    </div>
                    
                    <div id="editCustomerResult"></div>
                </form>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-success" onclick="updateCustomer(${customerId})">Update Customer</button>
                <button class="btn btn-secondary" onclick="closeModal('editCustomerModal')">Cancel</button>
            </div>
        `;

        showModal('editCustomerModal', modalContent, { scrollable: true });

    } catch (error) {
        console.error('Error loading customer for edit:', error);
        showNotification('Error loading customer data: ' + (error.response?.data?.detail || error.message), 'error');
    }
}

async function updateCustomer(customerId) {
    const telegramId = document.getElementById('editTelegramId').value;
    const phone = document.getElementById('editPhone').value;
    const verified = document.getElementById('editVerified').checked;
    const active = document.getElementById('editActive').checked;
    const resultDiv = document.getElementById('editCustomerResult');
    
    if (!telegramId) {
        resultDiv.innerHTML = '<div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">Telegram ID is required</div>';
        return;
    }
    
    try {
        resultDiv.innerHTML = '<div style="color: #0066cc; padding: 10px; background: #e6f2ff; border-radius: 5px;">Updating customer...</div>';
        
        const updateData = {
            telegram_id: parseInt(telegramId),
            verified: verified,
            active: active
        };
        
        // Only include phone if it's provided
        if (phone && phone.trim() !== '') {
            updateData.phone = phone.trim();
        }
        
        await axios.put(`${API_BASE}/customers/${customerId}`, updateData);
        
        resultDiv.innerHTML = '<div style="color: green; padding: 10px; background: #e6ffe6; border-radius: 5px;">Customer updated successfully!</div>';
        
        setTimeout(() => {
            closeModal('editCustomerModal');
            loadCustomers(); // Refresh the customers list
        }, 2000);
        
    } catch (error) {
        console.error('Error updating customer:', error);
        const errorMessage = error.response?.data?.detail || error.message;
        resultDiv.innerHTML = `
            <div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">
                Error updating customer: ${errorMessage}
            </div>
        `;
    }
}

// Address Management Functions
function addNewCustomerAddress(customerId) {
    const modalContent = `
        <div class="modal-header">
            <h3>Add New Address</h3>
        </div>
        <div class="modal-body">
            <form id="addAddressForm">
                <div class="form-group">
                    <label>Address Label:</label>
                    <input type="text" id="addressLabel" class="form-control" placeholder="Home, Work, Office, etc." required>
                </div>
                <div class="form-group">
                    <label>Address:</label>
                    <textarea id="addressText" rows="4" required class="form-control" placeholder="Full street address, city, state, zip code"></textarea>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="isDefaultAddress">
                        Set as default address
                    </label>
                </div>
                <div id="addAddressResult"></div>
            </form>
        </div>
        <div class="modal-footer">
            <button type="button" class="btn btn-success" onclick="submitNewCustomerAddress(${customerId})">Add Address</button>
            <button class="btn btn-secondary" onclick="closeModal('addAddressModal')">Cancel</button>
        </div>
    `;

    showModal('addAddressModal', modalContent);
}

async function submitNewCustomerAddress(customerId) {
    const label = document.getElementById('addressLabel').value;
    const addressText = document.getElementById('addressText').value;
    const isDefault = document.getElementById('isDefaultAddress').checked;
    const resultDiv = document.getElementById('addAddressResult');
    
    if (!label.trim()) {
        resultDiv.innerHTML = '<div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">Address label is required</div>';
        return;
    }
    
    if (!addressText.trim()) {
        resultDiv.innerHTML = '<div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">Address is required</div>';
        return;
    }
    
    try {
        resultDiv.innerHTML = '<div style="color: #0066cc; padding: 10px; background: #e6f2ff; border-radius: 5px;">Adding address...</div>';
        
        await axios.post(`${API_BASE}/customers/${customerId}/addresses`, {
            label: label.trim(),
            address_text: addressText.trim(),
            is_default: isDefault
        });
        
        resultDiv.innerHTML = '<div style="color: green; padding: 10px; background: #e6ffe6; border-radius: 5px;">Address added successfully!</div>';
        
        setTimeout(() => {
            closeModal('addAddressModal');
            // Refresh the edit customer modal to show new address
            closeModal('editCustomerModal');
            editCustomer(customerId);
        }, 2000);
        
    } catch (error) {
        console.error('Error adding address:', error);
        const errorMessage = error.response?.data?.detail || error.message;
        resultDiv.innerHTML = `
            <div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">
                Error adding address: ${errorMessage}
            </div>
        `;
    }
}

async function deleteCustomerAddress(customerId, addressId) {
    if (!confirm('Are you sure you want to delete this address?')) return;
    
    try {
        await axios.delete(`${API_BASE}/customers/${customerId}/addresses/${addressId}`);
        showNotification('Address deleted successfully', 'success');
        // Refresh the edit customer modal
        closeModal('editCustomerModal');
        editCustomer(customerId);
    } catch (error) {
        console.error('Error deleting address:', error);
        showNotification('Error deleting address: ' + (error.response?.data?.detail || error.message), 'error');
    }
}

// Helper function for create order (placeholder)
function createOrderForCustomer(customerId) {
    showNotification('Create order functionality will be implemented soon', 'info');
    // TODO: Implement create order for customer
}

function editCustomerAddress(customerId, addressId) {
    showNotification('Edit address functionality will be implemented soon', 'info');
    // TODO: Implement address editing
}