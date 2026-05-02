// ===== Supabase Configuration =====
const SUPABASE_URL = 'https://udwulegatrwkpwloevjz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rPSseT-GCVtok4XkaJ62Pg_qLWpwH-a';
const FREE_SHIPPING_THRESHOLD = 60;
const discountCodeCache = new Map();

// ===== State =====
let allProducts = [];
let cart = [];
let currentFilter = 'all';
let currentSlide = 0;
let slideInterval;
let selectedProduct = null;
let selectedSize = '100ml';
let selectedQty = 1;
let appliedDiscountCode = '';
let appliedDiscountDefinition = null;
let visibleProductsCount = 8;
const PRODUCTS_PER_PAGE = 8;

// ===== DOM Elements =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function formatCurrency(value) {
    return `${Number(value).toFixed(2)} \u062f.\u0623`;
}

function getProductCategory(productOrGender) {
    // If a full product object is passed, check niche boolean first
    if (typeof productOrGender === 'object' && productOrGender?.niche === true) {
        return 'niche';
    }

    const rawValue = typeof productOrGender === 'string'
        ? productOrGender
        : productOrGender?.gender;
    const normalized = String(rawValue || '').trim().toLowerCase();

    if (normalized === 'him') return 'Him';
    if (normalized === 'her') return 'Her';
    if (normalized === 'unisex') return 'Unisex';
    if (normalized === 'niche') return 'niche';

    return rawValue || '';
}

function getProductBottlePrice(product) {
    return getProductCategory(product) === 'niche'
        ? 20
        : (Number(product?.price_100ml) || 0);
}

function getProductBottleSize(product) {
    return getProductCategory(product) === 'niche' ? '60ml' : '100ml';
}

function getGenderArabic(gender) {
    const map = {
        Him: '\u0644\u0644\u0631\u062c\u0627\u0644',
        Her: '\u0644\u0644\u0646\u0633\u0627\u0621',
        Unisex: '\u0644\u0644\u062c\u0646\u0633\u064a\u0646',
        niche: '\u0639\u0637\u0648\u0631 \u0627\u0644\u0646\u064a\u0634'
    };
    const category = getProductCategory(gender);
    return map[category] || category;
}

function getGenderIcon(gender) {
    const map = {
        Him: 'fas fa-mars',
        Her: 'fas fa-venus',
        Unisex: 'fas fa-venus-mars',
        niche: 'fas fa-gem'
    };
    const category = getProductCategory(gender);
    return map[category] || 'fas fa-user';
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

function calculateDiscountAmount(subtotal) {
    const d = appliedDiscountDefinition;
    if (!d) return 0;
    if (d.min_order_total != null && subtotal < Number(d.min_order_total)) return 0;
    const raw = d.type === 'percentage'
        ? Math.min(subtotal, subtotal * (Number(d.value) / 100))
        : Math.min(subtotal, Number(d.value));
    return Math.round(raw * 100) / 100;
}

function getCartTotals() {
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const discountAmount = calculateDiscountAmount(subtotal);
    const finalTotal = Math.max(0, subtotal - discountAmount);

    return { subtotal, discountAmount, finalTotal };
}

function getDiscountDescription() {
    const d = appliedDiscountDefinition;
    if (!d) return '';
    return d.type === 'percentage'
        ? `\u062e\u0635\u0645 ${d.value}%`
        : `\u062e\u0635\u0645 ${formatCurrency(d.value)}`;
}

function shouldCompactCartDiscount() {
    return window.innerWidth <= 768;
}

function syncDiscountCollapseState(forceExpanded = null) {
    const section = $('#cart-discount-section');
    const toggleBtn = $('#discount-toggle-btn');
    const toggleHint = $('#discount-toggle-hint');

    if (!section || !toggleBtn || !toggleHint) return;

    const hasAppliedCode = Boolean(appliedDiscountCode && appliedDiscountDefinition);
    const isCompact = shouldCompactCartDiscount();
    let expanded = true;

    if (typeof forceExpanded === 'boolean') {
        expanded = forceExpanded;
    } else if (hasAppliedCode) {
        expanded = true;
    } else if (section.classList.contains('is-expanded')) {
        expanded = true;
    } else if (section.classList.contains('is-collapsed')) {
        expanded = false;
    } else {
        expanded = !isCompact;
    }

    section.classList.toggle('is-expanded', expanded);
    section.classList.toggle('is-collapsed', !expanded);
    toggleBtn.setAttribute('aria-expanded', String(expanded));
    toggleHint.textContent = hasAppliedCode
        ? '\u0645\u0637\u0628\u0642'
        : (isCompact ? (expanded ? '\u0625\u062e\u0641\u0627\u0621' : '\u0625\u0636\u0627\u0641\u0629') : '\u0627\u062e\u062a\u064a\u0627\u0631\u064a');
}

function toggleDiscountSection() {
    const section = $('#cart-discount-section');
    if (!section) return;

    const nextExpandedState = !section.classList.contains('is-expanded');
    syncDiscountCollapseState(nextExpandedState);

    if (nextExpandedState) {
        setTimeout(() => $('#discount-code-input')?.focus(), 140);
    }
}

function setDiscountValidationMessage(message = '', state = '') {
    const messageEl = $('#discount-validation-message');
    if (!messageEl) return;

    messageEl.textContent = message;
    messageEl.className = 'cart-discount-message';
    if (state) messageEl.classList.add(`is-${state}`);
}

function syncDiscountUI() {
    const input = $('#discount-code-input');
    const applyBtn = $('#discount-apply-btn');
    const appliedBox = $('#discount-applied-box');
    const appliedCodeEl = $('#discount-applied-code');
    const appliedValueEl = $('#discount-applied-value');

    if (!input || !applyBtn) return;

    input.value = input.value.toUpperCase();
    applyBtn.disabled = input.value.trim().length === 0;

    if (appliedDiscountCode && appliedDiscountDefinition) {
        const { discountAmount } = getCartTotals();
        appliedBox.style.display = 'block';
        appliedCodeEl.textContent = `\u0643\u0648\u062f \u0627\u0644\u062e\u0635\u0645: ${appliedDiscountCode}`;
        appliedValueEl.textContent = `${getDiscountDescription()} - ${formatCurrency(discountAmount)}`;
    } else if (appliedBox) {
        appliedBox.style.display = 'none';
    }

    syncDiscountCollapseState();
}

async function applyDiscountCode() {
    const input = $('#discount-code-input');
    if (!input) return;

    const code = input.value.trim().toUpperCase();
    input.value = code;

    if (!code) {
        setDiscountValidationMessage('\u0627\u0644\u0631\u062c\u0627\u0621 \u0625\u062f\u062e\u0627\u0644 \u0643\u0648\u062f \u062e\u0635\u0645', 'invalid');
        input.focus();
        return;
    }

    const def = await fetchDiscountCodeDefinition(code);
    if (!def) {
        setDiscountValidationMessage('\u2717 \u0643\u0648\u062f \u063a\u064a\u0631 \u0635\u062d\u064a\u062d', 'invalid');
        input.focus();
        return;
    }

    if (def.expires_at && new Date(def.expires_at) < new Date()) {
        setDiscountValidationMessage('\u2717 \u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062f \u0645\u0646\u062a\u0647\u064a \u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0629', 'invalid');
        return;
    }

    if (def.max_uses != null && def.current_uses >= def.max_uses) {
        setDiscountValidationMessage('\u2717 \u062a\u0645 \u0627\u0633\u062a\u0646\u0641\u0627\u062f \u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062f', 'invalid');
        return;
    }

    const { subtotal } = getCartTotals();
    if (def.min_order_total != null && subtotal < def.min_order_total) {
        setDiscountValidationMessage(`\u2717 \u0627\u0644\u062d\u062f \u0627\u0644\u0623\u062f\u0646\u0649 \u0644\u0644\u0637\u0644\u0628 ${formatCurrency(def.min_order_total)}`, 'invalid');
        return;
    }

    appliedDiscountCode = code;
    appliedDiscountDefinition = def;
    localStorage.setItem('hr_discount_code', appliedDiscountCode);
    updateCartUI();
    syncDiscountCollapseState(true);
    setDiscountValidationMessage('\u062a\u0645 \u062a\u0637\u0628\u064a\u0642 \u0627\u0644\u0643\u0648\u062f \u0628\u0646\u062c\u0627\u062d', 'applied');
}

function removeDiscountCode() {
    appliedDiscountCode = '';
    appliedDiscountDefinition = null;
    localStorage.removeItem('hr_discount_code');
    const input = $('#discount-code-input');
    if (input) input.value = '';
    updateCartUI();
    syncDiscountCollapseState(false);
    setDiscountValidationMessage('', '');
}

function handleDiscountInput() {
    const input = $('#discount-code-input');
    if (!input) return;

    input.value = input.value.toUpperCase();
    const code = input.value.trim();
    $('#discount-apply-btn').disabled = code.length === 0;

    if (!code) {
        setDiscountValidationMessage('', '');
        return;
    }

    setDiscountValidationMessage('', '');
}

// ===== Supabase Fetch =====
async function fetchProducts() {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/perfumes?select=*&order=ID.asc`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        });
        if (!response.ok) throw new Error('فشل في تحميل المنتجات');
        allProducts = await response.json();
        renderBestSellers();
        renderProducts(allProducts);
    } catch (error) {
        console.error('Error:', error);
        $('#best-sellers-grid').innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px;">عذراً، حدث خطأ في تحميل المنتجات. يرجى تحديث الصفحة.</p>`;
        $('#products-grid').innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px;">عذراً، حدث خطأ في تحميل المنتجات. يرجى تحديث الصفحة.</p>`;
    }
}


// ===== Render Product Card =====
function createProductCard(product, index) {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.style.animationDelay = `${index * 0.06}s`;
    card.dataset.id = product.ID;

    card.innerHTML = `
        <div class="product-image">
            <img src="${product.image_url}" alt="${product.name}" loading="lazy">
            ${product.is_best_seller ? '<span class="product-badge badge-bestseller"><i class="fas fa-fire"></i> الأكثر مبيعاً</span>' : ''}
            <div class="product-overlay">
                <span class="product-overlay-btn"><i class="fas fa-eye"></i> عرض سريع</span>
            </div>
        </div>
        <div class="product-info">
            <h3 class="product-name">${product.name} - H&R</h3>
            <span class="product-gender">
                <i class="${getGenderIcon(product.gender)}"></i>
                ${getGenderArabic(product.gender)}
            </span>
            <div class="product-prices">
                <div class="price-tag">
                    <span class="price-size">${getProductBottleSize(product)}</span>
                    <span class="price-value">${getProductBottlePrice(product)} <span class="price-currency">\u062f.\u0623</span></span>
                </div>
            </div>
        </div>
    `;

    card.addEventListener('click', () => openProductModal(product));
    return card;
}

// ===== Render Best Sellers =====
function renderBestSellers() {
    const grid = $('#best-sellers-grid');
    grid.innerHTML = '';
    const bestSellers = allProducts.filter(p => p.is_best_seller);
    bestSellers.forEach((product, index) => {
        grid.appendChild(createProductCard(product, index));
    });
}

// ===== Render Products =====
let _currentFilteredProducts = [];

function renderProducts(products, resetCount = true) {
    const grid = $('#products-grid');
    const showMoreContainer = $('#show-more-container');
    const showMoreCount = $('#show-more-count');

    _currentFilteredProducts = products;
    if (resetCount) visibleProductsCount = PRODUCTS_PER_PAGE;

    grid.innerHTML = '';

    if (products.length === 0) {
        grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px;font-size:1.1rem;">لا توجد منتجات في هذه الفئة</p>`;
        if (showMoreContainer) showMoreContainer.style.display = 'none';
        return;
    }

    const toShow = products.slice(0, visibleProductsCount);
    toShow.forEach((product, index) => {
        grid.appendChild(createProductCard(product, index));
    });

    const remaining = products.length - visibleProductsCount;
    if (showMoreContainer) {
        if (remaining > 0) {
            showMoreContainer.style.display = 'flex';
            if (showMoreCount) showMoreCount.textContent = `(${remaining})`;
        } else {
            showMoreContainer.style.display = 'none';
        }
    }
}

function showMoreProducts() {
    visibleProductsCount += PRODUCTS_PER_PAGE;
    renderProducts(_currentFilteredProducts, false);
}

// ===== Product Modal =====
function openProductModal(product) {
    selectedProduct = product;
    const bottleSize = getProductBottleSize(product);
    selectedSize = bottleSize;
    selectedQty = 1;

    $('#modal-product-image').src = product.image_url;
    $('#modal-product-image').alt = product.name;
    $('#modal-brand').textContent = '';
    $('#modal-name').textContent = product.name + ' -H&R ';
    $('#modal-gender').innerHTML = `<i class="${getGenderIcon(product.gender)}"></i> ${getGenderArabic(product.gender)}`;
    const sizeBtn = $('#size-60');
    sizeBtn.dataset.size = bottleSize;
    sizeBtn.querySelector('.size-label').textContent = bottleSize;
    $('#price-60').textContent = `${getProductBottlePrice(product)} \u062f.\u0623`;
    $('#qty-value').textContent = '1';

    // Reset size selection
    $$('.size-btn').forEach(btn => btn.classList.remove('active'));
    sizeBtn.classList.add('active');

    // Show modal
    $('#product-modal-overlay').classList.add('active');
    $('#product-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeProductModal() {
    $('#product-modal-overlay').classList.remove('active');
    $('#product-modal').classList.remove('active');
    document.body.style.overflow = '';
    selectedProduct = null;
}

// ===== Cart Functions =====
function addToCart(product, size, qty) {
    const cartKey = `${product.ID}-${size}`;
    const existingItem = cart.find(item => item.key === cartKey);
    const price = getProductBottlePrice(product);

    if (existingItem) {
        existingItem.qty += qty;
    } else {
        cart.push(normalizeCartItem({
            key: cartKey,
            id: product.ID,
            name: product.name,
            brand: product.brand,
            size: size,
            price: price,
            qty: qty,
            image: product.image_url
        }));
    }

    saveCart();
    updateCartUI();
    openCart();
    showToast(`تمت إضافة ${product.name} (${size}) إلى السلة`);

    // Bump animation on cart count
    const cartCount = $('#cart-count');
    cartCount.classList.add('bump');
    setTimeout(() => cartCount.classList.remove('bump'), 300);
}

function ensureNicheFilterUI() {
    const filterBar = $('.filter-bar');
    if (filterBar && !filterBar.querySelector('[data-filter="niche"]')) {
        const nicheBtn = document.createElement('button');
        nicheBtn.className = 'filter-btn';
        nicheBtn.dataset.filter = 'niche';
        nicheBtn.innerHTML = '<i class="fas fa-gem"></i> \u0639\u0637\u0648\u0631 \u0627\u0644\u0646\u064a\u0634';
        filterBar.appendChild(nicheBtn);
    }

    const footerCategoryList = $('[data-filter-link="Unisex"]')?.closest('ul');
    if (footerCategoryList && !footerCategoryList.querySelector('[data-filter-link="niche"]')) {
        const nicheLinkItem = document.createElement('li');
        nicheLinkItem.innerHTML = '<a href="#products" data-filter-link="niche">\u0639\u0637\u0648\u0631 \u0627\u0644\u0646\u064a\u0634</a>';
        footerCategoryList.appendChild(nicheLinkItem);
    }
}

function removeFromCart(key) {
    cart = cart.filter(item => item.key !== key);
    saveCart();
    updateCartUI();
}

try {
    const savedCart = JSON.parse(localStorage.getItem('hr_cart'));
    cart = Array.isArray(savedCart)
        ? savedCart.map(normalizeCartItem).filter(Boolean)
        : [];
} catch {
    cart = [];
}

async function restoreSavedDiscountCode() {
    const saved = (localStorage.getItem('hr_discount_code') || '').toUpperCase();
    if (!saved) return;
    const def = await fetchDiscountCodeDefinition(saved);
    if (!def) { localStorage.removeItem('hr_discount_code'); return; }
    if (def.expires_at && new Date(def.expires_at) < new Date()) {
        localStorage.removeItem('hr_discount_code');
        return;
    }
    if (def.max_uses != null && def.current_uses >= def.max_uses) {
        localStorage.removeItem('hr_discount_code');
        return;
    }
    appliedDiscountCode = saved;
    appliedDiscountDefinition = def;
    updateCartUI();
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
        if (belowMin && !expired && !usedUp) {
            setDiscountValidationMessage(`✗ الحد الأدنى للطلب ${formatCurrency(d.min_order_total)}`, 'invalid');
        } else {
            setDiscountValidationMessage('', '');
        }
        return true;
    }
    return false;
}

function updateCartItemQty(key, delta) {
    const item = cart.find(cartItem => cartItem.key === key);
    if (!item) return;

    const newQty = item.qty + delta;

    if (newQty <= 0) {
        removeFromCart(key);
        return;
    }

    item.qty = Math.min(10, newQty);

    saveCart();
    updateCartUI();
}

function clearCart() {
    cart = [];
    saveCart();
    updateCartUI();
}

function saveCart() {
    localStorage.setItem('hr_cart', JSON.stringify(cart));
}

function updateCartUI() {
    cart = cart.map(normalizeCartItem).filter(Boolean);

    saveCart();

    revalidateAppliedDiscount();

    const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
    const { subtotal, discountAmount, finalTotal } = getCartTotals();

    $('#cart-count').textContent = totalItems;
    $('#cart-subtotal-price').textContent = formatCurrency(subtotal);
    $('#cart-total-price').textContent = formatCurrency(finalTotal);

    const discountRow = $('#cart-discount-row');
    const discountPrice = $('#cart-discount-price');
    if (discountRow && discountPrice) {
        discountRow.style.display = discountAmount > 0 ? 'flex' : 'none';
        discountPrice.textContent = `-${formatCurrency(discountAmount)}`;
    }

    const shippingMessage = $('#cart-shipping-message');
    const shippingProgressBar = $('#cart-shipping-progress');
    if (shippingMessage) {
        shippingMessage.textContent = '\u0631\u0633\u0648\u0645 \u0627\u0644\u062a\u0648\u0635\u064a\u0644: 2 \u062f.\u0623 \u062f\u0627\u062e\u0644 \u0639\u0645\u0651\u0627\u0646 \u00b7 3 \u062f.\u0623 \u0644\u0628\u0642\u064a\u0629 \u0627\u0644\u0645\u062d\u0627\u0641\u0638\u0627\u062a';
    }
    if (shippingProgressBar) {
        shippingProgressBar.style.display = 'none';
    }

    syncDiscountUI();

    const cartItemsContainer = $('#cart-items');
    const cartFooter = $('#cart-footer');

    if (cart.length === 0) {
        cartItemsContainer.innerHTML = `
            <div class="cart-empty" id="cart-empty" style="display:flex;">
                <i class="fas fa-shopping-bag"></i>
                <p>سلة التسوق فارغة</p>
                <span>أضف منتجات لتبدأ التسوق</span>
            </div>`;
        cartFooter.style.display = 'none';
        setDiscountValidationMessage('', '');
    } else {
        cartItemsContainer.innerHTML = '';
        cartFooter.style.display = 'block';

        cart.forEach(item => {
            const cartItemEl = document.createElement('div');
            cartItemEl.className = 'cart-item';
            cartItemEl.innerHTML = `
                <button class="cart-item-remove" data-key="${item.key}" aria-label="Remove item"><i class="fas fa-times"></i></button>
                <div class="cart-item-image">
                    <img src="${item.image}" alt="${item.name}">
                </div>
                <div class="cart-item-info">
                    <span class="cart-item-name">${item.name}</span>
                    <div class="cart-item-meta">
                        <span class="cart-item-detail">${item.size}</span>
                        <div class="cart-item-qty">
                            <button class="cart-qty-btn" data-action="increase" data-key="${item.key}" aria-label="Increase quantity">+</button>
                            <span class="cart-qty-value">${item.qty}</span>
                            <button class="cart-qty-btn" data-action="decrease" data-key="${item.key}" aria-label="Decrease quantity">-</button>
                        </div>
                    </div>
                    <div class="cart-item-bottom">
                        <span class="cart-item-price">${formatCurrency(item.price * item.qty)}</span>
                        <span class="cart-item-detail">${formatCurrency(item.price)} x ${item.qty}</span>
                    </div>
                </div>
            `;

            cartItemEl.querySelector('.cart-item-remove').addEventListener('click', (e) => {
                e.stopPropagation();
                removeFromCart(item.key);
            });

            cartItemEl.querySelectorAll('.cart-qty-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    updateCartItemQty(item.key, btn.dataset.action === 'increase' ? 1 : -1);
                });
            });

            cartItemsContainer.appendChild(cartItemEl);
        });
    }
}

// ===== Cart Sidebar Toggle =====
function openCart() {
    $('#cart-sidebar').classList.add('active');
    $('#cart-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    syncDiscountCollapseState();
}

function closeCart() {
    $('#cart-sidebar').classList.remove('active');
    $('#cart-overlay').classList.remove('active');
    document.body.style.overflow = '';
}

function goToCheckoutPage() {
    if (cart.length === 0) return;

    window.location.href = 'checkout.html';
}

// ===== Order Number =====
async function generateOrderNumber() {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_order_counter`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });
        if (!response.ok) throw new Error('RPC failed');
        const num = await response.json();
        return `#ORD-${num}`;
    } catch {
        // Fallback: local counter if Supabase is unreachable
        let orderCounter = parseInt(localStorage.getItem('hr_order_counter') || '1000');
        orderCounter++;
        localStorage.setItem('hr_order_counter', orderCounter.toString());
        return `#ORD-${orderCounter}`;
    }
}

// ===== WhatsApp Checkout =====
async function sendWhatsAppOrder() {
    if (cart.length === 0) return;

    // Open WhatsApp window SYNCHRONOUSLY (before await) to preserve user-gesture
    // context — mobile browsers block popups after async gaps.
    const whatsappWindow = window.open('about:blank', '_blank');

    const orderNumber = await generateOrderNumber();
    const { subtotal, discountAmount, finalTotal } = getCartTotals();
    let message = `*\u0637\u0644\u0628 \u062c\u062f\u064a\u062f \u0645\u0646 H&R Perfume*\n`;
    message += `*\u0631\u0642\u0645 \u0627\u0644\u0637\u0644\u0628: ${orderNumber}*\n\n`;
    message += '------------------------------\n';

    cart.forEach((item, i) => {
        message += `${i + 1}. *${item.name}*\n`;
        message += `   \u0627\u0644\u062d\u062c\u0645: ${item.size}\n`;
        message += `   \u0627\u0644\u0643\u0645\u064a\u0629: ${item.qty}\n`;
        message += `   \u0627\u0644\u0633\u0639\u0631: ${formatCurrency(item.price * item.qty)}\n`;
        message += '------------------------------\n';
    });

    message += `\n\u0627\u0644\u0645\u062c\u0645\u0648\u0639 \u0627\u0644\u0641\u0631\u0639\u064a: ${formatCurrency(subtotal)}\n`;
    if (appliedDiscountCode && discountAmount > 0) {
        message += `\u0643\u0648\u062f \u0627\u0644\u062e\u0635\u0645: ${appliedDiscountCode}\n`;
        message += `\u0642\u064a\u0645\u0629 \u0627\u0644\u062e\u0635\u0645: -${formatCurrency(discountAmount)}\n`;
    }
    message += `\n*\u0627\u0644\u0645\u062c\u0645\u0648\u0639 \u0627\u0644\u0646\u0647\u0627\u0626\u064a: ${formatCurrency(finalTotal)}*\n`;
    message += '\n\u0623\u0631\u062c\u0648 \u062a\u0623\u0643\u064a\u062f \u0627\u0644\u0637\u0644\u0628. \u0634\u0643\u0631\u0627\u064b!';

    showToast(`\u062a\u0645 \u0625\u0631\u0633\u0627\u0644 \u0637\u0644\u0628\u0643 ${orderNumber}`);

    const encoded = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/962797107408?text=${encoded}`;

    if (whatsappWindow && !whatsappWindow.closed) {
        whatsappWindow.location.href = whatsappUrl;
    } else {
        // Fallback if popup was still blocked — navigate directly
        window.location.href = whatsappUrl;
    }
}

// ===== Toast Notification =====
function showToast(message) {
    // Remove existing toast
    const existingToast = $('.toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 2500);
}

// ===== Hero Slider =====
function initSlider() {
    const slides = $$('.slide');
    const dotsContainer = $('#slider-dots');

    // Create dots
    slides.forEach((_, i) => {
        const dot = document.createElement('span');
        dot.className = `slider-dot${i === 0 ? ' active' : ''}`;
        dot.addEventListener('click', () => goToSlide(i));
        dotsContainer.appendChild(dot);
    });

    // Auto advance
    startSlideInterval();

    $('#prev-slide').addEventListener('click', () => {
        goToSlide((currentSlide - 1 + slides.length) % slides.length);
        resetSlideInterval();
    });

    $('#next-slide').addEventListener('click', () => {
        goToSlide((currentSlide + 1) % slides.length);
        resetSlideInterval();
    });
}

function goToSlide(index) {
    const slides = $$('.slide');
    const dots = $$('.slider-dot');

    slides[currentSlide].classList.remove('active');
    dots[currentSlide].classList.remove('active');

    currentSlide = index;

    slides[currentSlide].classList.add('active');
    dots[currentSlide].classList.add('active');
}

function startSlideInterval() {
    slideInterval = setInterval(() => {
        const slides = $$('.slide');
        goToSlide((currentSlide + 1) % slides.length);
    }, 5000);
}

function resetSlideInterval() {
    clearInterval(slideInterval);
    startSlideInterval();
}

// ===== Scroll Animations =====
function initScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    $$('.fade-in, .section-header, .feature-item, .contact-card, .about-content, .stat').forEach(el => {
        el.classList.add('fade-in');
        observer.observe(el);
    });
}

// ===== Counter Animation =====
function animateCounters() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const counter = entry.target;
                const target = parseInt(counter.dataset.count);
                const duration = 2000;
                const startTime = performance.now();

                function updateCounter(currentTime) {
                    const elapsed = currentTime - startTime;
                    const progress = Math.min(elapsed / duration, 1);
                    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
                    counter.textContent = Math.round(eased * target) + '+';

                    if (progress < 1) {
                        requestAnimationFrame(updateCounter);
                    }
                }

                requestAnimationFrame(updateCounter);
                observer.unobserve(counter);
            }
        });
    }, { threshold: 0.5 });

    $$('.stat-num').forEach(counter => observer.observe(counter));
}

// ===== Header Scroll Effect =====
function initHeaderScroll() {


    window.addEventListener('scroll', () => {
        const header = $('#main-header');
        const scrollY = window.scrollY;

        if (scrollY > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }

        // Back to top button
        const backToTop = $('#back-to-top');
        if (scrollY > 600) {
            backToTop.classList.add('visible');
        } else {
            backToTop.classList.remove('visible');
        }

        // Active nav link
        const sections = $$('section[id]');
        sections.forEach(section => {
            const top = section.offsetTop - 150;
            const height = section.offsetHeight;
            const id = section.getAttribute('id');
            const link = $(`.nav-link[href="#${id}"]`);

            if (link) {
                if (scrollY >= top && scrollY < top + height) {
                    $$('.nav-link').forEach(l => l.classList.remove('active'));
                    link.classList.add('active');
                }
            }
        });


    });
}

// ===== Mobile Menu =====
function initMobileMenu() {
    const menuBtn = $('#mobile-menu-btn');
    const navLinks = $('#nav-links');

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'mobile-nav-overlay';
    document.body.appendChild(overlay);

    function toggleMenu() {
        menuBtn.classList.toggle('active');
        navLinks.classList.toggle('active');
        overlay.classList.toggle('active');
        document.body.style.overflow = navLinks.classList.contains('active') ? 'hidden' : '';
    }

    function closeMenu() {
        menuBtn.classList.remove('active');
        navLinks.classList.remove('active');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    menuBtn.addEventListener('click', toggleMenu);
    overlay.addEventListener('click', closeMenu);

    // Close menu on nav link click
    $$('.nav-link').forEach(link => {
        link.addEventListener('click', closeMenu);
    });
}

// ===== Filter Logic =====
function initFilters() {
    $$('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const filter = btn.dataset.filter;
            currentFilter = filter;

            let filtered;
            if (filter === 'all') {
                filtered = allProducts;
            } else {
                filtered = allProducts.filter(p => getProductCategory(p) === filter);
            }
            renderProducts(filtered, true);
        });
    });

    // Footer filter links
    $$('[data-filter-link]').forEach(link => {
        link.addEventListener('click', (e) => {
            const filterLink = link.dataset.filterLink;
            // Activate the corresponding filter button
            setTimeout(() => {
                $$('.filter-btn').forEach(b => b.classList.remove('active'));
                const targetBtn = $(`.filter-btn[data-filter="${filterLink}"]`);
                if (targetBtn) {
                    targetBtn.classList.add('active');
                    const filtered = allProducts.filter(p => getProductCategory(p) === filterLink);
                    renderProducts(filtered, true);
                }
            }, 500);
        });
    });
}

// ===== Event Listeners =====
function initEventListeners() {
    // Cart toggle
    $('#cart-toggle').addEventListener('click', openCart);
    $('#cart-close').addEventListener('click', closeCart);
    $('#cart-overlay').addEventListener('click', closeCart);

    // Checkout
    $('#btn-checkout').addEventListener('click', goToCheckoutPage);

    // Show more products
    const showMoreBtn = $('#btn-show-more');
    if (showMoreBtn) showMoreBtn.addEventListener('click', showMoreProducts);
    $('#btn-clear-cart').addEventListener('click', () => {
        if (confirm('هل أنت متأكد من تفريغ السلة؟')) {
            clearCart();
        }
    });

    const discountInput = $("#discount-code-input");
    const discountApplyBtn = $("#discount-apply-btn");
    const discountRemoveBtn = $("#discount-remove-btn");
    const discountToggleBtn = $("#discount-toggle-btn");

    discountInput.addEventListener("input", handleDiscountInput);
    discountInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            applyDiscountCode();
        }
    });
    discountApplyBtn.addEventListener("click", applyDiscountCode);
    discountRemoveBtn.addEventListener("click", removeDiscountCode);
    discountToggleBtn.addEventListener("click", toggleDiscountSection);
    window.addEventListener("resize", () => syncDiscountCollapseState());

    // Product modal
    $('#modal-close').addEventListener('click', closeProductModal);
    $('#product-modal-overlay').addEventListener('click', closeProductModal);

    // Size selection
    $$('.size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.size-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedSize = btn.dataset.size;
        });
    });

    // Quantity
    $('#qty-minus').addEventListener('click', () => {
        if (selectedQty > 1) {
            selectedQty--;
            $('#qty-value').textContent = selectedQty;
        }
    });

    $('#qty-plus').addEventListener('click', () => {
        if (selectedQty < 10) {
            selectedQty++;
            $('#qty-value').textContent = selectedQty;
        }
    });

    // Add to cart from modal
    $('#modal-add-to-cart').addEventListener('click', () => {
        if (selectedProduct) {
            addToCart(selectedProduct, selectedSize, selectedQty);
            closeProductModal();
        }
    });

    // Back to top
    $('#back-to-top').addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeProductModal();
            closeCart();
        }
    });

    // Smooth scroll for any in-page anchor (delegated, so dynamically added
    // links work too). Wait for the mobile menu's body-overflow lock to be
    // released before measuring/scrolling — otherwise mobile browsers compute
    // against a stale layout and the scroll silently no-ops.
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href^="#"]');
        if (!link) return;
        const targetId = link.getAttribute('href');
        if (!targetId || targetId === '#') return;
        const target = document.querySelector(targetId);
        if (!target) return;
        e.preventDefault();
        const doScroll = () => target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // If the body is currently scroll-locked by the open mobile menu,
        // wait until the lock is released before scrolling.
        if (document.body.style.overflow === 'hidden') {
            requestAnimationFrame(() => requestAnimationFrame(doScroll));
        } else {
            doScroll();
        }
    });
}

// ===== Page Loader =====
function hideLoader() {
    setTimeout(() => {
        const loader = $('#page-loader');
        loader.classList.add('hidden');
        setTimeout(() => loader.remove(), 600);
    }, 1800);
}

// ===== Initialize =====
// ===== Search =====
const SEARCH_RECENT_KEY = 'hr_recent_searches';
const SEARCH_MAX_RECENT = 5;
const SEARCH_MAX_RESULTS = 8;
const SEARCH_SUGGESTIONS = ['Dior', 'Chanel', 'Tom Ford', 'Versace', 'Creed', 'YSL'];

function getRecentSearches() {
    try {
        const arr = JSON.parse(localStorage.getItem(SEARCH_RECENT_KEY));
        return Array.isArray(arr) ? arr.slice(0, SEARCH_MAX_RECENT) : [];
    } catch {
        return [];
    }
}

function pushRecentSearch(term) {
    const clean = String(term || '').trim();
    if (!clean) return;
    const current = getRecentSearches().filter(t => t.toLowerCase() !== clean.toLowerCase());
    current.unshift(clean);
    localStorage.setItem(SEARCH_RECENT_KEY, JSON.stringify(current.slice(0, SEARCH_MAX_RECENT)));
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightMatch(text, query) {
    const safe = escapeHtml(text);
    if (!query) return safe;
    const re = new RegExp(`(${escapeRegExp(query)})`, 'ig');
    return safe.replace(re, '<mark>$1</mark>');
}

function productMatchesQuery(product, query) {
    const q = query.toLowerCase();
    const name = (product.name || '').toLowerCase();
    const gender = (product.gender || '').toLowerCase();
    return name.includes(q) || gender.includes(q);
}

function initSearch() {
    const overlay = $('#search-overlay');
    const backdrop = $('#search-backdrop');
    const closeBtn = $('#search-close');
    const toggleBtn = $('#search-toggle');
    const input = $('#search-input');
    const clearBtn = $('#search-clear');
    const resultsEl = $('#search-results');
    const emptyEl = $('#search-state-empty');
    const noResultsEl = $('#search-state-noresults');
    const recentChipsEl = $('#search-recent-chips');
    const noResultsChipsEl = $('#search-noresults-chips');

    if (!overlay || !toggleBtn || !input) return;

    let activeIndex = -1;
    let currentResults = [];
    let debounceTimer = null;

    function renderChips(container, items, iconClass) {
        container.innerHTML = '';
        if (!items.length) {
            container.innerHTML = `<span style="color:var(--text-muted);font-size:0.85rem;">لا توجد عناصر بعد</span>`;
            return;
        }
        items.forEach(term => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'search-chip';
            chip.innerHTML = `<i class="fas ${iconClass}"></i><span>${escapeHtml(term)}</span>`;
            chip.addEventListener('click', () => {
                input.value = term;
                input.focus();
                runSearch(term);
            });
            container.appendChild(chip);
        });
    }

    function renderEmptyState() {
        renderChips(recentChipsEl, getRecentSearches(), 'fa-clock-rotate-left');
        renderChips(noResultsChipsEl, SEARCH_SUGGESTIONS, 'fa-wand-magic-sparkles');
    }

    function setState(state) {
        emptyEl.hidden = state !== 'empty';
        emptyEl.style.display = state === 'empty' ? '' : 'none';

        noResultsEl.hidden = state !== 'noresults';
        noResultsEl.style.display = state === 'noresults' ? '' : 'none';

        resultsEl.hidden = state !== 'results';
        resultsEl.style.display = state === 'results' ? 'flex' : 'none';
    }

    function renderResults(products, query) {
        resultsEl.innerHTML = '';
        currentResults = products;
        activeIndex = -1;

        products.forEach((product, i) => {
            const price = getProductBottlePrice(product);
            const genderLabel = getGenderArabic(product.gender);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'search-result';
            btn.style.animationDelay = `${i * 0.04}s`;
            btn.dataset.index = i;
            btn.innerHTML = `
                <div class="search-result-thumb">
                    <img src="${escapeHtml(product.image_url || 'logo without background.png')}" alt="${escapeHtml(product.name)}" loading="lazy">
                </div>
                <div class="search-result-info">
                    <h4 class="search-result-name">${highlightMatch(product.name || '', query)}</h4>
                    <div class="search-result-meta">
                        <span>${escapeHtml(genderLabel)}</span>
                    </div>
                </div>
                <div class="search-result-price">${price} د.أ</div>
            `;
            btn.addEventListener('click', () => selectResult(i));
            btn.addEventListener('mouseenter', () => setActive(i));
            resultsEl.appendChild(btn);
        });
    }

    function setActive(index) {
        const items = resultsEl.querySelectorAll('.search-result');
        items.forEach(el => el.classList.remove('active'));
        if (index >= 0 && index < items.length) {
            items[index].classList.add('active');
            items[index].scrollIntoView({ block: 'nearest' });
            activeIndex = index;
        } else {
            activeIndex = -1;
        }
    }

    function selectResult(index) {
        const product = currentResults[index];
        if (!product) return;
        pushRecentSearch(input.value.trim() || product.name);
        closeSearch();
        setTimeout(() => openProductModal(product), 200);
    }

    function runSearch(rawQuery) {
        const query = rawQuery.trim();
        clearBtn.classList.toggle('visible', query.length > 0);

        if (!query) {
            setState('empty');
            renderEmptyState();
            currentResults = [];
            return;
        }

        const matches = (allProducts || [])
            .filter(p => productMatchesQuery(p, query))
            .slice(0, SEARCH_MAX_RESULTS);

        if (matches.length === 0) {
            setState('noresults');
            return;
        }

        setState('results');
        renderResults(matches, query);
    }

    function openSearch() {
        overlay.classList.add('active');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        setState('empty');
        renderEmptyState();
        setTimeout(() => input.focus(), 50);
    }

    function closeSearch() {
        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        input.value = '';
        clearBtn.classList.remove('visible');
        currentResults = [];
        activeIndex = -1;
    }

    // Wiring
    toggleBtn.addEventListener('click', openSearch);
    closeBtn.addEventListener('click', closeSearch);
    backdrop.addEventListener('click', closeSearch);

    clearBtn.addEventListener('click', () => {
        input.value = '';
        input.focus();
        runSearch('');
    });

    input.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        const value = e.target.value;
        debounceTimer = setTimeout(() => runSearch(value), 200);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!currentResults.length) return;
            setActive((activeIndex + 1) % currentResults.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (!currentResults.length) return;
            setActive(activeIndex <= 0 ? currentResults.length - 1 : activeIndex - 1);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeIndex >= 0) {
                selectResult(activeIndex);
            } else if (currentResults.length > 0) {
                selectResult(0);
            }
        } else if (e.key === 'Escape') {
            closeSearch();
        }
    });

    // Global keyboard shortcut: Ctrl/Cmd+K opens search
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            overlay.classList.contains('active') ? closeSearch() : openSearch();
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    hideLoader();
    fetchProducts();
    initSlider();
    initHeaderScroll();
    initMobileMenu();
    ensureNicheFilterUI();
    initFilters();
    initEventListeners();
    initSearch();
    updateCartUI();
    restoreSavedDiscountCode();


    // Delay scroll animations to after products load
    setTimeout(initScrollAnimations, 500);
    setTimeout(animateCounters, 500);
});
