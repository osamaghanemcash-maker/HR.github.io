const $ = (sel) => document.querySelector(sel);

function formatCurrency(value) {
    return `${Number(value).toFixed(2)} د.أ`;
}

function formatArabicDate(iso) {
    try {
        const d = new Date(iso);
        return new Intl.DateTimeFormat('ar-EG', {
            year: 'numeric', month: 'long', day: 'numeric'
        }).format(d);
    } catch {
        return iso || '—';
    }
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function renderConfirmation() {
    let order = null;
    try {
        order = JSON.parse(localStorage.getItem('hr_last_order'));
    } catch {
        order = null;
    }

    if (!order || !Array.isArray(order.items) || order.items.length === 0) {
        $('#confirmation-wrap').style.display = 'none';
        $('#confirmation-empty').style.display = 'block';
        return;
    }

    $('#conf-order-number').textContent = order.orderNumber || '—';
    $('#conf-order-date').textContent = formatArabicDate(order.date);
    $('#conf-order-total').textContent = formatCurrency(order.finalTotal);

    const itemsEl = $('#conf-items');
    itemsEl.innerHTML = order.items.map((item) => `
        <div class="confirmation-item">
            <div class="confirmation-item-main">
                <div class="confirmation-item-thumb">
                    <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">
                </div>
                <div class="confirmation-item-info">
                    <h4>${escapeHtml(item.name)} <span class="confirmation-item-qty">× ${item.qty}</span></h4>
                    <span>${escapeHtml(item.brand || 'H&R Perfume')} • ${escapeHtml(item.size)}</span>
                </div>
            </div>
            <div class="confirmation-item-price">${formatCurrency(item.price * item.qty)}</div>
        </div>
    `).join('');

    $('#conf-subtotal').textContent = formatCurrency(order.subtotal);

    if (order.discountAmount > 0) {
        $('#conf-discount-row').style.display = 'grid';
        $('#conf-discount').textContent = `-${formatCurrency(order.discountAmount)}`;
    }

    const shippingLabel = order.shippingCost > 0
        ? `${formatCurrency(order.shippingCost)} عبر التوصيل السريع`
        : 'شحن مجاني';
    $('#conf-shipping').textContent = shippingLabel;
    $('#conf-total').textContent = formatCurrency(order.finalTotal);

    const c = order.customer || {};
    const fullName = `${c.firstName || ''} ${c.lastName || ''}`.trim() || '—';
    const addressHtml = `
        <div class="conf-line"><i class="fas fa-user"></i><span>${escapeHtml(fullName)}</span></div>
        <div class="conf-line"><i class="fas fa-location-dot"></i><span>${escapeHtml(c.address || '—')}</span></div>
        <div class="conf-line"><i class="fas fa-map-pin"></i><span>${escapeHtml(c.governorate || '—')}</span></div>
        <div class="conf-line"><i class="fas fa-phone"></i><span dir="ltr">${escapeHtml(c.phone || '—')}</span></div>
    `;
    $('#conf-billing').innerHTML = addressHtml;
    $('#conf-shipping-addr').innerHTML = addressHtml;
}

document.addEventListener('DOMContentLoaded', renderConfirmation);
