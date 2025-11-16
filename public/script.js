let isAdmin = false;

// Utility function to convert file to base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

async function login() {
  const code = document.getElementById('accessCode').value.trim();

  if (!code || code.length !== 10) {
    alert('Please enter a valid 10-digit access code');
    return;
  }

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code }),
    });

    const data = await response.json();

    if (response.ok && data.success) {
      currentUserId = code;
      isAdmin = data.isAdmin;

      document.getElementById('loginCard').classList.add('hidden');
      document.getElementById('dashboard').classList.remove('hidden');

      if (isAdmin) {
        document.getElementById('adminPanel').classList.remove('hidden');
        loadUsers();
      }

      loadNotice();

      // Start status checking
      checkStatus();
      setInterval(checkStatus, 5000);

      // Don't auto-refresh QR - only on manual restart
      // User will click "Restart & Get New QR" button to get new QR

      showNotification('Login successful!', 'success');
      console.log('Login successful for:', code, 'Admin:', isAdmin);
    } else {
      showNotification(data.error || 'Invalid access code', 'error');
    }
  } catch (error) {
    console.error('Login error:', error);
    showNotification('Login failed. Please check your connection and try again.', 'error');
  }
}

async function updateQR() {
  if (!currentUserId) return;
  try {
    const res = await fetch(`/api/qr?userId=${currentUserId}`);
    const data = await res.json();
    const qrImage = document.getElementById('qrImage');

    if (data.qr) {
      qrImage.src = data.qr;
      qrImage.classList.remove('hidden');
      console.log('QR code updated');
    } else {
      qrImage.classList.add('hidden');
    }
  } catch (error) {
    console.error('Error updating QR:', error);
  }
}

async function refreshQR() {
  if (!currentUserId) {
    showNotification('Please login first!', 'error');
    return;
  }

  const statusElement = document.getElementById('status');
  const statusDot = document.getElementById('statusDot');
  const qrImage = document.getElementById('qrImage');

  // Update UI
  statusElement.textContent = "Restarting...";
  statusDot.className = "status-dot status-disconnected";
  qrImage.classList.add('hidden');
  document.getElementById('pairingCodeContainer').classList.add('hidden');

  // Reset QR fetch flag
  qrFetchedOnce = false;

  showNotification('🔄 Restarting WhatsApp connection...', 'success');

  try {
    const res = await fetch('/api/restart-whatsapp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'user-id': currentUserId
      },
      body: JSON.stringify({ userId: currentUserId })
    });

    // Parse response as JSON
    const data = await res.json();

    if (res.ok && data.success) {
      console.log('✅ WhatsApp connection restart initiated');
      showNotification('✅ Connection restarting... Please wait for QR code', 'success');
      
      // Wait 5 seconds then start polling for QR
      setTimeout(() => {
        qrFetchedOnce = false;
        statusElement.textContent = "Waiting for QR...";
        // Poll for QR code every 2 seconds
        const qrPollInterval = setInterval(() => {
          getQR();
          // Stop polling after 30 seconds
          setTimeout(() => clearInterval(qrPollInterval), 30000);
        }, 2000);
      }, 5000);
      
    } else {
      console.error('❌ Failed to restart:', data.error);
      showNotification('❌ Failed: ' + (data.error || 'Unknown error'), 'error');
      statusElement.textContent = "Restart failed";
    }
    
  } catch (error) {
    console.error('❌ Restart error:', error);
    showNotification('❌ Network error: ' + error.message, 'error');
    statusElement.textContent = "Connection error";
  }
}

// Pairing code related functions are kept but the button to use it is removed in the HTML part.
// The intention is to deprecate this feature and focus on QR code.
async function usePairingCode() {
  if (!currentUserId) return;

  // Ask for WhatsApp phone number with clear instructions
  const phoneNumber = prompt(
    '📱 Enter your WhatsApp number with country code:\n\n' +
    'Format: [Country Code][Phone Number]\n' +
    'Example for India: 919209778319\n' +
    'Example for US: 14155552671\n\n' +
    '⚠️ Do NOT include + or spaces\n' +
    '⚠️ This MUST be a number registered on WhatsApp'
  );

  if (!phoneNumber || phoneNumber.trim().length < 10) {
    showNotification('❌ Valid phone number is required', 'error');
    return;
  }

  showNotification('Activating pairing code mode...', 'success');

  // Hide QR code
  document.getElementById('qrImage').classList.add('hidden');

  try {
    const res = await fetch('/api/use-pairing-code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'user-id': currentUserId
      },
      body: JSON.stringify({ userId: currentUserId, phoneNumber: phoneNumber })
    });

    const data = await res.json();

    if (res.ok) {
      showNotification('Pairing code will be generated shortly for ' + phoneNumber, 'success');
      // Start checking for pairing code
      setTimeout(checkPairingCode, 2000);
      setInterval(checkPairingCode, 3000);
    } else {
      showNotification(data.error || 'Failed to activate pairing code mode', 'error');
    }
  } catch (error) {
    showNotification('Error activating pairing code mode', 'error');
  }
}

async function checkPairingCode() {
  if (!currentUserId) return;

  try {
    const res = await fetch(`/api/pairing-code?userId=${currentUserId}`);
    const data = await res.json();

    const pairingCodeContainer = document.getElementById('pairingCodeContainer');
    const pairingCodeDisplay = document.getElementById('pairingCodeDisplay');

    if (data.pairingCode && data.pairingCode !== 'NEED_PHONE') {
      pairingCodeDisplay.innerHTML = `
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #25D366; margin: 10px 0;">
          ${data.pairingCode}
        </div>
        <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 15px; margin-top: 15px; text-align: left;">
          <h4 style="margin: 0 0 10px 0; color: #856404;">📱 अब WhatsApp में यह करें:</h4>
          <ol style="margin: 0; padding-left: 20px; line-height: 1.8;">
            <li>अपना <strong>WhatsApp</strong> खोलें</li>
            <li><strong>Settings ⚙️</strong> → <strong>Linked Devices</strong> पर जाएं</li>
            <li><strong>"Link a Device"</strong> पर क्लिक करें</li>
            <li><strong>"Link with phone number instead"</strong> चुनें</li>
            <li>ऊपर दिखाया गया <strong>${data.pairingCode}</strong> code वहां टाइप करें</li>
          </ol>
          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #ffc107; font-size: 13px; color: #856404;">
            ⚠️ <strong>ध्यान दें:</strong> WhatsApp आपको कोई SMS/Message नहीं भेजेगा। आपको यह code खुद manually enter करना होगा।
          </div>
        </div>
      `;
      pairingCodeContainer.classList.remove('hidden');
    } else {
      pairingCodeContainer.classList.add('hidden');
    }
  } catch (error) {
    console.error('Pairing code check error:', error);
  }
}

let qrFetchedOnce = false;

function checkStatus() {
  if (!currentUserId) return;

  fetch(`/api/status?userId=${currentUserId}`)
    .then(res => res.json())
    .then(data => {
      const statusElement = document.getElementById('status');
      const statusDot = document.getElementById('statusDot');
      const qrImage = document.getElementById('qrImage');
      const pairingCodeContainer = document.getElementById('pairingCodeContainer');

      if (data.connected) {
        statusElement.textContent = 'Connected';
        statusDot.className = 'status-dot status-connected';
        qrImage.classList.add('hidden');
        pairingCodeContainer.classList.add('hidden');
        qrFetchedOnce = false; // Reset for next time
      } else {
        statusElement.textContent = 'Disconnected';
        statusDot.className = 'status-dot status-disconnected';
        
        // Only fetch QR once when first disconnected
        if (!qrFetchedOnce && data.hasQR) {
          getQR();
          qrFetchedOnce = true;
        }
      }
    })
    .catch(error => console.error('Status check error:', error));
}

async function getQR() {
  if (!currentUserId) return;

  try {
    const res = await fetch(`/api/qr?userId=${currentUserId}`);
    const data = await res.json();

    const qrImage = document.getElementById('qrImage');
    if (data.qr) {
      qrImage.src = data.qr;
      qrImage.classList.remove('hidden');
    } else {
      qrImage.classList.add('hidden');
    }
  } catch (error) {
    console.error('QR fetch error:', error);
  }
}

async function createGroups() {
  let name = document.getElementById('groupName').value.trim();
  const count = parseInt(document.getElementById('groupCount').value);
  const adminNumber = document.getElementById('adminNumber').value.trim();
  const groupImageFile = document.getElementById('groupImage').files[0];
  const groupDescription = document.getElementById('groupDescription').value.trim();

  if (!name || !count) {
    showNotification('Please enter group name and count', 'error');
    return;
  }

  if (!currentUserId) {
    showNotification('Please login first', 'error');
    return;
  }

  // Auto-increment functionality: if name doesn't contain a number, add starting number 1
  const nameParts = name.split(" ");
  const lastPart = nameParts[nameParts.length - 1];

  if (!/^\d+$/.test(lastPart)) {
    // If last part is not a number, add " 1" to start from 1
    name = name + " 1";
    showNotification(`Auto-starting from: ${name}`, 'success');
  }

  const linksContainer = document.getElementById('links');
  linksContainer.innerHTML = '<div class="progress-info">Starting group creation...</div>';

  try {
    const requestBody = { name, count, userId: currentUserId };
    if (adminNumber) {
      requestBody.adminNumber = adminNumber;
      showNotification(`Groups will include admin: ${adminNumber}`, 'success');
    }
    if (groupImageFile) {
      // Convert file to base64
      const base64Image = await fileToBase64(groupImageFile);
      requestBody.groupImage = base64Image;
      requestBody.groupImageName = groupImageFile.name;
      showNotification(`Profile picture selected: ${groupImageFile.name}`, 'success');
    }
    if (groupDescription) {
      requestBody.groupDescription = groupDescription;
      showNotification(`Description: "${groupDescription}"`, 'success');
    }

    const response = await fetch('/api/create-groups', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'user-id': currentUserId
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error('Failed to start group creation');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            handleStreamData(data);
          } catch (e) {
            console.error('Error parsing stream data:', e);
          }
        }
      }
    }
  } catch (error) {
    showNotification('Error creating groups: ' + error.message, 'error');
  }
}

function handleStreamData(data) {
  const linksContainer = document.getElementById('links');

  switch (data.type) {
    case 'start':
      linksContainer.innerHTML = `
        <div class="progress-info">
          <h3>Creating ${data.totalGroups} groups starting from "${data.baseName} ${data.startNumber}"</h3>
          <div class="progress-bar">
            <div class="progress-fill" id="progressFill" style="width: 0%"></div>
          </div>
          <div id="currentStatus">${data.message}</div>
        </div>
        <div id="linksList"></div>
      `;
      showNotification(`Starting group creation: ${data.baseName} ${data.startNumber}`, 'success');
      break;

    case 'progress':
      updateProgress(data.current, data.total);
      document.getElementById('currentStatus').textContent = 
        `Creating ${data.groupName} (Attempt ${data.attempt})...`;
      break;

    case 'link':
      addLinkToList(data);
      updateProgress(data.current, data.total);
      document.getElementById('currentStatus').textContent = 
        `✅ ${data.groupName} created successfully!`;
      showNotification(`Group ${data.groupName} created!`, 'success');
      break;

    case 'admin':
      handleAdminEvent(data);
      break;

    case 'description':
      handleDescriptionEvent(data);
      break;

    case 'image':
      handleImageEvent(data);
      break;

    case 'failed':
      addFailedGroup(data);
      updateProgress(data.current, data.total);
      document.getElementById('currentStatus').textContent = 
        `❌ Failed to create ${data.groupName}`;
      break;

    case 'retry':
      document.getElementById('currentStatus').textContent = 
        `🔄 Retrying ${data.groupName} (Attempt ${data.attempt}) in ${data.delaySeconds}s...`;
      break;

    case 'wait':
      document.getElementById('currentStatus').textContent = data.message;
      break;

    case 'complete':
      updateProgress(data.totalRequested, data.totalRequested);
      document.getElementById('currentStatus').innerHTML = 
        `<strong>${data.message}</strong>`;
      showNotification(data.message, 'success');
      if (data.failed.length > 0) {
        addFailedSummary(data.failed);
      }
      break;
  }
}

function handleAdminEvent(data) {
  const currentStatus = document.getElementById('currentStatus');

  switch (data.action) {
    case 'adding':
      if (currentStatus) {
        currentStatus.textContent = `🔄 ${data.message}`;
      }
      break;

    case 'result':
      if (currentStatus) {
        currentStatus.textContent = data.message;
      }

      // Show notification based on admin status
      switch (data.status) {
        case 'success':
          showNotification(`✅ Admin added: ${data.adminNumber}`, 'success');
          break;
        case 'invited':
          showNotification(`📨 Invite sent to: ${data.adminNumber}`, 'success');
          break;
        case 'skipped':
        case 'not_found':
        case 'failed':
          showNotification(`⚠️ Admin addition issue: ${data.reason}`, 'error');
          break;
      }
      break;

    case 'error':
      if (currentStatus) {
        currentStatus.textContent = data.message;
      }
      showNotification(`❌ Admin error: ${data.adminNumber}`, 'error');
      break;
  }
}

function handleDescriptionEvent(data) {
  const currentStatus = document.getElementById('currentStatus');

  switch (data.action) {
    case 'setting':
      if (currentStatus) {
        currentStatus.textContent = `📝 ${data.message}`;
      }
      break;

    case 'success':
      showNotification(`✅ Description set for ${data.groupName}`, 'success');
      break;

    case 'failed':
      showNotification(`❌ Failed to set description: ${data.error}`, 'error');
      break;
  }
}

function handleImageEvent(data) {
  const currentStatus = document.getElementById('currentStatus');

  switch (data.action) {
    case 'setting':
      if (currentStatus) {
        currentStatus.textContent = `🖼️ ${data.message}`;
      }
      showNotification(`📷 Uploading: ${data.imageName}`, 'success');
      break;

    case 'success':
      showNotification(`✅ Profile picture set for ${data.groupName}`, 'success');
      break;

    case 'failed':
      showNotification(`❌ Failed to set profile picture: ${data.error}`, 'error');
      break;
  }
}

function addLinkToList(linkData) {
  const linksList = document.getElementById('linksList');
  const linkItem = document.createElement('div');
  linkItem.className = 'link-item';

  let warningHtml = '';
  if (linkData.addMembersWarning) {
    warningHtml = `<div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 4px; padding: 8px; margin-top: 8px; font-size: 12px; color: #856404;">
      ⚠️ <strong>Manual Action Required:</strong> If members can't add others, go to group settings in WhatsApp and manually enable it.
    </div>`;
  }

  // Add admin status display if available
  let adminStatusHtml = '';
  if (linkData.adminStatus) {
    const statusIcon = getAdminStatusIcon(linkData.adminStatus.status);
    const statusColor = getAdminStatusColor(linkData.adminStatus.status);
    adminStatusHtml = `<div style="background: ${statusColor}; border-radius: 4px; padding: 6px; margin-top: 6px; font-size: 11px; color: #333;">
      ${statusIcon} <strong>Admin Status:</strong> ${linkData.adminStatus.action || linkData.adminStatus.reason}
    </div>`;
  }

  linkItem.innerHTML = `
    <strong>${linkData.groupName}:</strong><br>
    <a href="${linkData.link}" target="_blank">${linkData.link}</a>
    <button onclick="copyToClipboard('${linkData.link}')" class="copy-btn">Copy</button>
    ${warningHtml}
    ${adminStatusHtml}
  `;
  linksList.appendChild(linkItem);

  // Scroll to the new link
  linkItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function getAdminStatusIcon(status) {
  switch (status) {
    case 'success': return '✅';
    case 'invited': return '📨';
    case 'skipped': return '⏭️';
    case 'not_found': return '❌';
    case 'failed': return '❌';
    case 'error': return '❌';
    default: return '❓';
  }
}

function getAdminStatusColor(status) {
  switch (status) {
    case 'success': return '#d4edda';
    case 'invited': return '#cce7ff';
    case 'skipped': return '#fff3cd';
    case 'not_found': 
    case 'failed':
    case 'error': return '#f8d7da';
    default: return '#e9ecef';
  }
}

function addFailedGroup(data) {
  const linksList = document.getElementById('linksList');
  const failedItem = document.createElement('div');
  failedItem.className = 'link-item failed-group';
  failedItem.innerHTML = `
    <strong>❌ ${data.groupName}:</strong> Failed to create
    ${data.reason ? `<br><small>Reason: ${data.reason}</small>` : ''}
  `;
  linksList.appendChild(failedItem);
}

function addFailedSummary(failedGroups) {
  if (failedGroups.length === 0) return;

  const linksList = document.getElementById('linksList');
  const summaryItem = document.createElement('div');
  summaryItem.className = 'failed-summary';
  summaryItem.innerHTML = `
    <h4>❌ Failed Groups (${failedGroups.length}):</h4>
    <ul>
      ${failedGroups.map(group => `<li>${group}</li>`).join('')}
    </ul>
  `;
  linksList.appendChild(summaryItem);
}

function updateProgress(current, total) {
  const progressFill = document.getElementById('progressFill');
  if (progressFill) {
    const percentage = (current / total) * 100;
    progressFill.style.width = `${percentage}%`;
    progressFill.textContent = `${current}/${total}`;
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showNotification('Link copied to clipboard!', 'success');
  }).catch(() => {
    showNotification('Failed to copy link', 'error');
  });
}

// Admin Functions
async function loadUsers() {
  if (!isAdmin) return;

  try {
    const res = await fetch('/api/admin/users');
    const data = await res.json();

    const userList = document.getElementById('userList');
    userList.innerHTML = data.users.map(user =>
      `<div class="user-item">
        <span>${user}</span>
        <button class="btn btn-danger" style="width: auto; padding: 5px 10px; margin: 0;" onclick="removeUser('${user}')">
          <i class="fas fa-trash"></i>
        </button>
      </div>`
    ).join('');
  } catch (error) {
    console.error('Error loading users:', error);
  }
}

async function addUser() {
  if (!isAdmin) return;

  const newCode = document.getElementById('newUserCode').value;

  if (!newCode || newCode.length !== 10) {
    showNotification('Please enter a valid 10-digit code', 'error');
    return;
  }

  try {
    const res = await fetch('/api/admin/add-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: newCode })
    });

    const data = await res.json();

    if (res.ok) {
      showNotification('User added successfully!', 'success');
      document.getElementById('newUserCode').value = '';
      loadUsers();
    } else {
      showNotification(data.error || 'Failed to add user', 'error');
    }
  } catch (error) {
    showNotification('Error adding user', 'error');
  }
}

async function removeUser(code) {
  if (!isAdmin || !confirm(`Remove user ${code}?`)) return;

  try {
    const res = await fetch('/api/admin/remove-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });

    const data = await res.json();

    if (res.ok) {
      showNotification('User removed successfully!', 'success');
      loadUsers();
    } else {
      showNotification(data.error || 'Failed to remove user', 'error');
    }
  } catch (error) {
    showNotification('Error removing user', 'error');
  }
}

// Notice Functions
async function loadNotice() {
  try {
    const res = await fetch('/api/notice');
    const data = await res.json();

    const noticeCard = document.getElementById('noticeCard');
    const noticeText = document.getElementById('noticeText');

    if (data.notice && data.notice.trim() !== '') {
      noticeText.textContent = data.notice;
      noticeCard.classList.remove('hidden');
    } else {
      noticeCard.classList.add('hidden');
    }
  } catch (error) {
    console.error('Error loading notice:', error);
  }
}

async function loadCurrentNotice() {
  if (!isAdmin) return;

  try {
    const res = await fetch('/api/notice');
    const data = await res.json();
    document.getElementById('noticeInput').value = data.notice || '';
  } catch (error) {
    console.error('Error loading current notice:', error);
  }
}

async function updateNotice() {
  if (!isAdmin) return;

  const notice = document.getElementById('noticeInput').value;

  try {
    const res = await fetch('/api/admin/update-notice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notice })
    });

    const data = await res.json();

    if (res.ok) {
      showNotification('Notice updated successfully!', 'success');
      loadNotice(); // Refresh notice display
    } else {
      showNotification(data.error || 'Failed to update notice', 'error');
    }
  } catch (error) {
    showNotification('Error updating notice', 'error');
  }
}

async function clearNotice() {
  if (!isAdmin || !confirm('Clear the current notice?')) return;

  try {
    const res = await fetch('/api/admin/update-notice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notice: '' })
    });

    const data = await res.json();

    if (res.ok) {
      showNotification('Notice cleared successfully!', 'success');
      document.getElementById('noticeInput').value = '';
      loadNotice(); // Refresh notice display
    } else {
      showNotification(data.error || 'Failed to clear notice', 'error');
    }
  } catch (error) {
    showNotification('Error clearing notice', 'error');
  }
}

// Initialize global variables
let currentUserId = null;

function showNotification(message, type) {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// Auto-refresh notice every 30 seconds
setInterval(loadNotice, 30000);