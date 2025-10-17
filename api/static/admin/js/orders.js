let ordersCurrentPage = 1;
const ordersPerPage = 20;

async function initOrders() {
    // Set default dates
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];
    
    document.getElementById('orderDateFrom').value = weekAgoStr;
    document.getElementById('orderDateTo').value = today;
    
    // Set up pagination event listeners
    document.getElementById('prevPage').addEventListener('click', () => {
        if (ordersCurrentPage > 1) {
            ordersCurrentPage--;
            loadOrders();
        }
    });
    
    document.getElementById('nextPage').addEventListener('click', () => {
        ordersCurrentPage++;
        loadOrders();
    });
}

async function loadOrders() {
    try {
        const statusFilter = document.getElementById('orderStatusFilter').value;
        const dateFrom = document.getElementById('orderDateFrom').value;
        const dateTo = document.getElementById('orderDateTo').value;
        
        let url = `${API_BASE}/orders?limit=${ordersPerPage}&offset=${(ordersCurrentPage - 1) * ordersPerPage}`;
        
        if (statusFilter) url += `&status=${statusFilter}`;
        if (dateFrom) url += `&date_from=${dateFrom}`;
        if (dateTo) url += `&date_to=${dateTo}`;
        
        const response = await axios.get(url);
        updateOrdersTable(response.data.orders || response.data);
        updateOrdersPagination(response.data.total || response.data.length);
        
    } catch (error) {
        console.error('Error loading orders:', error);
        showNotification('Error loading orders', 'error');
    }
}

function updateOrdersTable(orders) {
    const tbody = document.querySelector('#ordersTable tbody');
    if (!tbody) return;
    
    if (!orders || orders.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 20px; color: #666;">
                    No orders found
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = orders.map(order => {
        const isCompleted = ['delivered', 'cancelled'].includes(order.status);
        const isPickup = (order.delivery_or_pickup === 'pickup' || order.delivery_type === 'pickup');
        
        return `
            <tr>
                <td>${order.order_number}</td>
                <td>${order.customer_telegram_id || 'N/A'}</td>
                <td>${order.items ? order.items.length : 0} items</td>
                <td>${formatCurrency(order.payment_metadata?.original_total_cents || order.total_cents || 0)}</td>
                <td>
                    ${order.payment_metadata?.btc_discount_amount_cents ? `
                        <span style="color: #27ae60;">
                            -${formatCurrency(order.payment_metadata.btc_discount_amount_cents)}
                            (${order.payment_metadata.btc_discount_percent}%)
                        </span>
                    ` : '-'}
                </td>
                <td><strong>${formatCurrency(order.total_cents)}</strong></td>
                <td>
                    <span class="status-badge ${order.status}">${order.status}</span>
                    ${order.driver_name ? `<br><small>Driver: ${order.driver_name}</small>` : ''}
                    ${order.payment_type === 'btc' ? `<br><small style="color: #27ae60;">💰 BTC Payment</small>` : ''}
                </td>
                <td>${order.delivery_or_pickup || order.delivery_type || 'N/A'}</td>
                <td>${formatDate(order.created_at)}</td>
                <td>
                    <button class="btn btn-primary btn-sm" onclick="viewOrder('${order.order_number}')">View</button>
                    
                    ${!isCompleted ? `
                        <!-- Active Order Actions -->
                        <button class="btn btn-info btn-sm" onclick="showAssignDriverModal('${order.order_number}')">Assign Driver</button>
                        <button class="btn btn-secondary btn-sm" onclick="showUpdateDeliveryTimeModal('${order.order_number}', '${order.delivery_slot_et || order.delivery_slot || ''}')">
                            Update Time
                        </button>
                        
                        ${isPickup ? `
                            <button class="btn btn-warning btn-sm" onclick="showUpdatePickupAddressModal('${order.order_number}', '${order.pickup_address_text || ''}')">
                                Update Pickup
                            </button>
                        ` : ''}
                        
                        ${order.status === 'assigned' ? `
                            <button class="btn btn-warning btn-sm" onclick="updateOrderStatus('${order.order_number}', 'out_for_delivery')">Out for Delivery</button>
                        ` : ''}
                        ${order.status === 'out_for_delivery' ? `
                            <button class="btn btn-success btn-sm" onclick="updateOrderStatus('${order.order_number}', 'delivered')">Complete</button>
                        ` : ''}
                        ${!['assigned', 'out_for_delivery'].includes(order.status) ? `
                            <button class="btn btn-warning btn-sm" onclick="updateOrderStatus('${order.order_number}', 'scheduled')">Schedule</button>
                        ` : ''}
                        <button class="btn btn-danger btn-sm" onclick="deleteOrder('${order.order_number}', false)">Cancel</button>
                    ` : ''}
                    
                    <!-- Always show delete button for completed orders -->
                    <button class="btn btn-danger btn-sm" onclick="deleteOrder('${order.order_number}', true)">
                        🗑️ Delete
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function updateOrdersPagination(totalOrders) {
    const totalPages = Math.ceil(totalOrders / ordersPerPage);
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    const pageInfo = document.getElementById('pageInfo');
    
    if (prevBtn) prevBtn.disabled = ordersCurrentPage <= 1;
    if (nextBtn) nextBtn.disabled = ordersCurrentPage >= totalPages;
    if (pageInfo) pageInfo.textContent = `Page ${ordersCurrentPage} of ${totalPages}`;
}

function resetOrderFilters() {
    document.getElementById('orderStatusFilter').value = '';
    document.getElementById('orderDateFrom').value = '';
    document.getElementById('orderDateTo').value = '';
    ordersCurrentPage = 1;
    loadOrders();
}

async function viewOrder(orderNumber) {
    try {
        const response = await axios.get(`${API_BASE}/orders/${orderNumber}`);
        const order = response.data;
        
        // Calculate total amount including delivery fee
        const subtotal = order.subtotal_cents || order.subtotal || 0;
        const deliveryFee = order.delivery_fee_cents || order.delivery_fee || 0;
        const totalAmount = subtotal + deliveryFee;
        
        // Get delivery address based on order type
        const deliveryAddress = order.delivery_type === 'delivery' 
            ? (order.delivery_address || order.customer_address || 'No delivery address specified')
            : (order.pickup_address || order.delivery_address_text || 'Pickup order');
        
        const driversResponse = await axios.get(`${API_BASE}/orders/${orderNumber}/available-drivers`);
        const availableDrivers = driversResponse.data;

        const modalContent = `
            <div class="modal-header">
                <h3>Order Details - #${order.order_number}</h3>
            </div>
            <div class="modal-body">
                <div style="display: grid; gap: 20px;">
                    <!-- Order Summary Section -->
                    <div class="order-section">
                        <h4 style="margin-bottom: 15px; color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 8px;">📋 Order Summary</h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                            <div>
                                <p><strong>Order #:</strong> ${order.order_number}</p>
                                <p><strong>Customer:</strong> ${order.customer?.telegram_id || order.customer_telegram_id || 'N/A'}</p>
                                <p><strong>Phone:</strong> ${order.customer?.phone || 'No phone'}</p>
                                <p><strong>Delivery Type:</strong> 
                                    <span class="status-badge ${order.delivery_type === 'delivery' ? 'delivered' : 'placed'}">
                                        ${order.delivery_type || order.delivery_or_pickup || 'N/A'}
                                    </span>
                                </p>
                            </div>
                            <div>
                                <p><strong>Status:</strong> <span class="status-badge ${order.status}">${order.status}</span></p>
                                <p><strong>Payment:</strong> ${order.payment_type || 'N/A'} 
                                    <span class="status-badge ${order.payment_status === 'paid_confirmed' ? 'delivered' : order.payment_status === 'pending' ? 'placed' : 'cancelled'}">
                                        ${order.payment_status || 'Unknown'}
                                    </span>
                                </p>
                                <p><strong>Delivery Slot:</strong> ${order.delivery_slot ? formatDateTime(order.delivery_slot) : 'Not set'}</p>
                                <p><strong>Created:</strong> ${formatDateTime(order.created_at)}</p>
                            </div>
                        </div>
                    </div>

                    <!-- Pricing Section -->
                    <div class="order-section">
                        <h4 style="margin-bottom: 15px; color: #2c3e50; border-bottom: 2px solid #27ae60; padding-bottom: 8px;">💰 Pricing Details</h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                            <div>
                                <p><strong>Subtotal:</strong> $${subtotal}</p>
                                <p><strong>Delivery Fee:</strong> $${deliveryFee}</p>
                                <p style="font-size: 16px; font-weight: bold; color: #2c3e50; border-top: 1px solid #eee; padding-top: 8px;">
                                    <strong>Total Amount:</strong> $${totalAmount}
                                </p>
                            </div>
                            <div>
                                ${order.payment_type === 'btc' ? `
                                    <p><strong>Payment Method:</strong> Bitcoin</p>
                                    ${order.btc_amount ? `<p><strong>BTC Amount:</strong> ${order.btc_amount}</p>` : ''}
                                    ${order.btc_address ? `<p><strong>BTC Address:</strong> <code style="font-size: 12px;">${order.btc_address}</code></p>` : ''}
                                ` : order.payment_type === 'cash' ? `
                                    <p><strong>Payment Method:</strong> Cash on Delivery</p>
                                ` : `
                                    <p><strong>Payment Method:</strong> ${order.payment_type || 'Not specified'}</p>
                                `}
                            </div>
                        </div>
                    </div>

                    <!-- Delivery/Pickup Information -->
                    <div class="order-section">
                        <h4 style="margin-bottom: 15px; color: #2c3e50; border-bottom: 2px solid #e67e22; padding-bottom: 8px;">
                            ${order.delivery_type === 'delivery' ? '🚚 Delivery Information' : '📍 Pickup Information'}
                        </h4>
                        <div style="padding: 15px; background: #f8f9fa; border-radius: 8px;">
                            <p style="margin: 0; font-weight: 500; color: #2c3e50;">${deliveryAddress}</p>
                            ${order.delivery_address ? `
                                <div style="margin-top: 10px; padding: 10px; background: white; border-radius: 5px;">
                                    <strong>Special Instructions:</strong>
                                    <p style="margin: 5px 0 0 0; color: #555;">${order.delivery_address}</p>
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <!-- Driver Assignment Section -->
                    <div class="order-section">
                        <h4 style="margin-bottom: 15px; color: #2c3e50; border-bottom: 2px solid #9b59b6; padding-bottom: 8px;">🚗 Driver Assignment</h4>
                        <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 15px;">
                            <p style="margin: 0; flex: 1;"><strong>Current Driver:</strong> ${order.driver?.name || 'Not assigned'} 
                                ${order.driver?.telegram_id ? `(TG: ${order.driver.telegram_id})` : ''}
                            </p>
                        </div>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <select id="orderDetailDriverSelect" style="flex: 1; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px;">
                                <option value="">-- Select driver --</option>
                                ${availableDrivers.map(driver => `
                                    <option value="${driver.id}" ${driver.already_assigned ? 'selected' : ''}>
                                        ${driver.name} (${driver.active_orders || 0} active orders)
                                    </option>
                                `).join('')}
                            </select>
                            <button class="btn btn-info" onclick="assignDriverFromDetails('${order.order_number}')">
                                Assign Driver
                            </button>
                        </div>
                    </div>

                    <!-- Order Items Section -->
                    <div class="order-section">
                        <h4 style="margin-bottom: 15px; color: #2c3e50; border-bottom: 2px solid #e74c3c; padding-bottom: 8px;">🛒 Order Items (${order.items ? order.items.length : 0})</h4>
                        ${order.items && order.items.length > 0 ? `
                            <div style="max-height: 200px; overflow-y: auto;">
                                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                                    <thead>
                                        <tr style="background: #e8f4fd;">
                                            <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Item</th>
                                            <th style="padding: 10px; text-align: center; border-bottom: 1px solid #ddd;">Quantity</th>
                                            <th style="padding: 10px; text-align: right; border-bottom: 1px solid #ddd;">Price</th>
                                            <th style="padding: 10px; text-align: right; border-bottom: 1px solid #ddd;">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${order.items.map(item => {
                                            const itemPrice = item.price_cents || item.price || 0;
                                            const itemTotal = itemPrice * (item.quantity || 1);
                                            return `
                                                <tr>
                                                    <td style="padding: 10px; border-bottom: 1px solid #eee;">
                                                        <strong>${item.name}</strong>
                                                        ${item.description ? `<br><small style="color: #666;">${item.description}</small>` : ''}
                                                    </td>
                                                    <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity || 1}</td>
                                                    <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">${formatCurrency(itemPrice)}</td>
                                                    <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">${formatCurrency(itemTotal)}</td>
                                                </tr>
                                            `;
                                        }).join('')}
                                    </tbody>
                                    <tfoot>
                                        <tr style="background: #f8f9fa;">
                                            <td colspan="3" style="padding: 10px; text-align: right; border-top: 2px solid #ddd;"><strong>Subtotal:</strong></td>
                                            <td style="padding: 10px; text-align: right; border-top: 2px solid #ddd;"><strong>${subtotal}</strong></td>
                                        </tr>
                                        <tr style="background: #f8f9fa;">
                                            <td colspan="3" style="padding: 10px; text-align: right;"><strong>Delivery Fee:</strong></td>
                                            <td style="padding: 10px; text-align: right;"><strong>${deliveryFee}</strong></td>
                                        </tr>
                                        <tr style="background: #e8f4fd;">
                                            <td colspan="3" style="padding: 10px; text-align: right; font-size: 16px;"><strong>Total:</strong></td>
                                            <td style="padding: 10px; text-align: right; font-size: 16px; font-weight: bold; color: #2c3e50;">
                                                <strong>${totalAmount}</strong>
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        ` : `
                            <div style="text-align: center; padding: 20px; color: #666; background: #f8f9fa; border-radius: 8px;">
                                No items in this order
                            </div>
                        `}
                    </div>

                    <!-- Customer Notes -->
                    ${order.notes ? `
                        <div class="order-section">
                            <h4 style="margin-bottom: 15px; color: #2c3e50; border-bottom: 2px solid #f39c12; padding-bottom: 8px;">📝 Customer Notes</h4>
                            <div style="padding: 15px; background: #fffbf0; border-radius: 8px; border-left: 4px solid #f39c12;">
                                <p style="margin: 0; color: #8a6d3b;">${order.notes}</p>
                            </div>
                        </div>
                    ` : ''}

                    <!-- Order History -->
                    ${order.events && order.events.length > 0 ? `
                        <div class="order-section">
                            <h4 style="margin-bottom: 15px; color: #2c3e50; border-bottom: 2px solid #95a5a6; padding-bottom: 8px;">📊 Order History</h4>
                            <div style="max-height: 200px; overflow-y: auto;">
                                ${order.events.map(event => `
                                    <div style="padding: 10px; margin-bottom: 8px; background: #f8f9fa; border-radius: 5px; border-left: 3px solid #3498db;">
                                        <div style="display: flex; justify-content: space-between; align-items: start;">
                                            <strong style="color: #2c3e50;">${event.type || 'Event'}</strong>
                                            <small style="color: #666;">${formatDateTime(event.created_at)}</small>
                                        </div>
                                        ${event.payload ? `
                                            <div style="margin-top: 5px; font-size: 12px; color: #666;">
                                                <code style="background: white; padding: 2px 4px; border-radius: 3px;">
                                                    ${typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload, null, 2)}
                                                </code>
                                            </div>
                                        ` : ''}
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}

                    <!-- Quick Actions -->
                    <div class="order-section">
                        <h4 style="margin-bottom: 15px; color: #2c3e50; border-bottom: 2px solid #34495e; padding-bottom: 8px;">⚡ Quick Actions</h4>
                        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                            ${order.status !== 'cancelled' && order.status !== 'delivered' ? `
                                <!-- Active Order Actions -->
                                <button class="btn btn-warning btn-sm" onclick="updateOrderStatus('${order.order_number}', 'scheduled')">
                                    📅 Schedule
                                </button>
                                ${order.status === 'assigned' ? `
                                    <button class="btn btn-warning btn-sm" onclick="updateOrderStatus('${order.order_number}', 'out_for_delivery')">
                                        🚚 Out for Delivery
                                    </button>
                                ` : ''}
                                ${order.status === 'out_for_delivery' ? `
                                    <button class="btn btn-success btn-sm" onclick="updateOrderStatus('${order.order_number}', 'delivered')">
                                        ✅ Mark Delivered
                                    </button>
                                ` : ''}
                                <button class="btn btn-secondary btn-sm" onclick="showUpdateDeliveryTimeModal('${order.order_number}', '${order.delivery_slot}')">
                                    ⏰ Update Time
                                </button>
                                ${order.delivery_type === 'pickup' ? `
                                    <button class="btn btn-warning btn-sm" onclick="showUpdatePickupAddressModal('${order.order_number}', '${order.pickup_address_text || ''}')">
                                        📍 Update Pickup
                                    </button>
                                ` : ''}
                                <button class="btn btn-danger btn-sm" onclick="deleteOrder('${order.order_number}', false)">
                                    ❌ Cancel Order
                                </button>
                            ` : `
                                <!-- Completed Order Actions -->
                                <span style="color: #666; font-style: italic;">
                                    Order is ${order.status}. No actions available.
                                </span>
                            `}
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-primary" onclick="closeModal('orderDetailsModal')">Close</button>
            </div>
        `;
        
        showModal('orderDetailsModal', modalContent, { scrollable: true });
        
    } catch (error) {
        console.error('Error loading order details:', error);
        showNotification('Error loading order details', 'error');
    }
}

function showUpdateDeliveryTimeModal(orderNumber, currentSlot = null) {
    const modalContent = `
        <div class="modal-header">
            <h3>Update Delivery/Pickup Time</h3>
        </div>
        <div class="modal-body">
            <p><strong>Order #:</strong> ${orderNumber}</p>
            <form id="updateDeliveryTimeForm">
                <div class="form-group">
                    <label>New Delivery/Pickup Time:</label>
                    <input type="datetime-local" id="newDeliverySlot" value="${currentSlot ? formatDateTimeForInput(currentSlot) : ''}" required class="form-control">
                </div>
                <div class="form-group">
                    <label>Reason for Change (Optional):</label>
                    <input type="text" id="timeChangeReason" placeholder="e.g., Customer requested change" class="form-control">
                </div>
                <div id="deliveryTimeUpdateResult"></div>
            </form>
        </div>
        <div class="modal-footer">
            <button type="submit" form="updateDeliveryTimeForm" class="btn btn-success">Update Time</button>
            <button class="btn btn-secondary" onclick="closeModal('updateDeliveryTimeModal')">Cancel</button>
        </div>
    `;
    
    showModal('updateDeliveryTimeModal', modalContent);
    
    // Handle form submission
    document.getElementById('updateDeliveryTimeForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await updateDeliveryTime(orderNumber);
    });
}

function formatDateTimeForInput(datetimeString) {
    if (!datetimeString) return '';
    
    try {
        const date = new Date(datetimeString);
        // Convert to local timezone and format for datetime-local input
        const timezoneOffset = date.getTimezoneOffset() * 60000; // offset in milliseconds
        const localDate = new Date(date.getTime() - timezoneOffset);
        return localDate.toISOString().slice(0, 16);
    } catch (error) {
        console.error('Error formatting date:', error);
        return '';
    }
}

async function updateDeliveryTime(orderNumber) {
    const newSlot = document.getElementById('newDeliverySlot').value;
    const reason = document.getElementById('timeChangeReason').value;
    const resultDiv = document.getElementById('deliveryTimeUpdateResult');
    
    if (!newSlot) {
        resultDiv.innerHTML = '<div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">Please select a date and time</div>';
        return;
    }
    
    try {
        resultDiv.innerHTML = '<div style="color: #0066cc; padding: 10px; background: #e6f2ff; border-radius: 5px;">Updating delivery time...</div>';
        
        const response = await axios.put(`${API_BASE}/orders/${orderNumber}/delivery-slot`, {
            delivery_slot_et: newSlot,
            reason: reason || 'Admin updated delivery time'
        });
        
        resultDiv.innerHTML = `
            <div style="color: green; padding: 10px; background: #e6ffe6; border-radius: 5px;">
                <strong>✅ Delivery time updated successfully!</strong><br>
                ${response.data.notification_sent ? 'Customer has been notified.' : 'Could not notify customer.'}
            </div>
        `;
        
        setTimeout(() => {
            closeModal('updateDeliveryTimeModal');
            loadOrders(); // Refresh orders list
        }, 2000);
        
    } catch (error) {
        console.error('Error updating delivery time:', error);
        resultDiv.innerHTML = `
            <div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">
                <strong>Error updating delivery time:</strong> ${error.response?.data?.detail || error.message}
            </div>
        `;
    }
}

async function showAssignDriverModal(orderNumber) {
    try {
        const response = await axios.get(`${API_BASE}/orders/${orderNumber}/available-drivers`);
        const drivers = response.data;
        
        const modalContent = `
            <div class="modal-header">
                <h3>Assign Driver to Order #${orderNumber}</h3>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Select Driver</label>
                    <select id="driverSelect" class="form-control">
                        <option value="">-- Select a driver --</option>
                        ${drivers.map(driver => `
                            <option value="${driver.id}">
                                ${driver.name} (${driver.active_orders || 0} active orders)
                            </option>
                        `).join('')}
                    </select>
                </div>
                <div id="assignDriverResult"></div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-success" onclick="assignDriver('${orderNumber}')">Assign Driver</button>
                <button class="btn btn-secondary" onclick="closeModal('assignDriverModal')">Cancel</button>
            </div>
        `;
        
        showModal('assignDriverModal', modalContent);
        
    } catch (error) {
        console.error('Error loading drivers:', error);
        showNotification('Error loading available drivers', 'error');
    }
}

// Assign Driver from Order Details
async function assignDriverFromDetails(orderNumber) {
    const driverSelect = document.getElementById('orderDetailDriverSelect');
    const driverId = driverSelect.value;
    
    if (!driverId) {
        showNotification('Please select a driver', 'error');
        return;
    }
    
    try {
        const response = await axios.post(`${API_BASE}/orders/${orderNumber}/assign-driver`, {
            driver_id: parseInt(driverId)
        });
        
        const notifications = response.data.notifications;
        
        let notificationMessage = 'Driver assigned successfully!';
        if (notifications) {
            if (notifications.driver && notifications.driver.sent) {
                notificationMessage += ` Driver (${notifications.driver.driver_name}) notified.`;
            }
            if (notifications.customer && notifications.customer.sent) {
                notificationMessage += ' Customer notified.';
            }
        }
        
        showNotification(notificationMessage, 'success');
        
        // Close the order details modal and refresh
        closeModal('orderDetailsModal');
        loadOrders();
        
    } catch (error) {
        console.error('Error assigning driver:', error);
        showNotification('Error assigning driver', 'error');
    }
}

function showUpdatePickupAddressModal(orderNumber, currentAddress = null) {
    const modalContent = `
        <div class="modal-header">
            <h3>Update Pickup Address</h3>
        </div>
        <div class="modal-body">
            <p><strong>Order #:</strong> ${orderNumber}</p>
            <form id="updatePickupAddressForm">
                <div class="form-group">
                    <label>New Pickup Address:</label>
                    <textarea id="newPickupAddress" rows="4" required class="form-control" placeholder="Enter the full pickup address">${currentAddress || ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Instructions (Optional):</label>
                    <textarea id="pickupInstructions" rows="2" class="form-control" placeholder="Any special instructions for pickup"></textarea>
                </div>
                <div class="form-group">
                    <label>Reason for Change (Optional):</label>
                    <input type="text" id="addressChangeReason" placeholder="e.g., Customer requested different location" class="form-control">
                </div>
                <div id="pickupAddressUpdateResult"></div>
            </form>
        </div>
        <div class="modal-footer">
            <button type="submit" form="updatePickupAddressForm" class="btn btn-success">Update Address</button>
            <button class="btn btn-secondary" onclick="closeModal('updatePickupAddressModal')">Cancel</button>
        </div>
    `;
    
    showModal('updatePickupAddressModal', modalContent);
    
    // Handle form submission
    document.getElementById('updatePickupAddressForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await updatePickupAddress(orderNumber);
    });
}

async function updatePickupAddress(orderNumber) {
    const newAddress = document.getElementById('newPickupAddress').value;
    const instructions = document.getElementById('pickupInstructions').value;
    const reason = document.getElementById('addressChangeReason').value;
    const resultDiv = document.getElementById('pickupAddressUpdateResult');
    
    if (!newAddress.trim()) {
        resultDiv.innerHTML = '<div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">Please enter a pickup address</div>';
        return;
    }
    
    try {
        resultDiv.innerHTML = '<div style="color: #0066cc; padding: 10px; background: #e6f2ff; border-radius: 5px;">Updating pickup address...</div>';
        
        const response = await axios.put(`${API_BASE}/orders/${orderNumber}/pickup-address`, {
            pickup_address_text: newAddress.trim(),
            instructions: instructions || null,
            reason: reason || 'Admin updated pickup address'
        });
        
        resultDiv.innerHTML = `
            <div style="color: green; padding: 10px; background: #e6ffe6; border-radius: 5px;">
                <strong>✅ Pickup address updated successfully!</strong><br>
                ${response.data.notification_sent ? 'Customer has been notified.' : 'Could not notify customer.'}
            </div>
        `;
        
        setTimeout(() => {
            closeModal('updatePickupAddressModal');
            loadOrders(); // Refresh orders list
        }, 2000);
        
    } catch (error) {
        console.error('Error updating pickup address:', error);
        resultDiv.innerHTML = `
            <div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">
                <strong>Error updating pickup address:</strong> ${error.response?.data?.detail || error.message}
            </div>
        `;
    }
}

// Delete Order Function
async function deleteOrder(orderNumber, permanent = false) {
    const message = permanent
        ? `Are you sure you want to PERMANENTLY DELETE order ${orderNumber}? This action cannot be undone and will remove all order data!`
        : `Are you sure you want to cancel order ${orderNumber}?`;
    
    if (!confirm(message)) {
        return;
    }
    
    try {
        if (permanent) {
            await axios.delete(`${API_BASE}/orders/${orderNumber}/permanent`);
            showNotification(`Order ${orderNumber} permanently deleted!`, 'success');
        } else {
            await axios.put(`${API_BASE}/orders/${orderNumber}/status`, { 
                status: 'cancelled',
                reason: 'Cancelled by admin'
            });
            showNotification(`Order ${orderNumber} cancelled!`, 'success');
        }
        loadOrders();
    } catch (error) {
        console.error('Error deleting order:', error);
        const errorMsg = error.response?.data?.detail || 'Error deleting order';
        showNotification(`Error: ${errorMsg}`, 'error');
    }
}


async function assignDriver(orderNumber) {
    const driverSelect = document.getElementById('driverSelect');
    const driverId = driverSelect.value;
    const resultDiv = document.getElementById('assignDriverResult');
    
    if (!driverId) {
        resultDiv.innerHTML = '<div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">Please select a driver</div>';
        return;
    }
    
    try {
        resultDiv.innerHTML = '<div style="color: #0066cc; padding: 10px; background: #e6f2ff; border-radius: 5px;">Assigning driver...</div>';
        
        const response = await axios.post(`${API_BASE}/orders/${orderNumber}/assign-driver`, {
            driver_id: parseInt(driverId)
        });
        
        resultDiv.innerHTML = `
            <div style="color: green; padding: 10px; background: #e6ffe6; border-radius: 5px;">
                Driver assigned successfully!
            </div>
        `;
        
        setTimeout(() => {
            closeModal('assignDriverModal');
            loadOrders();
        }, 2000);
        
    } catch (error) {
        console.error('Error assigning driver:', error);
        resultDiv.innerHTML = `
            <div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">
                Error assigning driver: ${error.response?.data?.detail || error.message}
            </div>
        `;
    }
}

async function updateOrderStatus(orderNumber, status) {
    if (!confirm(`Are you sure you want to update order #${orderNumber} to "${status}"?`)) {
        return;
    }
    
    try {
        await axios.put(`${API_BASE}/orders/${orderNumber}/status`, { status });
        showNotification(`Order status updated to ${status}`, 'success');
        loadOrders();
    } catch (error) {
        console.error('Error updating order status:', error);
        showNotification('Error updating order status', 'error');
    }
}