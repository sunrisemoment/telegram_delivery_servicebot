async function initInventory() {
    console.log('Inventory module initialized');
    loadReservations();
}

async function loadReservations() {
    try {
        const response = await axios.get(`${API_BASE}/inventory/reservations`);
        updateReservationsTable(response.data);
        
    } catch (error) {
        console.error('Error loading reservations:', error);
        showNotification('Error loading reservations', 'error');
    }
}

function updateReservationsTable(reservations) {
    const tbody = document.querySelector('#reservationsTable tbody');
    if (!tbody) return;
    
    if (!reservations || reservations.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 20px; color: #666;">
                    No active reservations found
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = reservations.map(reservation => `
        <tr>
            <td>${reservation.order_number || 'N/A'}</td>
            <td>${reservation.menu_item_name || 'N/A'}</td>
            <td>${reservation.reserved_qty || 0}</td>
            <td>${formatDateTime(reservation.created_at)}</td>
            <td>${reservation.expires_at ? formatDateTime(reservation.expires_at) : 'N/A'}</td>
            <td>
                <button class="btn btn-danger btn-sm" onclick="releaseReservation(${reservation.id})">Release</button>
            </td>
        </tr>
    `).join('');
}

async function releaseReservation(reservationId) {
    if (!confirm('Are you sure you want to release this reservation?')) return;
    
    try {
        await axios.post(`${API_BASE}/inventory/reservations/${reservationId}/release`);
        showNotification('Reservation released successfully', 'success');
        loadReservations();
    } catch (error) {
        console.error('Error releasing reservation:', error);
        showNotification('Error releasing reservation', 'error');
    }
}

async function cleanupExpiredReservations() {
    if (!confirm('Are you sure you want to cleanup expired reservations?')) return;
    
    try {
        const response = await axios.post(`${API_BASE}/inventory/cleanup-expired`);
        showNotification(response.data.message || 'Cleanup completed', 'success');
        loadReservations();
    } catch (error) {
        console.error('Error cleaning up expired reservations:', error);
        showNotification('Error cleaning up expired reservations', 'error');
    }
}