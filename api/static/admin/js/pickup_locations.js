async function initPickupLocations() {
    console.log('Pickup Locations module initialized');
}

async function loadPickupLocations() {
    try {
        const response = await axios.get(`${API_BASE}/pickup-addresses`);
        updatePickupLocationsTable(response.data);
        
    } catch (error) {
        console.error('Error loading pickup locations:', error);
        showNotification('Error loading pickup locations', 'error');
    }
}

function updatePickupLocationsTable(addresses) {
    const tbody = document.querySelector('#pickupAddressesTable tbody');
    if (!tbody) return;
    
    if (!addresses || addresses.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 20px; color: #666;">
                    No pickup locations found
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = addresses.map(addr => `
        <tr>
            <td>${addr.name || 'N/A'}</td>
            <td>${addr.address || 'N/A'}</td>
            <td>${addr.instructions || 'No special instructions'}</td>
            <td>${addr.active ? 'Active' : 'Inactive'}</td>
            <td>
                <button class="btn btn-warning btn-sm" onclick="editPickupLocation(${addr.id})">Edit</button>
                ${addr.active ? 
                    `<button class="btn btn-danger btn-sm" onclick="deactivatePickupLocation(${addr.id})">Deactivate</button>` :
                    `<button class="btn btn-success btn-sm" onclick="activatePickupLocation(${addr.id})">Activate</button>`
                }
            </td>
        </tr>
    `).join('');
}

function showAddPickupAddressModal() {
    const modalContent = `
        <div class="modal-header">
            <h3>Add Pickup Location</h3>
        </div>
        <div class="modal-body">
            <form id="pickupLocationForm">
                <div class="form-group">
                    <label>Location Name</label>
                    <input type="text" id="pickupName" required class="form-control" placeholder="e.g., Main Store, Downtown Location">
                </div>
                <div class="form-group">
                    <label>Address</label>
                    <textarea id="pickupAddress" rows="3" required class="form-control" placeholder="Full street address"></textarea>
                </div>
                <div class="form-group">
                    <label>Instructions (Optional)</label>
                    <textarea id="pickupInstructions" rows="2" class="form-control" placeholder="Special instructions for customers"></textarea>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="pickupActive" checked> Active
                    </label>
                </div>
                <div id="pickupLocationResult"></div>
            </form>
        </div>
        <div class="modal-footer">
            <button type="submit" form="pickupLocationForm" class="btn btn-success">Add Location</button>
            <button class="btn btn-secondary" onclick="closeModal('pickupLocationModal')">Cancel</button>
        </div>
    `;
    
    showModal('pickupLocationModal', modalContent);
    
    document.getElementById('pickupLocationForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await addPickupLocation();
    });
}

async function addPickupLocation() {
    const name = document.getElementById('pickupName').value;
    const address = document.getElementById('pickupAddress').value;
    const instructions = document.getElementById('pickupInstructions').value;
    const active = document.getElementById('pickupActive').checked;
    const resultDiv = document.getElementById('pickupLocationResult');
    
    try {
        resultDiv.innerHTML = '<div style="color: #0066cc; padding: 10px; background: #e6f2ff; border-radius: 5px;">Adding pickup location...</div>';
        
        await axios.post(`${API_BASE}/pickup-addresses`, {
            name: name,
            address: address,
            instructions: instructions,
            active: active
        });
        
        resultDiv.innerHTML = '<div style="color: green; padding: 10px; background: #e6ffe6; border-radius: 5px;">Pickup location added successfully!</div>';
        
        setTimeout(() => {
            closeModal('pickupLocationModal');
            loadPickupLocations();
        }, 2000);
        
    } catch (error) {
        console.error('Error adding pickup location:', error);
        resultDiv.innerHTML = `
            <div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">
                Error adding pickup location: ${error.response?.data?.detail || error.message}
            </div>
        `;
    }
}

async function editPickupLocation(locationId) {
    try {
        const response = await axios.get(`${API_BASE}/pickup-addresses`);
        const location = response.data.find(addr => addr.id === locationId);
        
        if (location) {
            const modalContent = `
                <div class="modal-header">
                    <h3>Edit Pickup Location</h3>
                </div>
                <div class="modal-body">
                    <form id="pickupLocationForm">
                        <div class="form-group">
                            <label>Location Name</label>
                            <input type="text" id="pickupName" value="${location.name}" required class="form-control">
                        </div>
                        <div class="form-group">
                            <label>Address</label>
                            <textarea id="pickupAddress" rows="3" required class="form-control">${location.address}</textarea>
                        </div>
                        <div class="form-group">
                            <label>Instructions (Optional)</label>
                            <textarea id="pickupInstructions" rows="2" class="form-control">${location.instructions || ''}</textarea>
                        </div>
                        <div class="form-group">
                            <label>
                                <input type="checkbox" id="pickupActive" ${location.active ? 'checked' : ''}> Active
                            </label>
                        </div>
                        <div id="pickupLocationResult"></div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="submit" form="pickupLocationForm" class="btn btn-success">Update Location</button>
                    <button class="btn btn-secondary" onclick="closeModal('pickupLocationModal')">Cancel</button>
                </div>
            `;
            
            showModal('pickupLocationModal', modalContent);
            
            document.getElementById('pickupLocationForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                await updatePickupLocation(locationId);
            });
        }
        
    } catch (error) {
        console.error('Error loading pickup location for edit:', error);
        showNotification('Error loading pickup location', 'error');
    }
}

async function updatePickupLocation(locationId) {
    const name = document.getElementById('pickupName').value;
    const address = document.getElementById('pickupAddress').value;
    const instructions = document.getElementById('pickupInstructions').value;
    const active = document.getElementById('pickupActive').checked;
    const resultDiv = document.getElementById('pickupLocationResult');
    
    try {
        resultDiv.innerHTML = '<div style="color: #0066cc; padding: 10px; background: #e6f2ff; border-radius: 5px;">Updating pickup location...</div>';
        
        await axios.put(`${API_BASE}/pickup-addresses/${locationId}`, {
            name: name,
            address: address,
            instructions: instructions,
            active: active
        });
        
        resultDiv.innerHTML = '<div style="color: green; padding: 10px; background: #e6ffe6; border-radius: 5px;">Pickup location updated successfully!</div>';
        
        setTimeout(() => {
            closeModal('pickupLocationModal');
            loadPickupLocations();
        }, 2000);
        
    } catch (error) {
        console.error('Error updating pickup location:', error);
        resultDiv.innerHTML = `
            <div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">
                Error updating pickup location: ${error.response?.data?.detail || error.message}
            </div>
        `;
    }
}

async function deactivatePickupLocation(locationId) {
    if (!confirm('Are you sure you want to deactivate this pickup location?')) return;
    
    try {
        await axios.put(`${API_BASE}/pickup-addresses/${locationId}`, { active: false });
        showNotification('Pickup location deactivated', 'success');
        loadPickupLocations();
    } catch (error) {
        console.error('Error deactivating pickup location:', error);
        showNotification('Error deactivating pickup location', 'error');
    }
}

async function activatePickupLocation(locationId) {
    try {
        await axios.put(`${API_BASE}/pickup-addresses/${locationId}`, { active: true });
        showNotification('Pickup location activated', 'success');
        loadPickupLocations();
    } catch (error) {
        console.error('Error activating pickup location:', error);
        showNotification('Error activating pickup location', 'error');
    }
}