async function initPayments() {
    console.log('Payments module initialized');
}

async function loadPayments() {
    try {
        const statusFilter = document.getElementById('paymentStatusFilter').value;
        const methodFilter = document.getElementById('paymentMethodFilter').value;
        
        let url = `${API_BASE}/payments?limit=100`;
        
        if (statusFilter) url += `&status=${statusFilter}`;
        if (methodFilter) url += `&method=${methodFilter}`;
        
        const response = await axios.get(url);
        updatePaymentsTable(response.data);
        
    } catch (error) {
        console.error('Error loading payments:', error);
        showNotification('Error loading payments', 'error');
    }
}

function updatePaymentsTable(payments) {
    const tbody = document.querySelector('#paymentsTable tbody');
    if (!tbody) return;
    
    if (!payments || payments.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 20px; color: #666;">
                    No payments found
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = payments.map(payment => `
        <tr>
            <td>${payment.order_number || 'N/A'}</td>
            <td>${payment.customer_telegram_id || 'N/A'}</td>
            <td>${formatCurrency(payment.amount_cents || payment.amount || 0)}</td>
            <td>${payment.payment_method || 'N/A'}</td>
            <td>
                <span class="status-badge ${payment.status || 'pending'}">${payment.status || 'Unknown'}</span>
            </td>
            <td>${formatDateTime(payment.created_at)}</td>
            <td>
                <button class="btn btn-primary btn-sm" onclick="viewPayment('${payment.id}')">View</button>
                ${payment.status === 'pending' ? `
                    <button class="btn btn-success btn-sm" onclick="confirmPayment('${payment.id}')">Confirm</button>
                    <button class="btn btn-danger btn-sm" onclick="rejectPayment('${payment.id}')">Reject</button>
                ` : ''}
            </td>
        </tr>
    `).join('');
}

async function viewPayment(paymentId) {
    try {
        const response = await axios.get(`${API_BASE}/payments/${paymentId}`);
        const payment = response.data;
        
        const modalContent = `
            <div class="modal-header">
                <h3>Payment Details</h3>
            </div>
            <div class="modal-body">
                <div style="display: grid; gap: 15px;">
                    <div>
                        <h4>Payment Information</h4>
                        <p><strong>Order #:</strong> ${payment.order_number || 'N/A'}</p>
                        <p><strong>Amount:</strong> ${formatCurrency(payment.amount_cents || payment.amount || 0)}</p>
                        <p><strong>Method:</strong> ${payment.payment_method || 'N/A'}</p>
                        <p><strong>Status:</strong> <span class="status-badge ${payment.status}">${payment.status}</span></p>
                    </div>
                    <div>
                        <h4>Customer Information</h4>
                        <p><strong>Telegram ID:</strong> ${payment.customer_telegram_id || 'N/A'}</p>
                    </div>
                    ${payment.payment_method === 'btc' ? `
                        <div>
                            <h4>Bitcoin Details</h4>
                            <p><strong>BTC Address:</strong> <code>${payment.btc_address || 'N/A'}</code></p>
                            <p><strong>BTC Amount:</strong> ${payment.btc_amount || 'N/A'}</p>
                            ${payment.payment_txid ? `<p><strong>Transaction ID:</strong> <code>${payment.payment_txid}</code></p>` : ''}
                        </div>
                    ` : ''}
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-primary" onclick="closeModal('paymentDetailsModal')">Close</button>
            </div>
        `;
        
        showModal('paymentDetailsModal', modalContent, { scrollable: true });
        
    } catch (error) {
        console.error('Error loading payment details:', error);
        showNotification('Error loading payment details', 'error');
    }
}

async function confirmPayment(paymentId) {
    if (!confirm('Are you sure you want to confirm this payment?')) return;
    
    try {
        await axios.post(`${API_BASE}/payments/${paymentId}/confirm`);
        showNotification('Payment confirmed successfully', 'success');
        loadPayments();
    } catch (error) {
        console.error('Error confirming payment:', error);
        showNotification('Error confirming payment', 'error');
    }
}

async function rejectPayment(paymentId) {
    if (!confirm('Are you sure you want to reject this payment?')) return;
    
    try {
        await axios.post(`${API_BASE}/payments/${paymentId}/reject`);
        showNotification('Payment rejected', 'success');
        loadPayments();
    } catch (error) {
        console.error('Error rejecting payment:', error);
        showNotification('Error rejecting payment', 'error');
    }
}