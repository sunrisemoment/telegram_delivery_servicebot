async function initDrivers() {
    console.log('Drivers module initialized');
}

async function loadDrivers() {
    try {
        const searchTerm = document.getElementById('driverSearch').value;
        let url = `${API_BASE}/drivers?limit=100`;
        
        if (searchTerm) {
            url += `&search=${encodeURIComponent(searchTerm)}`;
        }
        
        const response = await axios.get(url);
        updateDriversTable(response.data);
        
    } catch (error) {
        console.error('Error loading drivers:', error);
        showNotification('Error loading drivers', 'error');
    }
}

function updateDriversTable(drivers) {
    const tbody = document.querySelector('#driversTable tbody');
    if (!tbody) return;
    
    if (!drivers || drivers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 20px; color: #666;">
                    No drivers found
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = drivers.map(driver => `
        <tr>
            <td>${driver.name || 'N/A'}</td>
            <td>${driver.telegram_id || 'N/A'}</td>
            <td>${driver.pickup_address ? driver.pickup_address.name : 'No location'}</td>
            <td>${driver.active ? 'Active' : 'Inactive'} / ${driver.is_online ? 'Online' : 'Offline'}</td>
            <td>${driver.max_delivery_distance_miles || 15} mi / ${driver.max_concurrent_orders || 1} max</td>
            <td>${driver.accepts_delivery ? 'Delivery' : ''}${driver.accepts_delivery && driver.accepts_pickup ? ' / ' : ''}${driver.accepts_pickup ? 'Pickup' : ''}</td>
            <td>${driver.delivered_orders || 0}</td>
            <td>${driver.active_orders || 0}</td>
            <td>
                <button class="btn btn-info btn-sm" onclick="showDriverInventory(${driver.id})">Inventory</button>
                <button class="btn btn-warning btn-sm" onclick="editDriver(${driver.id})">Edit</button>
                <button class="btn btn-secondary btn-sm" onclick="toggleDriverOnline(${driver.id}, ${!driver.is_online})">
                    ${driver.is_online ? 'Go Offline' : 'Go Online'}
                </button>
                <button class="btn btn-warning btn-sm" onclick="toggleDriverStatus(${driver.id}, ${!driver.active})">
                    ${driver.active ? 'Deactivate' : 'Activate'}
                </button>
                ${!driver.active ? `
                    <button class="btn btn-danger btn-sm" onclick="deleteDriver(${driver.id}, true)">Delete</button>
                ` : ''}
            </td>
        </tr>
    `).join('');
}

function showAddDriverModal() {
    const modalContent = `
        <div class="modal-header">
            <h3>Add New Driver</h3>
        </div>
        <div class="modal-body">
            <form id="addDriverForm">
                <div class="form-group">
                    <label>Driver Name</label>
                    <input type="text" id="driverName" required class="form-control">
                </div>
                <div class="form-group">
                    <label>Telegram ID</label>
                    <input type="number" id="driverTelegramId" required class="form-control">
                </div>
                <div class="form-group">
                    <label>Pickup Location (Optional)</label>
                    <select id="driverPickupAddress" class="form-control">
                        <option value="">Select pickup location</option>
                        <!-- Will be populated dynamically -->
                    </select>
                </div>
                <div class="form-group" style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" style="width:20px; height:20px" id="driverIsOnline" checked>
                    <label for="driverIsOnline" style="margin: 0;">Online</label>
                </div>
                <div class="form-group" style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" style="width:20px; height:20px" id="driverAcceptsDelivery" checked>
                    <label for="driverAcceptsDelivery" style="margin: 0;">Accept delivery orders</label>
                </div>
                <div class="form-group" style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" style="width:20px; height:20px" id="driverAcceptsPickup" checked>
                    <label for="driverAcceptsPickup" style="margin: 0;">Accept pickup orders</label>
                </div>
                <div class="form-group">
                    <label>Max Delivery Distance (miles)</label>
                    <input type="number" id="driverMaxDistance" min="1" step="0.5" value="15" class="form-control">
                </div>
                <div class="form-group">
                    <label>Max Concurrent Orders</label>
                    <input type="number" id="driverMaxConcurrentOrders" min="1" step="1" value="1" class="form-control">
                </div>
                <div id="addDriverResult"></div>
            </form>
        </div>
        <div class="modal-footer">
            <button type="submit" form="addDriverForm" class="btn btn-success">Add Driver</button>
            <button class="btn btn-secondary" onclick="closeModal('addDriverModal')">Cancel</button>
        </div>
    `;
    
    showModal('addDriverModal', modalContent);
    
    // Populate pickup addresses
    populatePickupAddressesForDriver();
    
    // Handle form submission
    document.getElementById('addDriverForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await addDriver();
    });
}

async function populatePickupAddressesForDriver() {
    try {
        const response = await axios.get(`${API_BASE}/pickup-addresses`);
        const select = document.getElementById('driverPickupAddress');
        
        if (select && response.data) {
            select.innerHTML = '<option value="">Select pickup location</option>' +
                response.data.map(addr => `
                    <option value="${addr.id}">
                        ${addr.name} - ${addr.address}
                    </option>
                `).join('');
        }
        
    } catch (error) {
        console.error('Error loading pickup addresses:', error);
    }
}

async function addDriver() {
    const name = document.getElementById('driverName').value;
    const telegramId = document.getElementById('driverTelegramId').value;
    const pickupAddressId = document.getElementById('driverPickupAddress').value;
    const isOnline = document.getElementById('driverIsOnline').checked;
    const acceptsDelivery = document.getElementById('driverAcceptsDelivery').checked;
    const acceptsPickup = document.getElementById('driverAcceptsPickup').checked;
    const maxDistance = document.getElementById('driverMaxDistance').value;
    const maxConcurrentOrders = document.getElementById('driverMaxConcurrentOrders').value;
    const resultDiv = document.getElementById('addDriverResult');
    
    try {
        resultDiv.innerHTML = '<div style="color: #0066cc; padding: 10px; background: #e6f2ff; border-radius: 5px;">Adding driver...</div>';
        
        await axios.post(`${API_BASE}/drivers`, {
            name: name,
            telegram_id: parseInt(telegramId),
            active: true,
            is_online: isOnline,
            accepts_delivery: acceptsDelivery,
            accepts_pickup: acceptsPickup,
            max_delivery_distance_miles: maxDistance ? parseFloat(maxDistance) : 15,
            max_concurrent_orders: maxConcurrentOrders ? parseInt(maxConcurrentOrders) : 1,
            pickup_address_id: pickupAddressId ? parseInt(pickupAddressId) : null
        });
        
        resultDiv.innerHTML = '<div style="color: green; padding: 10px; background: #e6ffe6; border-radius: 5px;">Driver added successfully!</div>';
        
        setTimeout(() => {
            closeModal('addDriverModal');
            loadDrivers();
        }, 2000);
        
    } catch (error) {
        console.error('Error adding driver:', error);
        resultDiv.innerHTML = `
            <div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">
                Error adding driver: ${error.response?.data?.detail || error.message}
            </div>
        `;
    }
}

async function editDriver(driverId) {
    try {
        const response = await axios.get(`${API_BASE}/drivers`);
        const driver = response.data.find(d => d.id === driverId);
        
        if (driver) {
            const modalContent = `
                <div class="modal-header">
                    <h3>Edit Driver</h3>
                </div>
                <div class="modal-body">
                    <form id="editDriverForm">
                        <div class="form-group">
                            <label>Driver Name</label>
                            <input type="text" id="editDriverName" value="${driver.name}" required class="form-control">
                        </div>
                        <div class="form-group">
                            <label>Telegram ID</label>
                            <input type="number" id="editDriverTelegramId" value="${driver.telegram_id}" required class="form-control">
                        </div>
                        <div class="form-group">
                            <label>Pickup Location</label>
                            <select id="editDriverPickupAddress" class="form-control">
                                <option value="">Select pickup location</option>
                                <!-- Will be populated dynamically -->
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Max Delivery Distance (miles)</label>
                            <input type="number" id="editDriverMaxDistance" value="${driver.max_delivery_distance_miles || 15}" min="1" step="0.5" class="form-control">
                        </div>
                        <div class="form-group">
                            <label>Max Concurrent Orders</label>
                            <input type="number" id="editDriverMaxConcurrentOrders" value="${driver.max_concurrent_orders || 1}" min="1" step="1" class="form-control">
                        </div>
                        <div class="form-group" style="display: flex; align-items: center; justify-content: flex-start; gap: 5px;">
                            <input type="checkbox" style="width:20px; height: 20px" id="editDriverIsOnline" ${driver.is_online ? 'checked' : ''}>
                            <label for="editDriverIsOnline" style="margin: 0;">Online</label>
                        </div>
                        <div class="form-group" style="display: flex; align-items: center; justify-content: flex-start; gap: 5px;">
                            <input type="checkbox" style="width:20px; height: 20px" id="editDriverAcceptsDelivery" ${driver.accepts_delivery ? 'checked' : ''}>
                            <label for="editDriverAcceptsDelivery" style="margin: 0;">Accept delivery orders</label>
                        </div>
                        <div class="form-group" style="display: flex; align-items: center; justify-content: flex-start; gap: 5px;">
                            <input type="checkbox" style="width:20px; height: 20px" id="editDriverAcceptsPickup" ${driver.accepts_pickup ? 'checked' : ''}>
                            <label for="editDriverAcceptsPickup" style="margin: 0;">Accept pickup orders</label>
                        </div>
                        <div class="form-group" style="display: flex; align-items: center; justify-content: flex-start; gap: 5px;">
                            <input type="checkbox" style="width:20px; height: 20px" id="editDriverActive" ${driver.active ? 'checked' : ''}>
                            <label for="editDriverActive" style="margin: 0;">Active</label>
                        </div>
                        <div id="editDriverResult"></div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="submit" form="editDriverForm" class="btn btn-success">Update Driver</button>
                    <button class="btn btn-secondary" onclick="closeModal('editDriverModal')">Cancel</button>
                </div>
            `;
            
            showModal('editDriverModal', modalContent);
            
            // Populate pickup addresses and set current selection
            await populateEditPickupAddresses(driver.pickup_address?.id);
            
            document.getElementById('editDriverForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                await updateDriver(driverId);
            });
        }
        
    } catch (error) {
        console.error('Error loading driver for edit:', error);
        showNotification('Error loading driver', 'error');
    }
}

async function populateEditPickupAddresses(selectedId) {
    try {
        const response = await axios.get(`${API_BASE}/pickup-addresses`);
        const select = document.getElementById('editDriverPickupAddress');
        
        if (select && response.data) {
            select.innerHTML = '<option value="">Select pickup location</option>' +
                response.data.map(addr => `
                    <option value="${addr.id}" ${addr.id === selectedId ? 'selected' : ''}>
                        ${addr.name} - ${addr.address}
                    </option>
                `).join('');
        }
        
    } catch (error) {
        console.error('Error loading pickup addresses:', error);
    }
}

async function updateDriver(driverId) {
    const name = document.getElementById('editDriverName').value;
    const telegramId = document.getElementById('editDriverTelegramId').value;
    const pickupAddressId = document.getElementById('editDriverPickupAddress').value;
    const active = document.getElementById('editDriverActive').checked;
    const isOnline = document.getElementById('editDriverIsOnline').checked;
    const acceptsDelivery = document.getElementById('editDriverAcceptsDelivery').checked;
    const acceptsPickup = document.getElementById('editDriverAcceptsPickup').checked;
    const maxDistance = document.getElementById('editDriverMaxDistance').value;
    const maxConcurrentOrders = document.getElementById('editDriverMaxConcurrentOrders').value;
    const resultDiv = document.getElementById('editDriverResult');
    
    try {
        resultDiv.innerHTML = '<div style="color: #0066cc; padding: 10px; background: #e6f2ff; border-radius: 5px;">Updating driver...</div>';
        
        await axios.put(`${API_BASE}/drivers/${driverId}`, {
            name: name,
            telegram_id: parseInt(telegramId),
            pickup_address_id: pickupAddressId ? parseInt(pickupAddressId) : null,
            active: active,
            is_online: isOnline,
            accepts_delivery: acceptsDelivery,
            accepts_pickup: acceptsPickup,
            max_delivery_distance_miles: maxDistance ? parseFloat(maxDistance) : 15,
            max_concurrent_orders: maxConcurrentOrders ? parseInt(maxConcurrentOrders) : 1
        });
        
        resultDiv.innerHTML = '<div style="color: green; padding: 10px; background: #e6ffe6; border-radius: 5px;">Driver updated successfully!</div>';
        
        setTimeout(() => {
            closeModal('editDriverModal');
            loadDrivers();
        }, 2000);
        
    } catch (error) {
        console.error('Error updating driver:', error);
        resultDiv.innerHTML = `
            <div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">
                Error updating driver: ${error.response?.data?.detail || error.message}
            </div>
        `;
    }
}

async function toggleDriverStatus(driverId, active) {
    try {
        await axios.put(`${API_BASE}/drivers/${driverId}`, { active });
        showNotification(`Driver ${active ? 'activated' : 'deactivated'}`, 'success');
        loadDrivers();
    } catch (error) {
        console.error('Error updating driver status:', error);
        showNotification('Error updating driver status', 'error');
    }
}

async function toggleDriverOnline(driverId, isOnline) {
    try {
        await axios.put(`${API_BASE}/drivers/${driverId}`, { is_online: isOnline });
        showNotification(`Driver marked ${isOnline ? 'online' : 'offline'}`, 'success');
        loadDrivers();
    } catch (error) {
        console.error('Error updating driver availability:', error);
        showNotification('Error updating driver availability', 'error');
    }
}

async function deleteDriver(driverId, permanent = false) {
    const message = permanent
        ? `Are you sure you want to PERMANENTLY DELETE this driver? This cannot be undone!`
        : `Are you sure you want to deactivate this driver?`;
    
    if (!confirm(message)) return;
    
    try {
        if (permanent) {
            await axios.delete(`${API_BASE}/drivers/${driverId}/permanent`);
            showNotification('Driver permanently deleted', 'success');
        } else {
            await axios.put(`${API_BASE}/drivers/${driverId}`, { active: false });
            showNotification('Driver deactivated', 'success');
        }
        loadDrivers();
    } catch (error) {
        console.error('Error deleting driver:', error);
        showNotification('Error deleting driver', 'error');
    }
}

async function showDriverInventory(driverId) {
    try {
        const response = await axios.get(`${API_BASE}/inventory/drivers/${driverId}/stock`);
        const inventory = response.data;
        
        const modalContent = `
            <div class="modal-header">
                <h3>Driver Inventory Management</h3>
            </div>
            <div class="modal-body">
                <div style="max-height: 400px; overflow-y: auto;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #f8f9fa;">
                                <th style="padding: 12px; border: 1px solid #ddd; text-align: left;">Item</th>
                                <th style="padding: 12px; border: 1px solid #ddd; text-align: center;">Category</th>
                                <th style="padding: 12px; border: 1px solid #ddd; text-align: center;">On Hand</th>
                                <th style="padding: 12px; border: 1px solid #ddd; text-align: center;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${inventory && inventory.length > 0 ? inventory.map(item => `
                                <tr>
                                    <td style="padding: 12px; border: 1px solid #ddd;">${item.menu_item_name || 'Unknown Item'}</td>
                                    <td style="padding: 12px; border: 1px solid #ddd; text-align: center;">${item.category || 'Uncategorized'}</td>
                                    <td style="padding: 12px; border: 1px solid #ddd; text-align: center; font-weight: bold;">${item.on_hand_qty || 0}</td>
                                    <td style="padding: 12px; border: 1px solid #ddd; text-align: center;">
                                        <button class="btn btn-warning btn-sm" onclick="showAdjustStockModal(${driverId}, ${item.menu_item_id}, '${item.menu_item_name}', ${item.on_hand_qty || 0})">
                                            Adjust
                                        </button>
                                        <button class="btn btn-primary btn-sm" onclick="showLoadoutModal(${driverId}, ${item.menu_item_id}, '${item.menu_item_name}')">
                                            Loadout
                                        </button>
                                    </td>
                                </tr>
                            `).join('') : `
                                <tr>
                                    <td colspan="4" style="padding: 20px; text-align: center; color: #666;">
                                        No inventory items found
                                    </td>
                                </tr>
                            `}
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-success" onclick="showLoadoutModal(${driverId})">Add New Item</button>
                <button class="btn btn-secondary" onclick="closeModal('driverInventoryModal')">Close</button>
            </div>
        `;
        
        showModal('driverInventoryModal', modalContent, { scrollable: true });
        
    } catch (error) {
        console.error('Error loading driver inventory:', error);
        showNotification('Error loading driver inventory', 'error');
    }
}

// Loadout and stock adjustment functions
function showLoadoutModal(driverId, menuItemId = null, menuItemName = null) {
    const modalContent = `
        <div class="modal-header">
            <h3>${menuItemId ? 'Loadout Item' : 'Add New Item to Driver'}</h3>
        </div>
        <div class="modal-body">
            <form id="loadoutForm">
                <div class="form-group">
                    <label>Menu Item:</label>
                    ${menuItemId ? 
                        `<input type="text" value="${menuItemName}" readonly class="form-control">
                         <input type="hidden" id="loadoutMenuItemId" value="${menuItemId}">` :
                        `<select id="loadoutMenuItemId" required class="form-control">
                            <option value="">Select menu item</option>
                            <!-- Will be populated dynamically -->
                        </select>`
                    }
                </div>
                <div class="form-group">
                    <label>Quantity:</label>
                    <input type="number" id="loadoutQuantity" min="1" value="1" required class="form-control">
                </div>
                <div class="form-group">
                    <label>Reason Note:</label>
                    <input type="text" id="loadoutReason" value="Admin loadout" class="form-control">
                </div>
                <div id="loadoutResult"></div>
            </form>
        </div>
        <div class="modal-footer">
            <button type="submit" form="loadoutForm" class="btn btn-success">Submit Loadout</button>
            <button type="button" class="btn btn-secondary" onclick="closeModal('loadoutModal')">Cancel</button>
        </div>
    `;
    
    showModal('loadoutModal', modalContent);
    
    // Populate menu items if needed
    if (!menuItemId) {
        populateMenuItemsForLoadout();
    }
    
    // Handle form submission
    document.getElementById('loadoutForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitLoadout(driverId);
    });
}

async function populateMenuItemsForLoadout() {
    try {
        const response = await axios.get(`${API_BASE}/menu/items?active_only=true`);
        const select = document.getElementById('loadoutMenuItemId');
        
        if (select && response.data) {
            select.innerHTML = '<option value="">Select menu item</option>' +
                response.data.map(item => `
                    <option value="${item.id}">
                        ${item.name} (${item.category || 'Uncategorized'})
                    </option>
                `).join('');
        }
        
    } catch (error) {
        console.error('Error loading menu items for loadout:', error);
        showNotification('Error loading menu items', 'error');
    }
}

async function submitLoadout(driverId) {
    const menuItemId = document.getElementById('loadoutMenuItemId').value;
    const quantity = document.getElementById('loadoutQuantity').value;
    const reason = document.getElementById('loadoutReason').value;
    const resultDiv = document.getElementById('loadoutResult');
    
    if (!menuItemId) {
        resultDiv.innerHTML = '<div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">Please select a menu item</div>';
        return;
    }
    
    try {
        resultDiv.innerHTML = '<div style="color: #0066cc; padding: 10px; background: #e6f2ff; border-radius: 5px;">Submitting loadout...</div>';
        
        await axios.post(`${API_BASE}/inventory/drivers/${driverId}/loadout`, {
            menu_item_id: parseInt(menuItemId),
            quantity: parseInt(quantity),
            reason_note: reason
        });
        
        resultDiv.innerHTML = '<div style="color: green; padding: 10px; background: #e6ffe6; border-radius: 5px;">Loadout submitted successfully!</div>';
        
        setTimeout(() => {
            closeModal('loadoutModal');
            showDriverInventory(driverId); // Refresh inventory view
        }, 2000);
        
    } catch (error) {
        console.error('Error submitting loadout:', error);
        resultDiv.innerHTML = `
            <div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">
                Error submitting loadout: ${error.response?.data?.detail || error.message}
            </div>
        `;
    }
}

function showAdjustStockModal(driverId, menuItemId, menuItemName, currentQty) {
    const modalContent = `
        <div class="modal-header">
            <h3>Adjust Stock</h3>
        </div>
        <div class="modal-body">
            <p><strong>Item:</strong> ${menuItemName}</p>
            <p><strong>Current Quantity:</strong> ${currentQty}</p>
            <form id="adjustStockForm">
                <div class="form-group">
                    <label>New Quantity:</label>
                    <input type="number" id="adjustQuantity" value="${currentQty}" min="0" required class="form-control">
                </div>
                <div class="form-group">
                    <label>Reason Note:</label>
                    <input type="text" id="adjustReason" value="Stock adjustment" class="form-control">
                </div>
                <div id="adjustStockResult"></div>
            </form>
        </div>
        <div class="modal-footer">
            <button type="submit" form="adjustStockForm" class="btn btn-success">Update Stock</button>
            <button type="button" class="btn btn-secondary" onclick="closeModal('adjustStockModal')">Cancel</button>
        </div>
    `;
    
    showModal('adjustStockModal', modalContent);
    
    document.getElementById('adjustStockForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitStockAdjustment(driverId, menuItemId);
    });
}

async function submitStockAdjustment(driverId, menuItemId) {
    const newQuantity = document.getElementById('adjustQuantity').value;
    const reason = document.getElementById('adjustReason').value;
    const resultDiv = document.getElementById('adjustStockResult');
    
    try {
        resultDiv.innerHTML = '<div style="color: #0066cc; padding: 10px; background: #e6f2ff; border-radius: 5px;">Updating stock...</div>';
        
        await axios.post(`${API_BASE}/inventory/drivers/${driverId}/adjust`, {
            menu_item_id: parseInt(menuItemId),
            new_quantity: parseInt(newQuantity),
            reason_note: reason
        });
        
        resultDiv.innerHTML = '<div style="color: green; padding: 10px; background: #e6ffe6; border-radius: 5px;">Stock updated successfully!</div>';
        
        setTimeout(() => {
            closeModal('adjustStockModal');
            showDriverInventory(driverId); // Refresh inventory view
        }, 2000);
        
    } catch (error) {
        console.error('Error updating stock:', error);
        resultDiv.innerHTML = `
            <div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">
                Error updating stock: ${error.response?.data?.detail || error.message}
            </div>
        `;
    }
}
