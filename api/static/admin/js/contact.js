// static/admin/js/contact.js

let contactData = {
    welcome_message: '',
    telegram_id: null,
    telegram_username: '',
    phone_number: '',
    email_address: '',
    additional_info: ''
};

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
    
    // Contact information
    document.getElementById('telegramId').value = contactData.telegram_id || '';
    document.getElementById('telegramUsername').value = contactData.telegram_username || '';
    document.getElementById('phoneNumber').value = contactData.phone_number || '';
    document.getElementById('emailAddress').value = contactData.email_address || '';
    document.getElementById('additionalInfo').value = contactData.additional_info || '';
}

// Save welcome message
function saveWelcomeMessage() {
    const welcomeMessage = document.getElementById('welcomeMessage').value.trim();
    
    if (!welcomeMessage) {
        showNotification('Please enter a welcome message');
        return;
    }
    
    showLoading('Saving welcome message...');
    
    const data = {
        welcome_message: welcomeMessage
    };
    axios.post(`${API_BASE}/contact/welcome-message`, data)
    .then(response => {
            showNotification('Welcome message saved successfully!');
            contactData.welcome_message = welcomeMessage;
            updateWelcomePreview();
            hideLoading();
        })
        .catch(error => {
            console.error('Error saving welcome message:', error);
            showNotification('Failed to save welcome message', 'error');
            hideLoading();
        });
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