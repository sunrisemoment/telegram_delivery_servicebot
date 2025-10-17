let editingMenuItemId = null;

async function initMenu() {
    await loadCategories();
    initializePhotoUpload();
    console.log('Menu module initialized');
}

// Photo upload functionality
function initializePhotoUpload() {
    // This will be called when the menu modal is shown
    console.log('Photo upload initialized');
}

function setupPhotoUpload() {
    const photoInput = document.getElementById('menuPhoto');
    const uploadArea = document.getElementById('photoUploadArea');
    const preview = document.getElementById('photoPreview');
    const previewImage = document.getElementById('previewImage');

    if (!uploadArea) return;

    // Create upload area if it doesn't exist
    if (!uploadArea) {
        const photoGroup = document.querySelector('.form-group:has(#menuPhoto)');
        if (photoGroup) {
            const newUploadArea = document.createElement('div');
            newUploadArea.className = 'photo-upload-area';
            newUploadArea.id = 'photoUploadArea';
            newUploadArea.innerHTML = `
                <input type="file" id="menuPhoto" accept="image/*" style="display: none;">
                <div style="font-size: 48px; color: #666;">📷</div>
                <p style="margin: 10px 0; color: #666;">Click to upload a photo</p>
                <small style="color: #999;">JPEG, PNG, GIF, WebP (Max 5MB)</small>
            `;
            photoGroup.appendChild(newUploadArea);
        }
    }
// Click to upload
    uploadArea.addEventListener('click', () => {
        photoInput.click();
    });

    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileSelect(files[0]);
        }
    });

    // File input change
    photoInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    function handleFileSelect(file) {
        // Validate file
        if (!file.type.startsWith('image/')) {
            showNotification('Please select an image file', 'error');
            return;
        }

        if (file.size > 5 * 1024 * 1024) { // 5MB limit
            showNotification('File size must be less than 5MB', 'error');
            return;
        }

        // Show preview
        const reader = new FileReader();
        reader.onload = (e) => {
            if (!preview) {
                createPhotoPreview();
            }
            previewImage.src = e.target.result;
            document.getElementById('photoUploadArea').style.display = 'none';
            document.getElementById('photoPreview').style.display = 'block';
            
            // Upload file
            uploadPhoto(file);
        };
        reader.readAsDataURL(file);
    }
}

function createPhotoPreview() {
    const uploadArea = document.getElementById('photoUploadArea');
    const photoGroup = uploadArea.parentElement;
    
    const previewDiv = document.createElement('div');
    previewDiv.id = 'photoPreview';
    previewDiv.style.display = 'none';
    previewDiv.innerHTML = `
        <img id="previewImage" style="max-width: 200px; max-height: 150px; border-radius: 5px;">
        <div style="margin-top: 10px;">
            <button type="button" class="btn btn-warning btn-sm" onclick="removePhoto()">Remove Photo</button>
        </div>
    `;
    
    photoGroup.appendChild(previewDiv);
}

// Upload photo to server
async function uploadPhoto(file) {
    const progressDiv = document.getElementById('uploadProgress');
    const submitBtn = document.querySelector('#menuItemForm button[type="submit"]');

    // Create progress indicator if it doesn't exist
    if (!progressDiv) {
        const photoGroup = document.getElementById('photoUploadArea').parentElement;
        const progress = document.createElement('div');
        progress.id = 'uploadProgress';
        progress.style.display = 'block';
        progress.innerHTML = `
            <div style="background: #f0f0f0; border-radius: 10px; height: 6px; margin-top: 5px;">
                <div id="progressBar" style="background: #3498db; height: 100%; width: 0%; border-radius: 10px; transition: width 0.3s;"></div>
            </div>
            <small id="progressText" style="color: #666;">Uploading...</small>
        `;
        photoGroup.appendChild(progress);
    } else {
        progressDiv.style.display = 'block';
    }

    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');

    if (submitBtn) submitBtn.disabled = true;

    try {
        const formData = new FormData();
        formData.append('file', file);
        
        if (oldPhotoUrl) {
            formData.append('old_photo_url', oldPhotoUrl);
        }

        // Try main endpoint first, then admin endpoint
        let uploadUrl = `${API_BASE}/upload-photo`;
        
        const response = await axios.post(uploadUrl, formData, {
            headers: {
                'Content-Type': 'multipart/form-data'
            },
            onUploadProgress: (progressEvent) => {
                if (progressEvent.lengthComputable) {
                    const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                    if (progressBar) progressBar.style.width = percentCompleted + '%';
                    if (progressText) progressText.textContent = `Uploading: ${percentCompleted}%`;
                }
            }
        });

        if (response.data.photo_url) {
            if (oldPhotoUrl) {
                console.log('🗑️ Old photo marked for replacement:', oldPhotoUrl);
                oldPhotoUrl = null;
            }
            currentPhotoUrl = response.data.photo_url;
            if (progressBar) progressBar.style.background = '#27ae60';
            if (progressText) {
                progressText.textContent = 'Upload completed!';
                progressText.style.color = '#27ae60';
            }
            
            setTimeout(() => {
                if (progressDiv) progressDiv.style.display = 'none';
                if (submitBtn) submitBtn.disabled = false;
            }, 2000);
            
            showNotification('Photo uploaded successfully!', 'success');
        } else {
            throw new Error(response.data.error || 'Upload failed');
        }

    } catch (error) {
        console.error('Upload error:', error);
        if (progressBar) {
            progressBar.style.background = '#e74c3c';
            progressBar.style.width = '100%';
        }
        if (progressText) {
            progressText.textContent = 'Upload failed: ' + (error.response?.data?.detail || error.message);
            progressText.style.color = '#e74c3c';
        }
        if (submitBtn) submitBtn.disabled = false;

        removePhoto();
        showNotification('Photo upload failed', 'error');
    }
}

// Remove photo
function removePhoto() {
    const uploadArea = document.getElementById('photoUploadArea');
    const preview = document.getElementById('photoPreview');
    const photoInput = document.getElementById('menuPhoto');
    const progressDiv = document.getElementById('uploadProgress');

    if (currentPhotoUrl && editingMenuItemId) {
        oldPhotoUrl = currentPhotoUrl;
        console.log('🗑️ Photo marked for deletion:', oldPhotoUrl);
    }

    if (uploadArea) uploadArea.style.display = 'block';
    if (preview) preview.style.display = 'none';
    if (photoInput) photoInput.value = '';
    if (progressDiv) progressDiv.style.display = 'none';
    currentPhotoUrl = null;
    
    // Reset any existing file input
    const fileInput = document.getElementById('menuPhoto');
    if (fileInput) {
        fileInput.value = '';
    }
}

async function loadMenu() {
    try {
        const searchTerm = document.getElementById('menuSearch').value;
        const categoryFilter = document.getElementById('categoryFilter').value;
        const statusFilter = document.getElementById('statusFilter').value;
        
        let url = `${API_BASE}/menu/items?`;
        
        const params = [];
        if (searchTerm) params.push(`search=${encodeURIComponent(searchTerm)}`);
        if (categoryFilter) params.push(`category=${encodeURIComponent(categoryFilter)}`);
        if (statusFilter === 'active') params.push('active_only=true');
        if (statusFilter === 'inactive') params.push('active_only=false');
        
        url += params.join('&') || 'active_only=false';
        
        const response = await axios.get(url);
        updateMenuTable(response.data);
        
    } catch (error) {
        console.error('Error loading menu:', error);
        showNotification('Error loading menu items', 'error');
    }
}

async function loadCategories() {
    try {
        const response = await axios.get(`${API_BASE}/menu/categories`);
        const categoryFilter = document.getElementById('categoryFilter');
        
        if (categoryFilter) {
            categoryFilter.innerHTML = '<option value="">All Categories</option>' +
                response.data.map(cat => `<option value="${cat}">${cat}</option>`).join('');
        }
        
    } catch (error) {
        console.error('Error loading categories:', error);
    }
}

function updateMenuTable(menuItems) {
    const tbody = document.querySelector('#menuTable tbody');
    if (!tbody) return;
    
    if (!menuItems || menuItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 20px; color: #666;">
                    No menu items found
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = menuItems.map(item => `
        <tr>
            <td>
                ${item.photo_url ? 
                    `<img src="${item.photo_url}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 5px;" alt="${item.name}">` : 
                    '<div style="width: 50px; height: 50px; background: #f0f0f0; border-radius: 5px; display: flex; align-items: center; justify-content: center; color: #999;">📷</div>'
                }
            </td>
            <td>${item.category || 'Uncategorized'}</td>
            <td>${item.name}</td>
            <td>${item.description || 'No description'}</td>
            <td>${formatCurrency(item.price_cents || item.price || 0)}</td>
            <td>${item.stock || 0}</td>
            <td>${item.active ? 'Active' : 'Inactive'}</td>
            <td>
                <button class="btn btn-warning btn-sm" onclick="editMenuItem(${item.id})">Edit</button>
                ${item.active ? 
                    `<button class="btn btn-danger btn-sm" onclick="deleteMenuItem(${item.id}, false)">Deactivate</button>` : 
                    `<div style="display: flex; flex-direction: column; gap: 5px;">
                        <button class="btn btn-success btn-sm" onclick="restoreMenuItem(${item.id})">Restore</button>
                        <button class="btn btn-danger btn-sm" style="background: #dc3545; border-color: #dc3545;" 
                                onclick="deleteMenuItem(${item.id}, true)">
                            🗑️ Delete Permanent
                        </button>
                    </div>`
                }
            </td>
        </tr>
    `).join('');
}

function showAddMenuItemModal() {
    editingMenuItemId = null;
    currentPhotoUrl = null;
    oldPhotoUrl = null;
    
    const modalContent = `
        <div class="modal-header">
            <h3>Add Menu Item</h3>
        </div>
        <div class="modal-body">
            <form id="menuItemForm">
                <div class="form-group">
                    <label>Category</label>
                    <input type="text" id="menuCategory" list="categories" required class="form-control">
                    <datalist id="categories"></datalist>
                </div>
                <div class="form-group">
                    <label>Name</label>
                    <input type="text" id="menuName" required class="form-control">
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <textarea id="menuDescription" rows="3" class="form-control"></textarea>
                </div>
                <div class="form-group">
                    <label>Price ($)</label>
                    <input type="number" step="0.01" min="0" id="menuPrice" required class="form-control">
                </div>
                <div class="form-group">
                    <label>Stock</label>
                    <input type="number" id="menuStock" value="0" min="0" class="form-control">
                </div>
                <div class="form-group">
                    <label>Photo</label>
                    <div class="photo-upload-area" id="photoUploadArea">
                        <input type="file" id="menuPhoto" accept="image/*" style="display: none;">
                        <div style="font-size: 48px; color: #666;">📷</div>
                        <p style="margin: 10px 0; color: #666;">Click to upload a photo</p>
                        <small style="color: #999;">JPEG, PNG, GIF, WebP (Max 5MB)</small>
                    </div>
                    <div id="photoPreview" style="display: none;">
                        <img id="previewImage" style="max-width: 200px; max-height: 150px; border-radius: 5px;">
                        <div style="margin-top: 10px;">
                            <button type="button" class="btn btn-warning btn-sm" onclick="removePhoto()">Remove Photo</button>
                        </div>
                    </div>
                    <div id="uploadProgress" style="display: none;">
                        <div style="background: #f0f0f0; border-radius: 10px; height: 6px; margin-top: 5px;">
                            <div id="progressBar" style="background: #3498db; height: 100%; width: 0%; border-radius: 10px; transition: width 0.3s;"></div>
                        </div>
                        <small id="progressText" style="color: #666;">Uploading...</small>
                    </div>
                </div>
                <div id="menuItemResult"></div>
            </form>
        </div>
        <div class="modal-footer">
            <button type="submit" form="menuItemForm" class="btn btn-success">Add Item</button>
            <button class="btn btn-secondary" onclick="closeModal('menuItemModal')">Cancel</button>
        </div>
    `;
    
    showModal('menuItemModal', modalContent, { scrollable: true });
    
    // Load categories for datalist
    loadCategoriesForDatalist();
    
    // Initialize photo upload
    setTimeout(() => {
        setupPhotoUpload();
    }, 100);
    
    // Handle form submission
    document.getElementById('menuItemForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveMenuItem();
    });
}

async function loadCategoriesForDatalist() {
    try {
        const response = await axios.get(`${API_BASE}/menu/categories`);
        const datalist = document.getElementById('categories');
        
        if (datalist) {
            datalist.innerHTML = response.data.map(cat => `<option value="${cat}">`).join('');
        }
        
    } catch (error) {
        console.error('Error loading categories for datalist:', error);
    }
}

async function saveMenuItem() {
    const category = document.getElementById('menuCategory').value;
    const name = document.getElementById('menuName').value;
    const description = document.getElementById('menuDescription').value;
    const price = document.getElementById('menuPrice').value;
    const stock = document.getElementById('menuStock').value;
    const resultDiv = document.getElementById('menuItemResult');
    
    try {
        resultDiv.innerHTML = '<div style="color: #0066cc; padding: 10px; background: #e6f2ff; border-radius: 5px;">Saving menu item...</div>';
        
        const menuData = {
            category: category,
            name: name,
            description: description,
            price_cents: Math.round(parseFloat(price) * 100),
            stock: parseInt(stock) || 0,
            active: true
        };
        
        // Add photo URL if available
        if (currentPhotoUrl) {
            menuData.photo_url = currentPhotoUrl;
        } else if (editingMenuItemId && !currentPhotoUrl) {
            // If editing and no photo is selected, it means the photo was removed
            menuData.photo_url = null;
        }
        
        if (editingMenuItemId) {
            // If there was an old photo and it's being removed or replaced
            if (oldPhotoUrl && oldPhotoUrl !== currentPhotoUrl) {
                // Delete the old photo from server
                try {
                    await axios.delete(`${API_BASE}/delete-photo?photo_url=${encodeURIComponent(oldPhotoUrl)}`);
                    console.log('🗑️ Successfully deleted old photo');
                } catch (deleteError) {
                    console.warn('⚠️ Could not delete old photo:', deleteError);
                    // Continue with update even if deletion fails
                }
            }
            
            await axios.put(`${API_BASE}/menu/items/${editingMenuItemId}`, menuData);
            showNotification('Menu item updated successfully!', 'success');
        } else {
            await axios.post(`${API_BASE}/menu/items`, menuData);
            showNotification('Menu item added successfully!', 'success');
        }
        
        // Reset photo state
        oldPhotoUrl = null;
        currentPhotoUrl = null;
        
        setTimeout(() => {
            closeModal('menuItemModal');
            loadMenu();
        }, 2000);
        
    } catch (error) {
        console.error('Error saving menu item:', error);
        resultDiv.innerHTML = `
            <div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">
                Error saving menu item: ${error.response?.data?.detail || error.message}
            </div>
        `;
    }
}

async function editMenuItem(itemId) {
    try {
        const response = await axios.get(`${API_BASE}/menu/items?active_only=false`);
        const item = response.data.find(i => i.id === itemId);
        
        if (item) {
            editingMenuItemId = itemId;
            currentPhotoUrl = item.photo_url || null;
            oldPhotoUrl = item.photo_url || null;
            
            const modalContent = `
                <div class="modal-header">
                    <h3>Edit Menu Item</h3>
                </div>
                <div class="modal-body">
                    <form id="menuItemForm">
                        <div class="form-group">
                            <label>Category</label>
                            <input type="text" id="menuCategory" value="${item.category}" list="categories" required class="form-control">
                            <datalist id="categories"></datalist>
                        </div>
                        <div class="form-group">
                            <label>Name</label>
                            <input type="text" id="menuName" value="${item.name}" required class="form-control">
                        </div>
                        <div class="form-group">
                            <label>Description</label>
                            <textarea id="menuDescription" rows="3" class="form-control">${item.description || ''}</textarea>
                        </div>
                        <div class="form-group">
                            <label>Price ($)</label>
                            <input type="number" step="0.01" min="0" id="menuPrice" value="${(item.price_cents || item.price || 0) / 100}" required class="form-control">
                        </div>
                        <div class="form-group">
                            <label>Stock</label>
                            <input type="number" id="menuStock" value="${item.stock || 0}" min="0" class="form-control">
                        </div>
                        <div class="form-group">
                            <label>Photo</label>
                            <div class="photo-upload-area" id="photoUploadArea" ${item.photo_url ? 'style="display: none;"' : ''}>
                                <input type="file" id="menuPhoto" accept="image/*" style="display: none;">
                                <div style="font-size: 48px; color: #666;">📷</div>
                                <p style="margin: 10px 0; color: #666;">Click to upload a photo</p>
                                <small style="color: #999;">JPEG, PNG, GIF, WebP (Max 5MB)</small>
                            </div>
                            <div id="photoPreview" ${item.photo_url ? '' : 'style="display: none;"'}>
                                <img id="previewImage" src="${item.photo_url || ''}" style="max-width: 200px; max-height: 150px; border-radius: 5px;">
                                <div style="margin-top: 10px;">
                                    <button type="button" class="btn btn-warning btn-sm" onclick="removePhoto()">Remove Photo</button>
                                </div>
                            </div>
                            <div id="uploadProgress" style="display: none;">
                                <div style="background: #f0f0f0; border-radius: 10px; height: 6px; margin-top: 5px;">
                                    <div id="progressBar" style="background: #3498db; height: 100%; width: 0%; border-radius: 10px; transition: width 0.3s;"></div>
                                </div>
                                <small id="progressText" style="color: #666;">Uploading...</small>
                            </div>
                        </div>
                        <div id="menuItemResult"></div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="submit" form="menuItemForm" class="btn btn-success">Update Item</button>
                    <button class="btn btn-secondary" onclick="closeModal('menuItemModal')">Cancel</button>
                </div>
            `;
            
            showModal('menuItemModal', modalContent, { scrollable: true });
            loadCategoriesForDatalist();
            
            // Initialize photo upload
            setTimeout(() => {
                setupPhotoUpload();
            }, 100);
            
            document.getElementById('menuItemForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                await saveMenuItem();
            });
        }
        
    } catch (error) {
        console.error('Error loading menu item for edit:', error);
        showNotification('Error loading menu item', 'error');
    }
}

async function deleteMenuItem(itemId, permanent = false) {
    if (permanent) {
        await permanentDeleteMenuItem(itemId);
    } else {
        const message = `Are you sure you want to deactivate menu item ${itemId}?`;
        if (!confirm(message)) return;
        
        try {
            await axios.delete(`${API_BASE}/menu/items/${itemId}`);
            showNotification('Menu item deactivated!', 'success');
            loadMenu();
        } catch (error) {
            console.error('Error deactivating menu item:', error);
            const errorMsg = error.response?.data?.detail || 'Error deactivating menu item';
            showNotification(`Error: ${errorMsg}`, 'error');
        }
    }
}

async function permanentDeleteMenuItem(itemId) {
    try {
        // First check references using universal endpoint
        const references = await axios.get(`${API_BASE}/menu/items/${itemId}/references-universal`);
        
        if (references.data.can_safe_delete) {
            // Safe to delete
            const confirmed = await showEnhancedConfirm(
                `Are you sure you want to PERMANENTLY DELETE "${references.data.menu_item.name}"?`,
                'Permanent Delete Confirmation'
            );
            
            if (!confirmed) return;
            
            await axios.delete(`${API_BASE}/menu/items/${itemId}/permanent-universal`);
            showNotification('Menu item permanently deleted!', 'success');
            loadMenu();
        } else {
            // Show references and offer force delete
            await showReferencesModal(references.data, itemId);
        }
    } catch (error) {
        console.error('Error checking references:', error);
        
        // If reference check fails, try direct deletion with warning
        const confirmed = await showEnhancedConfirm(
            `Could not check references for menu item ${itemId}. Proceeding may cause errors if the item is referenced elsewhere. Continue anyway?`,
            'Warning: Reference Check Failed'
        );
        
        if (!confirmed) return;
        
        try {
            await axios.delete(`${API_BASE}/menu/items/${itemId}/permanent-universal`);
            showNotification('Menu item permanently deleted!', 'success');
            loadMenu();
        } catch (deleteError) {
            console.error('Error deleting menu item:', deleteError);
            const errorMsg = deleteError.response?.data?.detail || 'Error deleting menu item';
            showNotification(`Error: ${errorMsg}`, 'error');
        }
    }
}

async function showReferencesModal(referenceData, itemId) {
    const references = referenceData.references;
    const menuItem = referenceData.menu_item;
    
    const modalContent = `
        <div class="modal-header">
            <h3>⚠️ Cannot Safely Delete "${menuItem.name}"</h3>
        </div>
        <div class="modal-body">
            <p>This menu item is referenced in other parts of the system:</p>
            
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 15px 0;">
                <h4>References Found:</h4>
                <ul style="margin: 10px 0; padding-left: 20px;">
                    ${references.orders && references.orders.count > 0 ? 
                        `<li><strong>Orders:</strong> ${references.orders.count} orders reference this item</li>` : ''}
                    ${references.inventory_reservations > 0 ? 
                        `<li><strong>Inventory Reservations:</strong> ${references.inventory_reservations} active reservations</li>` : ''}
                    ${references.driver_stock_records > 0 ? 
                        `<li><strong>Driver Stock:</strong> ${references.driver_stock_records} driver stock records</li>` : ''}
                    ${references.driver_stock_events > 0 ? 
                        `<li><strong>Driver Events:</strong> ${references.driver_stock_events} stock events</li>` : ''}
                </ul>
                
                ${references.orders && references.orders.sample && references.orders.sample.length > 0 ? `
                    <div style="margin-top: 10px;">
                        <strong>Sample Orders:</strong>
                        <ul style="margin: 5px 0; padding-left: 20px;">
                            ${references.orders.sample.map(order => 
                                `<li>Order #${order.order_number} - ${new Date(order.created_at).toLocaleDateString()}</li>`
                            ).join('')}
                        </ul>
                    </div>
                ` : ''}
            </div>
            
            <div style="margin-top: 20px;">
                <button class="btn btn-danger" onclick="forceDeleteMenuItem(${itemId})">
                    🗑️ Force Delete Anyway
                </button>
                <button class="btn btn-secondary" onclick="closeModal('referencesModal')" style="margin-left: 10px;">
                    Cancel
                </button>
            </div>
            
            <div style="margin-top: 15px; font-size: 12px; color: #666;">
                <strong>Warning:</strong> Force deletion will remove all references to this item, which may affect order history and reporting.
            </div>
        </div>
    `;
    
    showModal('referencesModal', modalContent);
}

async function forceDeleteMenuItem(itemId) {
    const confirmed = await showEnhancedConfirm(
        `🚨 DANGER: This will permanently delete the menu item and ALL its references from the system. 
        This action cannot be undone and may affect order history and reporting. 
        Are you absolutely sure?`,
        'CONFIRM FORCE DELETE'
    );
    
    if (!confirmed) return;
    
    try {
        const response = await axios.delete(`${API_BASE}/menu/items/${itemId}/force`);
        showNotification(`Menu item force deleted! Removed: ${JSON.stringify(response.data.removed_references)}`, 'success');
        closeModal('referencesModal');
        loadMenu();
    } catch (error) {
        console.error('Error force deleting menu item:', error);
        const errorMsg = error.response?.data?.detail || 'Error force deleting menu item';
        showNotification(`Error: ${errorMsg}`, 'error');
    }
}

function showEnhancedConfirm(message, title = 'Confirm Action') {
    return new Promise((resolve) => {
        const modalContent = `
            <div class="modal-header">
                <h3>${title}</h3>
            </div>
            <div class="modal-body">
                <p>${message}</p>
            </div>
            <div class="modal-footer">
                <button id="confirmYes" class="btn btn-danger" style="margin-right: 10px;">Yes, Continue</button>
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

async function restoreMenuItem(itemId) {
    try {
        await axios.put(`${API_BASE}/menu/items/${itemId}`, { active: true });
        showNotification('Menu item restored', 'success');
        loadMenu();
    } catch (error) {
        console.error('Error restoring menu item:', error);
        showNotification('Error restoring menu item', 'error');
    }
}