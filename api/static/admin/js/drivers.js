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
                <td colspan="6" style="text-align: center; padding: 20px; color: #666;">
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
            <td>${driver.active ? 'Active' : 'Inactive'}</td>
            <td>${driver.delivered_orders || 0}</td>
            <td>${driver.active_orders || 0}</td>
            <td>
                <button class="btn btn-info btn-sm" onclick="showDriverInventory(${driver.id})">Inventory</button>
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
                <div id="addDriverResult"></div>
            </form>
        </div>
        <div class="modal-footer">
            <button type="submit" form="addDriverForm" class="btn btn-success">Add Driver</button>
            <button class="btn btn-secondary" onclick="closeModal('addDriverModal')">Cancel</button>
        </div>
    `;
    
    showModal('addDriverModal', modalContent);
    
    // Handle form submission
    document.getElementById('addDriverForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await addDriver();
    });
}

async function addDriver() {
    const name = document.getElementById('driverName').value;
    const telegramId = document.getElementById('driverTelegramId').value;
    const resultDiv = document.getElementById('addDriverResult');
    
    try {
        resultDiv.innerHTML = '<div style="color: #0066cc; padding: 10px; background: #e6f2ff; border-radius: 5px;">Adding driver...</div>';
        
        await axios.post(`${API_BASE}/drivers`, {
            name: name,
            telegram_id: parseInt(telegramId),
            active: true
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
