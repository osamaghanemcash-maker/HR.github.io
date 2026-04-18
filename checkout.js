const FREE_SHIPPING_THRESHOLD = 60;
const DISCOUNT_CODES = {
    HR20: { type: 'percentage', value: 20 }
};

let cart = [];
let appliedDiscountCode = '';

function generateOrderNumber() {
    let orderCounter = parseInt(localStorage.getItem('hr_order_counter') || '1000');
    orderCounter++;
    localStorage.setItem('hr_order_counter', orderCounter.toString());
    return `#ORD-${orderCounter}`;
}

const $ = (sel) => document.querySelector(sel);

function formatCurrency(value) {
    return `${Number(value).toFixed(2)} د.أ`;
}

function normalizeCartItem(item) {
    if (!item || !item.key) return null;

    return {
        ...item,
        name: item.name || 'Product',
        brand: item.brand || '',
        image: item.image || 'logo without background.png',
        size: item.size || '100ml',
        qty: Math.max(1, Number(item.qty) || 1),
        price: Number(item.price) || 0
    };
}

function getDiscountCodeDefinition(code) {
    return DISCOUNT_CODES[code] || null;
}

function calculateDiscountAmount(subtotal, code = appliedDiscountCode) {
    const discount = getDiscountCodeDefinition(code);
    if (!discount) return 0;

    if (discount.type === 'percentage') {
        return Math.min(subtotal, subtotal * (discount.value / 100));
    }

    return Math.min(subtotal, discount.value);
}

function getCartTotals() {
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const discountAmount = calculateDiscountAmount(subtotal);
    const finalTotal = Math.max(0, subtotal - discountAmount);

    return { subtotal, discountAmount, finalTotal };
}

function getDiscountDescription(code) {
    const discount = getDiscountCodeDefinition(code);
    if (!discount) return '';

    return discount.type === 'percentage'
        ? `خصم ${discount.value}%`
        : `خصم ${formatCurrency(discount.value)}`;
}

function saveCart() {
    localStorage.setItem('hr_cart', JSON.stringify(cart));
}

function loadCart() {
    try {
        const savedCart = JSON.parse(localStorage.getItem('hr_cart'));
        cart = Array.isArray(savedCart) ? savedCart.map(normalizeCartItem).filter(Boolean) : [];
    } catch {
        cart = [];
    }

    const savedDiscountCode = (localStorage.getItem('hr_discount_code') || '').toUpperCase();
    appliedDiscountCode = getDiscountCodeDefinition(savedDiscountCode) ? savedDiscountCode : '';
}

function updateCartItemQty(key, delta) {
    const item = cart.find((cartItem) => cartItem.key === key);
    if (!item) return;

    const newQty = item.qty + delta;
    if (newQty <= 0) {
        removeCartItem(key);
        return;
    }

    item.qty = Math.min(10, newQty);
    saveCart();
    renderCheckout();
}

function removeCartItem(key) {
    cart = cart.filter((item) => item.key !== key);
    saveCart();
    renderCheckout();
}

function renderItems() {
    const list = $('#checkout-items');
    const empty = $('#checkout-empty');
    const totals = $('#checkout-totals');
    const confirmBtn = $('#confirm-order-btn');

    list.innerHTML = '';

    if (cart.length === 0) {
        empty.style.display = 'block';
        totals.style.display = 'none';
        confirmBtn.disabled = true;
        return;
    }

    empty.style.display = 'none';
    totals.style.display = 'block';
    confirmBtn.disabled = false;

    cart.forEach((item) => {
        const itemEl = document.createElement('article');
        itemEl.className = 'checkout-item';
        itemEl.innerHTML = `
            <div class="checkout-item-image">
                <img src="${item.image}" alt="${item.name}">
            </div>
            <div class="checkout-item-copy">
                <h3>${item.name}</h3>
                <div class="checkout-item-meta">
                    <span>${item.brand || 'H&R Perfume'}</span>
                    <span>${item.size}</span>
                </div>
                <div class="checkout-item-price">${formatCurrency(item.price * item.qty)}</div>
            </div>
            <div class="checkout-item-side">
                <button class="checkout-remove-item" type="button" data-key="${item.key}" aria-label="إزالة المنتج">
                    <i class="fas fa-times"></i>
                </button>
                <div class="checkout-item-qty">
                    <button type="button" data-action="increase" data-key="${item.key}" aria-label="زيادة الكمية">+</button>
                    <span>${item.qty}</span>
                    <button type="button" data-action="decrease" data-key="${item.key}" aria-label="تقليل الكمية">-</button>
                </div>
            </div>
        `;

        itemEl.querySelector('.checkout-remove-item').addEventListener('click', () => removeCartItem(item.key));
        itemEl.querySelectorAll('.checkout-item-qty button').forEach((btn) => {
            btn.addEventListener('click', () => updateCartItemQty(item.key, btn.dataset.action === 'increase' ? 1 : -1));
        });

        list.appendChild(itemEl);
    });
}

function renderTotals() {
    const { subtotal, discountAmount, finalTotal } = getCartTotals();
    const remainingForFreeShipping = Math.max(FREE_SHIPPING_THRESHOLD - finalTotal, 0);
    const shippingProgress = Math.min((finalTotal / FREE_SHIPPING_THRESHOLD) * 100, 100);
    const discountRow = $('#checkout-discount-row');
    const discountPill = $('#checkout-discount-pill');

    $('#checkout-subtotal').textContent = formatCurrency(subtotal);
    $('#checkout-total').textContent = formatCurrency(finalTotal);
    $('#checkout-shipping-progress').style.width = `${shippingProgress}%`;
    $('#checkout-shipping-message').textContent = remainingForFreeShipping === 0
        ? 'طلبك مؤهل للحصول على شحن مجاني.'
        : `أضف ${formatCurrency(remainingForFreeShipping)} للحصول على شحن مجاني.`;

    if (discountAmount > 0) {
        discountRow.style.display = 'flex';
        $('#checkout-discount').textContent = `-${formatCurrency(discountAmount)}`;
        discountPill.style.display = 'inline-flex';
        $('#checkout-discount-pill-text').textContent = `${appliedDiscountCode} • ${getDiscountDescription(appliedDiscountCode)}`;
    } else {
        discountRow.style.display = 'none';
        discountPill.style.display = 'none';
    }
}

function renderCheckout() {
    renderItems();
    renderTotals();
}

function getCustomerFields() {
    return {
        firstName: $('#customer-first-name'),
        lastName: $('#customer-last-name'),
        phone: $('#customer-phone'),
        governorate: $('#customer-governorate'),
        address: $('#customer-address'),
        notes: $('#customer-notes')
    };
}

function loadCustomerInfo() {
    try {
        const savedInfo = JSON.parse(localStorage.getItem('hr_customer_info'));
        if (!savedInfo) return;

        const fields = getCustomerFields();
        fields.firstName.value = savedInfo.firstName || '';
        fields.lastName.value = savedInfo.lastName || '';
        fields.phone.value = savedInfo.phone || '';
        fields.governorate.value = savedInfo.governorate || '';
        fields.address.value = savedInfo.address || '';
        fields.notes.value = savedInfo.notes || '';
    } catch {
        // Ignore malformed saved data.
    }
}

function saveCustomerInfo() {
    const fields = getCustomerFields();
    const payload = {
        firstName: fields.firstName.value.trim(),
        lastName: fields.lastName.value.trim(),
        phone: fields.phone.value.trim(),
        governorate: fields.governorate.value,
        address: fields.address.value.trim(),
        notes: fields.notes.value.trim()
    };

    localStorage.setItem('hr_customer_info', JSON.stringify(payload));
}

function validateForm() {
    const fields = getCustomerFields();
    const requiredFields = [fields.firstName, fields.lastName, fields.phone, fields.governorate, fields.address];

    for (const field of requiredFields) {
        if (!field.value.trim()) {
            field.focus();
            field.reportValidity?.();
            return false;
        }
    }

    return true;
}

function buildWhatsAppMessage(orderNumber) {
    const fields = getCustomerFields();
    const { subtotal, discountAmount, finalTotal } = getCartTotals();
    const fullName = `${fields.firstName.value.trim()} ${fields.lastName.value.trim()}`.trim();
    const notes = fields.notes.value.trim();

    let message = `*طلب جديد من H&R Perfume*\n`;
    message += `*رقم الطلب: ${orderNumber}*\n\n`;
    message += `الاسم: ${fullName}\n`;
    message += `الهاتف: ${fields.phone.value.trim()}\n`;
    message += `المنطقة: ${fields.governorate.value}\n`;
    message += `العنوان: ${fields.address.value.trim()}\n`;

    if (notes) {
        message += `ملاحظات: ${notes}\n`;
    }

    message += '\n*تفاصيل الطلب*\n';
    message += '------------------------------\n';

    cart.forEach((item, index) => {
        message += `${index + 1}. *${item.name}*\n`;
        message += `   الحجم: ${item.size}\n`;
        message += `   الكمية: ${item.qty}\n`;
        message += `   السعر: ${formatCurrency(item.price * item.qty)}\n`;
        message += '------------------------------\n';
    });

    message += `\nالمجموع الفرعي: ${formatCurrency(subtotal)}\n`;
    if (appliedDiscountCode && discountAmount > 0) {
        message += `كود الخصم: ${appliedDiscountCode}\n`;
        message += `قيمة الخصم: -${formatCurrency(discountAmount)}\n`;
    }
    message += `\n*المجموع النهائي: ${formatCurrency(finalTotal)}*\n`;
    message += '\nالدفع عند الاستلام.';

    return message;
}

function handleSubmit(event) {
    event.preventDefault();

    if (cart.length === 0) return;
    if (!validateForm()) return;

    saveCustomerInfo();
    const orderNumber = generateOrderNumber();
    const encoded = encodeURIComponent(buildWhatsAppMessage(orderNumber));
    window.open(`https://wa.me/962797107408?text=${encoded}`, '_blank');

    // Show order number to customer
    const toast = document.createElement('div');
    toast.className = 'order-toast';
    toast.innerHTML = `<i class="fas fa-check-circle"></i> تم إرسال طلبك <strong>${orderNumber}</strong>`;
    toast.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;padding:16px 28px;border-radius:12px;z-index:9999;font-size:1rem;display:flex;align-items:center;gap:10px;border:1px solid rgba(191,197,204,0.3);box-shadow:0 8px 32px rgba(0,0,0,0.4);animation:slideDown .4s ease';
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity .4s'; setTimeout(() => toast.remove(), 400); }, 5000);
}

document.addEventListener('DOMContentLoaded', () => {
    loadCart();
    loadCustomerInfo();
    renderCheckout();

    $('#checkout-form').addEventListener('submit', handleSubmit);
    Object.values(getCustomerFields()).forEach((field) => {
        field.addEventListener('input', saveCustomerInfo);
        field.addEventListener('change', saveCustomerInfo);
    });
});
