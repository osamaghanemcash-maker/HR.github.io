const SUPABASE_URL = 'https://udwulegatrwkpwloevjz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rPSseT-GCVtok4XkaJ62Pg_qLWpwH-a';
const FREE_SHIPPING_THRESHOLD = 60;
const discountCodeCache = new Map();

let cart = [];
let appliedDiscountCode = '';
let appliedDiscountDefinition = null;

async function fetchDiscountCodeDefinition(code) {
    const upper = (code || '').trim().toUpperCase();
    if (!upper) return null;
    if (discountCodeCache.has(upper)) return discountCodeCache.get(upper);
    try {
        const url = `${SUPABASE_URL}/rest/v1/discount_codes?code=eq.${encodeURIComponent(upper)}&is_active=eq.true&select=*`;
        const res = await fetch(url, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        if (!res.ok) return null;
        const rows = await res.json();
        const row = rows[0] || null;
        if (row) discountCodeCache.set(upper, row);
        return row;
    } catch {
        return null;
    }
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

function calculateDiscountAmount(subtotal) {
    const d = appliedDiscountDefinition;
    if (!d) return 0;
    if (d.min_order_total != null && subtotal < Number(d.min_order_total)) return 0;
    const raw = d.type === 'percentage'
        ? Math.min(subtotal, subtotal * (Number(d.value) / 100))
        : Math.min(subtotal, Number(d.value));
    return Math.round(raw * 100) / 100;
}

function revalidateAppliedDiscount() {
    if (!appliedDiscountDefinition) return false;
    const d = appliedDiscountDefinition;
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const expired = d.expires_at && new Date(d.expires_at) < new Date();
    const usedUp = d.max_uses != null && d.current_uses >= d.max_uses;
    const belowMin = d.min_order_total != null && subtotal < Number(d.min_order_total);
    if (expired || usedUp || belowMin || cart.length === 0) {
        appliedDiscountCode = '';
        appliedDiscountDefinition = null;
        localStorage.removeItem('hr_discount_code');
        return true;
    }
    return false;
}

function getCartTotals() {
    revalidateAppliedDiscount();
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const discountAmount = calculateDiscountAmount(subtotal);
    const finalTotal = Math.max(0, subtotal - discountAmount);

    return { subtotal, discountAmount, finalTotal };
}

function getDiscountDescription() {
    const d = appliedDiscountDefinition;
    if (!d) return '';
    return d.type === 'percentage'
        ? `خصم ${d.value}%`
        : `خصم ${formatCurrency(d.value)}`;
}

function saveCart() {
    localStorage.setItem('hr_cart', JSON.stringify(cart));
}

async function loadCart() {
    try {
        const savedCart = JSON.parse(localStorage.getItem('hr_cart'));
        cart = Array.isArray(savedCart) ? savedCart.map(normalizeCartItem).filter(Boolean) : [];
    } catch {
        cart = [];
    }

    const savedDiscountCode = (localStorage.getItem('hr_discount_code') || '').toUpperCase();
    if (!savedDiscountCode) {
        appliedDiscountCode = '';
        appliedDiscountDefinition = null;
        return;
    }
    const def = await fetchDiscountCodeDefinition(savedDiscountCode);
    if (!def) {
        localStorage.removeItem('hr_discount_code');
        appliedDiscountCode = '';
        appliedDiscountDefinition = null;
        return;
    }
    if (def.expires_at && new Date(def.expires_at) < new Date()) {
        localStorage.removeItem('hr_discount_code');
        appliedDiscountCode = '';
        appliedDiscountDefinition = null;
        return;
    }
    if (def.max_uses != null && def.current_uses >= def.max_uses) {
        localStorage.removeItem('hr_discount_code');
        appliedDiscountCode = '';
        appliedDiscountDefinition = null;
        return;
    }
    const subtotalNow = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    if (def.min_order_total != null && subtotalNow < Number(def.min_order_total)) {
        localStorage.removeItem('hr_discount_code');
        appliedDiscountCode = '';
        appliedDiscountDefinition = null;
        return;
    }
    appliedDiscountCode = savedDiscountCode;
    appliedDiscountDefinition = def;
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
        $('#checkout-discount-pill-text').textContent = `${appliedDiscountCode} • ${getDiscountDescription()}`;
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

function buildWhatsAppMessage(serverOrder) {
    const fields = getCustomerFields();
    const fullName = `${fields.firstName.value.trim()} ${fields.lastName.value.trim()}`.trim();
    const notes = fields.notes.value.trim();

    let message = `*طلب جديد من H&R Perfume*\n`;
    message += `*رقم الطلب: #${serverOrder.order_number}*\n\n`;
    message += `الاسم: ${fullName}\n`;
    message += `الهاتف: ${fields.phone.value.trim()}\n`;
    message += `المنطقة: ${fields.governorate.value}\n`;
    message += `العنوان: ${fields.address.value.trim()}\n`;

    if (notes) {
        message += `ملاحظات: ${notes}\n`;
    }

    message += '\n*تفاصيل الطلب*\n';
    message += '------------------------------\n';

    serverOrder.items.forEach((item, index) => {
        message += `${index + 1}. *${item.name}*\n`;
        message += `   الحجم: ${item.size}\n`;
        message += `   الكمية: ${item.qty}\n`;
        message += `   السعر: ${formatCurrency(item.price * item.qty)}\n`;
        message += '------------------------------\n';
    });

    message += `\nالمجموع الفرعي: ${formatCurrency(serverOrder.subtotal)}\n`;
    if (serverOrder.discount_code && serverOrder.discount_amount > 0) {
        message += `كود الخصم: ${serverOrder.discount_code}\n`;
        message += `قيمة الخصم: -${formatCurrency(serverOrder.discount_amount)}\n`;
    }
    if (serverOrder.shipping > 0) {
        message += `رسوم التوصيل: ${formatCurrency(serverOrder.shipping)}\n`;
    } else {
        message += `رسوم التوصيل: مجاني\n`;
    }
    message += `\n*المجموع النهائي: ${formatCurrency(serverOrder.total)}*\n`;
    message += '\nالدفع عند الاستلام.';

    return message;
}

function persistOrderSnapshot(serverOrder) {
    const fields = getCustomerFields();

    const snapshot = {
        orderNumber: `#${serverOrder.order_number}`,
        date: new Date().toISOString(),
        items: serverOrder.items.map((item) => ({
            name: item.name,
            brand: item.brand,
            image: item.image,
            size: item.size,
            qty: item.qty,
            price: item.price
        })),
        subtotal: serverOrder.subtotal,
        discountAmount: serverOrder.discount_amount,
        discountCode: serverOrder.discount_code || '',
        shippingCost: serverOrder.shipping,
        finalTotal: serverOrder.total,
        paymentMethod: 'cod',
        customer: {
            firstName: fields.firstName.value.trim(),
            lastName: fields.lastName.value.trim(),
            phone: fields.phone.value.trim(),
            governorate: fields.governorate.value,
            address: fields.address.value.trim(),
            notes: fields.notes.value.trim()
        }
    };

    localStorage.setItem('hr_last_order', JSON.stringify(snapshot));
}

async function placeOrderViaEdgeFunction() {
    const fields = getCustomerFields();
    const payload = {
        items: cart.map((item) => ({ id: item.id, size: item.size, qty: item.qty })),
        discount_code: appliedDiscountCode || null,
        customer: {
            first_name: fields.firstName.value.trim(),
            last_name: fields.lastName.value.trim(),
            phone: fields.phone.value.trim(),
            governorate: fields.governorate.value,
            address: fields.address.value.trim(),
            notes: fields.notes.value.trim()
        }
    };

    const res = await fetch(`${SUPABASE_URL}/functions/v1/place-order`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        let code = '';
        let detail = '';
        try {
            const body = await res.json();
            code = body?.error || '';
            detail = JSON.stringify(body);
        } catch {}
        const err = new Error(`place-order ${res.status}: ${detail}`);
        err.code = code;
        err.status = res.status;
        throw err;
    }

    return res.json();
}

const PLACE_ORDER_ERROR_MESSAGES = {
    empty_cart: 'سلة المشتريات فارغة.',
    too_many_items: 'عدد الأصناف في السلة كبير جداً.',
    invalid_item_id: 'أحد المنتجات غير صالح. يرجى تحديث السلة.',
    invalid_item_size: 'الحجم المطلوب لأحد المنتجات غير صالح.',
    invalid_item_qty: 'الكمية المطلوبة لأحد المنتجات غير صالحة (1–10).',
    missing_customer_fields: 'يرجى تعبئة جميع حقول معلومات التوصيل.',
    product_not_found: 'أحد المنتجات لم يعد متوفراً. يرجى تحديث السلة.',
    product_unavailable: 'أحد المنتجات في السلة غير متوفر حالياً. يرجى إزالته والمحاولة مجدداً.',
    invalid_size_for_product: 'الحجم المطلوب لأحد المنتجات لم يعد متاحاً.',
};

function messageForOrderError(err) {
    const fallback = 'عذراً، حدث خطأ أثناء تجهيز الطلب. الرجاء المحاولة مرة أخرى أو التواصل معنا عبر الواتساب.';
    if (err && err.code && PLACE_ORDER_ERROR_MESSAGES[err.code]) {
        return PLACE_ORDER_ERROR_MESSAGES[err.code];
    }
    return fallback;
}

async function handleSubmit(event) {
    event.preventDefault();

    if (cart.length === 0) return;
    if (!validateForm()) return;

    const confirmBtn = $('#confirm-order-btn');
    if (confirmBtn) confirmBtn.disabled = true;

    saveCustomerInfo();

    // Open WhatsApp window SYNCHRONOUSLY (before await) to preserve user-gesture
    // context — mobile browsers block popups after async gaps.
    const whatsappWindow = window.open('about:blank', '_blank');

    let serverOrder;
    try {
        serverOrder = await placeOrderViaEdgeFunction();
    } catch (err) {
        console.error('[place-order] failed:', err);
        if (whatsappWindow && !whatsappWindow.closed) whatsappWindow.close();
        if (confirmBtn) confirmBtn.disabled = false;
        alert(messageForOrderError(err));
        return;
    }

    persistOrderSnapshot(serverOrder);

    // Order is confirmed in the DB at this point — clear the active cart and
    // discount code immediately so the user can't accidentally resubmit them
    // even if the WhatsApp redirect or the confirmation navigation is interrupted.
    cart = [];
    saveCart();
    localStorage.removeItem('hr_discount_code');
    appliedDiscountCode = '';

    const encoded = encodeURIComponent(buildWhatsAppMessage(serverOrder));
    const whatsappUrl = `https://wa.me/962797107408?text=${encoded}`;

    if (whatsappWindow && !whatsappWindow.closed) {
        whatsappWindow.location.href = whatsappUrl;
    } else {
        window.location.href = whatsappUrl;
        return;
    }

    window.location.href = 'order-confirmation.html';
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadCart();
    loadCustomerInfo();
    renderCheckout();

    $('#checkout-form').addEventListener('submit', handleSubmit);
    Object.values(getCustomerFields()).forEach((field) => {
        field.addEventListener('input', saveCustomerInfo);
        field.addEventListener('change', saveCustomerInfo);
    });
});
