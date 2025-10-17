async function initDashboard() {
    console.log('Dashboard initialized');
    // Set up any dashboard-specific event listeners
}

async function loadDashboard() {
    try {
        const [statsResponse, ordersResponse, revenueResponse] = await Promise.all([
            axios.get(`${API_BASE}/dashboard/stats`),
            axios.get(`${API_BASE}/orders?limit=10`),
            axios.get(`${API_BASE}/dashboard/revenue-analytics?time_range=daily`)
        ]);

        updateStats(statsResponse.data);
        updateRecentOrders(ordersResponse.data);
        createRevenueChart(revenueResponse.data);
    } catch (error) {
        console.error('Error loading dashboard:', error);
        showNotification('Error loading dashboard data', 'error');
    }
}

function updateStats(stats) {
    const statsGrid = document.getElementById('statsGrid');
    if (!statsGrid) return;
    
    statsGrid.innerHTML = `
        <div class="stat-card">
            <h3>Total Orders</h3>
            <div class="value">${stats.total_orders || 0}</div>
        </div>
        <div class="stat-card">
            <h3>Total Revenue</h3>
            <div class="value">${formatCurrency(stats.total_revenue || 0)}</div>
        </div>
        <div class="stat-card">
            <h3>Active Customers</h3>
            <div class="value">${stats.active_customers || 0}</div>
        </div>
        <div class="stat-card">
            <h3>Pending Orders</h3>
            <div class="value">${stats.pending_orders || 0}</div>
        </div>
        <div class="stat-card">
            <h3>Completed Orders</h3>
            <div class="value">${stats.completed_orders || 0}</div>
        </div>
    `;
}

function updateRecentOrders(orders) {
    const tbody = document.querySelector('#recentOrdersTable tbody');
    if (!tbody) return;
    
    if (!orders || orders.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 20px; color: #666;">
                    No recent orders found
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = orders.map(order => `
        <tr>
            <td>${order.order_number || 'N/A'}</td>
            <td>${order.customer_telegram_id || 'N/A'}</td>
            <td>${formatCurrency(order.subtotal_cents || 0)}</td>
            <td><span class="status-badge ${order.status || 'placed'}">${order.status || 'Unknown'}</span></td>
            <td>${formatDate(order.created_at)}</td>
        </tr>
    `).join('');
}

function createRevenueChart(data) {
    const ctx = document.getElementById('revenueChart');
    if (!ctx) return;
    
    // Destroy existing chart
    destroyChart('revenueChart');
    
    if (!data || data.length === 0) {
        ctx.parentElement.innerHTML = '<p style="text-align: center; padding: 40px; color: #666;">No revenue data available</p>';
        return;
    }
    
    appState.chartInstances.revenueChart = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: data.map(item => formatDate(item.period)),
            datasets: [{
                label: 'Revenue ($)',
                data: data.map(item => item.revenue || 0),
                borderColor: '#3498db',
                backgroundColor: 'rgba(52, 152, 219, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: 'Revenue Trend' },
                legend: { display: true, position: 'top' }
            },
            scales: {
                x: { display: true, title: { display: true, text: 'Date' } },
                y: { 
                    display: true, 
                    title: { display: true, text: 'Revenue ($)' }, 
                    beginAtZero: true 
                }
            }
        }
    });
}