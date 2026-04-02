async function initInvites() {
    return true;
}

async function loadInvites() {
    try {
        const response = await axios.get(`${API_BASE}/invites`);
        updateInvitesTable(response.data || []);
    } catch (error) {
        console.error('Error loading invites:', error);
        showNotification(error.response?.data?.detail || 'Error loading invites', 'error');
    }
}

function updateInvitesTable(invites) {
    const tbody = document.querySelector('#invitesTable tbody');
    if (!tbody) return;

    if (!invites.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 20px; color: #666;">
                    No invites created yet
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = invites.map((invite) => `
        <tr>
            <td><strong>${invite.code}</strong></td>
            <td>${invite.alias_username || '-'}</td>
            <td>${invite.alias_email || '-'}</td>
            <td><span class="status-badge ${invite.status}">${invite.status}</span></td>
            <td>${invite.claimed_by_telegram_id || '-'}</td>
            <td>${formatDateTime(invite.created_at)}</td>
            <td>
                <button class="btn btn-primary btn-sm" onclick="copyInviteCode('${invite.code}')">Copy</button>
                ${invite.status === 'pending' ? `
                    <button class="btn btn-danger btn-sm" onclick="revokeInvite(${invite.id})">Revoke</button>
                ` : ''}
            </td>
        </tr>
    `).join('');
}

function showCreateInviteModal() {
    const modalContent = `
        <div class="modal-header">
            <h3>Create Invite</h3>
        </div>
        <div class="modal-body">
            <form id="createInviteForm">
                <div class="form-group">
                    <label>Alias Username (Optional)</label>
                    <input type="text" id="inviteAliasUsername" class="form-control" placeholder="private_member">
                </div>
                <div class="form-group">
                    <label>Alias Email (Optional)</label>
                    <input type="email" id="inviteAliasEmail" class="form-control" placeholder="member@example.com">
                </div>
                <div class="form-group">
                    <label>Notes (Optional)</label>
                    <textarea id="inviteNotes" class="form-control" rows="3" placeholder="Internal note for this invite"></textarea>
                </div>
                <div id="inviteCreateResult"></div>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-success" onclick="createInvite()">Create Invite</button>
            <button class="btn btn-secondary" onclick="closeModal('createInviteModal')">Cancel</button>
        </div>
    `;

    showModal('createInviteModal', modalContent);
}

async function createInvite() {
    const resultDiv = document.getElementById('inviteCreateResult');
    const payload = {
        alias_username: document.getElementById('inviteAliasUsername').value.trim() || null,
        alias_email: document.getElementById('inviteAliasEmail').value.trim() || null,
        notes: document.getElementById('inviteNotes').value.trim() || null,
    };

    try {
        resultDiv.innerHTML = '<div style="color: #0066cc; padding: 10px; background: #e6f2ff; border-radius: 5px;">Creating invite...</div>';
        const response = await axios.post(`${API_BASE}/invites`, payload);
        resultDiv.innerHTML = `
            <div style="color: green; padding: 10px; background: #e6ffe6; border-radius: 5px;">
                Invite created: <strong>${response.data.code}</strong>
            </div>
        `;
        await loadInvites();
        setTimeout(() => closeModal('createInviteModal'), 1200);
    } catch (error) {
        console.error('Error creating invite:', error);
        resultDiv.innerHTML = `
            <div style="color: red; padding: 10px; background: #ffe6e6; border-radius: 5px;">
                ${error.response?.data?.detail || 'Failed to create invite'}
            </div>
        `;
    }
}

async function revokeInvite(inviteId) {
    if (!confirm('Revoke this invite?')) return;

    try {
        await axios.post(`${API_BASE}/invites/${inviteId}/revoke`);
        showNotification('Invite revoked', 'success');
        await loadInvites();
    } catch (error) {
        console.error('Error revoking invite:', error);
        showNotification(error.response?.data?.detail || 'Failed to revoke invite', 'error');
    }
}

async function copyInviteCode(code) {
    try {
        await navigator.clipboard.writeText(code);
        showNotification(`Invite code ${code} copied`, 'success');
    } catch (error) {
        showNotification(`Copy failed. Invite code: ${code}`, 'warning');
    }
}
