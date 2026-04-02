// static/admin/js/contact.js

let contactData = {
    welcome_message: '',
    welcome_photo_url: '',
    telegram_id: null,
    telegram_username: '',
    phone_number: '',
    email_address: '',
    additional_info: ''
};

let selectedWelcomePhoto = null;

// Initialize contact management
function initContactManagement() {
    console.log('Initializing contact management...');
    loadContactData();
    setupEventListeners();
}

// Setup event listeners
function setupEventListeners() {
    // Auto-update preview when typing in welcome message
    document.getElementById('welcomeMessage').addEventListener('input', function() {
        updateWelcomePreview();
    });
    
}

// Load contact data from API
function loadContactData() {
    showLoading('Loading contact information...');
    let url = `${API_BASE}/contact`;
    axios.get(url).then(response => {
            contactData = response.data;
            populateForm();
            updatePreviews();
            hideLoading();
        }).catch(error => {
            console.error('Error loading contact data:', error);
            showNotification('Failed to load contact information', 'error');
            hideLoading();
        });
}

// Populate form with loaded data
function populateForm() {
    console.log('Populating form with contact data:', contactData);
    // Welcome message
    document.getElementById('welcomeMessage').value = contactData.welcome_message || '';
    
    // Welcome photo
    if (contactData.welcome_photo_url) {
        displayWelcomePhoto(contactData.welcome_photo_url);
    }
    
    // Contact information
    document.getElementById('telegramId').value = contactData.telegram_id || '';
    document.getElementById('telegramUsername').value = contactData.telegram_username || '';
    document.getElementById('phoneNumber').value = contactData.phone_number || '';
    document.getElementById('emailAddress').value = contactData.email_address || '';
    document.getElementById('additionalInfo').value = contactData.additional_info || '';
}

// Handle welcome photo selection
function handleWelcomePhotoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
        showNotification('Please select a valid image file (JPEG, PNG, GIF, or WebP)', 'error');
        event.target.value = '';
        return;
    }
    
    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        showNotification('Image file is too large. Maximum size is 5MB', 'error');
        event.target.value = '';
        return;
    }
    
    selectedWelcomePhoto = file;
    
    // Show preview
    const reader = new FileReader();
    reader.onload = function(e) {
        displayWelcomePhoto(e.target.result);
    };
    reader.readAsDataURL(file);
    
    // Update label
    const label = event.target.nextElementSibling;
    label.textContent = file.name;
}

// Display welcome photo preview
function displayWelcomePhoto(photoUrl) {
    const container = document.getElementById('welcomePhotoPreviewContainer');
    const img = document.getElementById('welcomePhotoPreview');
    
    // Handle both data URLs and server URLs
    if (photoUrl.startsWith('data:')) {
        img.src = photoUrl;
    } else {
        img.src = API_BASE.replace('/admin', '') + photoUrl;
    }
    
    container.style.display = 'block';
}

// Remove welcome photo
function removeWelcomePhoto() {
    if (confirm('Are you sure you want to remove the welcome photo?')) {
        selectedWelcomePhoto = null;
        contactData.welcome_photo_url = '';
        
        // Clear file input
        const fileInput = document.getElementById('welcomePhoto');
        fileInput.value = '';
        fileInput.nextElementSibling.textContent = 'Choose photo...';
        
        // Hide preview
        document.getElementById('welcomePhotoPreviewContainer').style.display = 'none';
        
        showNotification('Photo removed. Click Save to apply changes.');
    }
}

// Upload welcome photo to server
async function uploadWelcomePhoto() {
    if (!selectedWelcomePhoto) return null;
    
    const formData = new FormData();
    formData.append('file', selectedWelcomePhoto);
    
    // If there's an old photo URL, include it for deletion
    if (contactData.welcome_photo_url) {
        formData.append('old_photo_url', contactData.welcome_photo_url);
    }
    
    try {
        const response = await axios.post(`${API_BASE}/upload-photo`, formData, {
            headers: {
                'Content-Type': 'multipart/form-data'
            }
        });
        
        return response.data.photo_url;
    } catch (error) {
        console.error('Error uploading photo:', error);
        throw error;
    }
}

// Save welcome message
async function saveWelcomeMessage() {
    const welcomeMessage = document.getElementById('welcomeMessage').value.trim();
    
    if (!welcomeMessage) {
        showNotification('Please enter a welcome message', 'error');
        return;
    }
    
    showLoading('Saving welcome message...');
    
    try {
        let photoUrl = contactData.welcome_photo_url || '';
        
        // Upload photo if a new one was selected
        if (selectedWelcomePhoto) {
            photoUrl = await uploadWelcomePhoto();
            selectedWelcomePhoto = null; // Clear after upload
        }
        
        const data = {
            welcome_message: welcomeMessage,
            welcome_photo_url: photoUrl
        };
        
        const response = await axios.post(`${API_BASE}/contact/welcome-message`, data);
        
        showNotification('Welcome message saved successfully!', 'success');
        contactData.welcome_message = welcomeMessage;
        contactData.welcome_photo_url = photoUrl;
        updateWelcomePreview();
        hideLoading();
        
    } catch (error) {
        console.error('Error saving welcome message:', error);
        showNotification('Failed to save welcome message', 'error');
        hideLoading();
    }
}

// Save contact information
function saveContactInfo() {
    const formData = {
        telegram_id: document.getElementById('telegramId').value ? parseInt(document.getElementById('telegramId').value) : null,
        telegram_username: document.getElementById('telegramUsername').value.trim(),
        phone_number: document.getElementById('phoneNumber').value.trim(),
        email_address: document.getElementById('emailAddress').value.trim(),
        additional_info: document.getElementById('additionalInfo').value.trim()
    };
    
    // Validate at least one contact method is provided
    if (!formData.telegram_id && !formData.telegram_username && !formData.phone_number && !formData.email_address) {
        showNotification('Please provide at least one contact method');
        return;
    }
    
    showLoading('Saving contact information...');
    
    axios.post(`${API_BASE}/contact/info`, formData)
        .then(response => {
            showNotification('Contact information saved successfully!');
            Object.assign(contactData, formData);
            hideLoading();
        })
        .catch(error => {
            console.error('Error saving contact information:', error);
            showNotification('Failed to save contact information', 'error');
            hideLoading();
        });
}

// Update both previews
function updatePreviews() {
    updateWelcomePreview();
}

// Update welcome message preview
function updateWelcomePreview() {
    const welcomeMessage = document.getElementById('welcomeMessage').value.trim();
    const previewElement = document.getElementById('welcomePreview');
    
    if (welcomeMessage) {
        // Replace placeholder with sample name for preview
        const previewMessage = welcomeMessage.replace(/{{name}}/g, 'John');
        previewElement.innerHTML = previewMessage;
    } else {
        previewElement.innerHTML = '<em class="text-muted">Welcome message will appear here...</em>';
    }
}