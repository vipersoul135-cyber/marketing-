/* SupplyLink Universal Logic Package */
let products = [];
let cart = {};

// --- AUTO-INITIALIZER ---
window.onload = () => {
    // 1. Load Data from Body Tags
    const body = document.body;
    if (body.dataset.products) {
        products = JSON.parse(body.dataset.products);
        initShopSearch();
        updateSummary();
    }
    
    const orderId = body.dataset.orderId;
    if (orderId) {
        initPaymentFormatters();
        const payForm = document.getElementById('payment-form');
        if (payForm) payForm.onsubmit = (e) => { e.preventDefault(); processPayment(orderId); };
    }

    if (body.classList.contains('admin-dashboard')) {
        refreshAdminData();
        setInterval(refreshAdminData, 10000);
    }
};

function updateQty(id, delta) {
    if (!cart[id]) cart[id] = 0;
    cart[id] = Math.max(0, cart[id] + delta);
    const qtyEl = document.getElementById(`qty-${id}`);
    if (qtyEl) qtyEl.textContent = cart[id];
    updateSummary();
}

function updateSummary() {
    let total = 0, count = 0;
    // products is a global variable defined in shop.html
    if (typeof products === 'undefined') return;
    
    Object.entries(cart).forEach(([id, q]) => {
        const p = products.find(x => x.id == id);
        if (p && q > 0) {
            total += p.price * q;
            count += q;
        }
    });

    const itemsCountEl = document.getElementById('items-count');
    const totalPriceEl = document.getElementById('total-price');
    const submitBtn = document.getElementById('submit-btn');

    if (itemsCountEl) itemsCountEl.textContent = `${count} units`;
    if (totalPriceEl) totalPriceEl.textContent = `$${total.toFixed(2)}`;
    if (submitBtn) {
        submitBtn.disabled = (count === 0);
        if (count > 0) submitBtn.classList.add('pulse');
        else submitBtn.classList.remove('pulse');
    }
}

async function submitOrder() {
    const orderItems = Object.entries(cart)
        .filter(([id, q]) => q > 0)
        .map(([id, q]) => ({ id: parseInt(id), count: q }));

    if (orderItems.length === 0) return alert("Add items first");

    const btn = document.getElementById('submit-btn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '📤 Sending...';

    try {
        const res = await fetch('/api/submit_order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: orderItems })
        });
        const data = await res.json();
        if (data.redirect) {
            window.location.href = data.redirect;
        } else if (res.ok) {
            document.getElementById('success-modal').style.display = 'flex';
            cart = {};
            document.querySelectorAll('.qty').forEach(el => el.textContent = '0');
            updateSummary();
        }
    } catch (err) {
        alert("Connection error");
    } finally {
        btn.innerHTML = originalText;
    }
}

function initShopSearch() {
    const search = document.getElementById('product-search');
    if (search) {
        search.oninput = (e) => {
            const q = e.target.value.toLowerCase();
            document.querySelectorAll('.product-card').forEach(card => {
                const name = card.dataset.name || "";
                card.style.display = name.includes(q) ? 'flex' : 'none';
            });
        };
    }
}

// --- ADMIN DASHBOARD LOGIC ---
let lastOrderCount = -1;

async function refreshAdminData() {
    try {
        const sRes = await fetch('/api/summary');
        const sData = await sRes.json();
        const revEl = document.getElementById('total-revenue');
        const pendEl = document.getElementById('pending-count');
        const listEl = document.getElementById('summary-list');

        if (revEl) revEl.textContent = `$${sData.total_revenue.toFixed(2)}`;
        if (pendEl) pendEl.textContent = sData.pending_orders;
        if (listEl) {
            listEl.innerHTML = sData.items.map(i => `
                <div class="summary-item">
                    <span>${i.name}</span>
                    <strong>${i.count} ${i.unit}</strong>
                </div>
            `).join('') || '<p>All set!</p>';
        }

        const oRes = await fetch('/api/orders');
        const oData = await oRes.json();
        
        // Notifications
        const chime = document.getElementById('order-chime');
        if (lastOrderCount !== -1 && oData.length > lastOrderCount) {
            if (chime) chime.play().catch(() => {});
            showToast(`📦 New Order from ${oData[oData.length-1].shop}`);
        }
        lastOrderCount = oData.length;

        // Apply Date Filter
        const dateFilter = document.getElementById('admin-date-filter');
        let filteredData = oData;
        if (dateFilter && dateFilter.value) {
            filteredData = oData.filter(o => o.timestamp.startsWith(dateFilter.value));
        }

        renderAdminOrders(filteredData);
    } catch (err) { console.error(err); }
}

function showToast(msg) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 500);
    }, 5000);
}

async function updateOrderStatus(id, status) {
    await fetch('/api/update_status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status })
    });
    refreshAdminData();
}

async function deleteOrder(id) {
    if (!confirm("Are you sure you want to delete this order record?")) return;
    await fetch('/api/delete_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    });
    refreshAdminData();
}

async function clearAllCompleted() {
    if (!confirm("Clear all archived/dispatched orders from the feed?")) return;
    await fetch('/api/clear_completed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    });
    refreshAdminData();
}

function renderAdminOrders(data) {
    const feed = document.getElementById('order-feed');
    if (!feed) return;
    feed.innerHTML = data.reverse().map(o => `
        <div class="order-card status-${o.status.toLowerCase()}">
            <div class="order-header">
                <strong>${o.shop}</strong>
                <span class="total-badge">$${o.total_bill.toFixed(2)}</span>
            </div>
            <ul class="order-items-detail">
                ${o.items.map(i => `<li>${i.name} x${i.count} <span>$${i.total.toFixed(2)}</span></li>`).join('')}
            </ul>
            <div class="order-footer">
                <small>${o.timestamp}</small>
                ${o.status === 'Pending' ? `
                    <button class="btn-complete" onclick="updateOrderStatus(${o.id}, 'Completed')">Mark Complete</button>
                ` : `
                    <button class="btn-delete" title="Delete Permanent" onclick="deleteOrder(${o.id})">🗑️ Delete</button>
                `}
            </div>
        </div>
    `).join('') || '<p class="empty-msg">No orders found.</p>';
}

// --- PAYMENT LOGIC ---
function initPaymentFormatters() {
    const cardInput = document.getElementById('card-num');
    if (cardInput) {
        cardInput.oninput = (e) => {
            let v = e.target.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
            let matches = v.match(/\d{4,16}/g);
            let match = matches && matches[0] || '';
            let parts = [];
            for (let i=0, len=match.length; i<len; i+=4) {
                parts.push(match.substring(i, i+4));
            }
            if (parts.length) e.target.value = parts.join(' ');
        };
    }

    // Toggle logic
    const methods = document.querySelectorAll('input[name="method"]');
    methods.forEach(m => {
        m.onchange = (e) => {
            document.getElementById('card-inputs').style.display = e.target.value === 'card' ? 'block' : 'none';
            document.getElementById('upi-inputs').style.display = e.target.value === 'upi' ? 'block' : 'none';
            document.querySelectorAll('.method-btn').forEach(btn => btn.classList.remove('active'));
            e.target.closest('.method-btn').classList.add('active');
        };
    });
}

async function processPayment(orderId) {
    const overlay = document.getElementById('processing-overlay');
    const success = document.getElementById('payment-success');
    if (overlay) overlay.style.display = 'flex';

    setTimeout(async () => {
        try {
            const res = await fetch('/api/verify_payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: orderId })
            });
            if (res.ok) {
                if (overlay) overlay.style.display = 'none';
                if (success) success.style.display = 'flex';
            }
        } catch (err) { 
            alert("Payment Authoration Failed"); 
            if (overlay) overlay.style.display = 'none';
        }
    }, 2500);
}
