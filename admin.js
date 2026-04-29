// ===== Config =====
const SUPABASE_URL = 'https://udwulegatrwkpwloevjz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rPSseT-GCVtok4XkaJ62Pg_qLWpwH-a';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
});

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const STATUS_LABELS = {
    new: 'جديد',
    confirmed: 'مؤكد',
    shipped: 'مُرسل',
    delivered: 'مُسلَّم',
    cancelled: 'ملغي'
};

const STATUS_FLOW = ['new', 'confirmed', 'shipped', 'delivered'];

// ===== State =====
let currentUser = null;
let allOrders = [];
let allCodes = [];
let allProducts = [];
let orderFilter = 'all';
let showCancelled = false;
let productFilter = 'all';
let activeSection = 'orders';

// ===== Toast =====
function toast(msg, kind = 'success') {
    const el = $('#toast');
    el.className = `toast is-${kind}`;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 3000);
}

function fmt(n) {
    return `${Number(n).toFixed(2)} د.أ`;
}

function timeAgo(iso) {
    const then = new Date(iso);
    const diff = (Date.now() - then.getTime()) / 1000;
    if (diff < 60) return 'الآن';
    if (diff < 3600) return `منذ ${Math.floor(diff / 60)} د`;
    if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} س`;
    if (diff < 604800) return `منذ ${Math.floor(diff / 86400)} يوم`;
    return then.toLocaleDateString('ar-JO', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('ar-JO', { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// ===== Auth =====
let authMode = 'login'; // 'login' | 'signup'

function setAuthMode(mode) {
    authMode = mode;
    $('#auth-subtitle').textContent = mode === 'signup' ? 'أنشئ حسابك للمتابعة' : 'سجل الدخول للمتابعة';
    $('#auth-submit-label').textContent = mode === 'signup' ? 'إنشاء حساب' : 'دخول';
    $('#auth-toggle-mode').textContent = mode === 'signup' ? 'لدي حساب — تسجيل الدخول' : 'إنشاء حساب جديد';
    $('#auth-password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    hideAuthMessages();
}

function showAuthError(msg) {
    const el = $('#auth-error');
    el.textContent = msg;
    el.hidden = false;
    $('#auth-info').hidden = true;
}

function showAuthInfo(msg) {
    const el = $('#auth-info');
    el.textContent = msg;
    el.hidden = false;
    $('#auth-error').hidden = true;
}

function hideAuthMessages() {
    $('#auth-error').hidden = true;
    $('#auth-info').hidden = true;
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    hideAuthMessages();
    const email = $('#auth-email').value.trim().toLowerCase();
    const password = $('#auth-password').value;
    const submitBtn = $('#auth-submit');
    submitBtn.disabled = true;

    try {
        if (authMode === 'signup') {
            const { error } = await supabase.auth.signUp({ email, password });
            if (error) throw error;
            showAuthInfo('تم إنشاء الحساب. تحقق من بريدك للتفعيل ثم سجل الدخول.');
            setAuthMode('login');
        } else {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            // onAuthStateChange will pick it up
        }
    } catch (err) {
        showAuthError(translateAuthError(err));
    } finally {
        submitBtn.disabled = false;
    }
}

async function handleForgotPassword() {
    const email = $('#auth-email').value.trim().toLowerCase();
    if (!email) { showAuthError('أدخل البريد الإلكتروني أولاً'); return; }
    hideAuthMessages();
    try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + window.location.pathname
        });
        if (error) throw error;
        showAuthInfo('أُرسل رابط إعادة تعيين كلمة السر إلى بريدك.');
    } catch (err) {
        showAuthError(translateAuthError(err));
    }
}

function translateAuthError(err) {
    const m = (err?.message || '').toLowerCase();
    if (m.includes('invalid login') || m.includes('invalid_credentials')) return 'بيانات الدخول غير صحيحة';
    if (m.includes('user already registered')) return 'هذا البريد مسجّل مسبقاً';
    if (m.includes('email not confirmed')) return 'البريد لم يُفعّل بعد. تحقق من رسائل التفعيل.';
    if (m.includes('password')) return 'كلمة السر غير صالحة (الحد الأدنى 6 أحرف)';
    return err?.message || 'حدث خطأ — حاول مرة أخرى';
}

async function handleSignOut() {
    await supabase.auth.signOut();
}

async function checkIsAdmin() {
    const { data, error } = await supabase.rpc('is_admin');
    if (error) {
        console.error('is_admin check failed:', error);
        return false;
    }
    return Boolean(data);
}

async function onSessionResolved(session) {
    if (!session) {
        showLoginScreen();
        return;
    }
    const isAdmin = await checkIsAdmin();
    if (!isAdmin) {
        await supabase.auth.signOut();
        showLoginScreen();
        showAuthError('هذا الحساب غير مخوّل للوصول للوحة الإدارة');
        return;
    }
    currentUser = session.user;
    showAdminApp();
}

function showLoginScreen() {
    $('#login-screen').hidden = false;
    $('#admin-app').hidden = true;
}

function showAdminApp() {
    $('#login-screen').hidden = true;
    $('#admin-app').hidden = false;
    $('#admin-user-email').textContent = currentUser.email;
    loadAll();
}

// ===== Section switching =====
function switchSection(section) {
    activeSection = section;
    $$('.admin-section').forEach((s) => { s.hidden = s.id !== `section-${section}`; });
    $$('.bottom-nav .tab').forEach((t) => t.classList.toggle('active', t.dataset.section === section));
}

// ===== Drawer =====
function openDrawer(title, bodyHtml) {
    $('#drawer-title').textContent = title;
    $('#drawer-body').innerHTML = bodyHtml;
    $('#drawer').hidden = false;
    $('#drawer-overlay').hidden = false;
    document.body.style.overflow = 'hidden';
}

function closeDrawer() {
    $('#drawer').hidden = true;
    $('#drawer-overlay').hidden = true;
    document.body.style.overflow = '';
}

// ===== Orders =====
async function loadOrders() {
    const list = $('#orders-list');
    list.innerHTML = '<div class="list-empty">جارٍ التحميل...</div>';
    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
    if (error) {
        list.innerHTML = `<div class="list-error">فشل تحميل الطلبات: ${escapeHtml(error.message)}</div>`;
        return;
    }
    allOrders = data || [];
    renderOrders();
}

function renderOrders() {
    const list = $('#orders-list');
    const counts = { all: 0, new: 0, confirmed: 0, shipped: 0, delivered: 0, cancelled: 0 };
    for (const o of allOrders) {
        if (o.status !== 'cancelled') counts.all++;
        counts[o.status] = (counts[o.status] || 0) + 1;
    }
    $$('.chip-count').forEach((el) => {
        const k = el.dataset.count;
        el.textContent = counts[k] ?? 0;
    });
    const newBadge = $('#tab-badge-orders');
    if (counts.new > 0) {
        newBadge.textContent = counts.new;
        newBadge.hidden = false;
    } else {
        newBadge.hidden = true;
    }

    const filtered = allOrders.filter((o) => {
        if (o.status === 'cancelled' && !showCancelled) return false;
        if (orderFilter === 'all') return o.status !== 'cancelled' || showCancelled;
        return o.status === orderFilter;
    });

    if (filtered.length === 0) {
        list.innerHTML = '<div class="list-empty">لا توجد طلبات لعرضها.</div>';
        return;
    }

    list.innerHTML = filtered.map((o) => `
        <div class="order-row ${o.status === 'cancelled' ? 'is-cancelled' : ''}" data-id="${escapeHtml(o.order_number)}">
            <div class="o-name">${escapeHtml(o.first_name)} ${escapeHtml(o.last_name)}</div>
            <div class="o-total">${fmt(o.total)}</div>
            <div class="o-meta">
                <span><i class="fas fa-hashtag"></i> ${escapeHtml(o.order_number)}</span>
                <span>·</span>
                <span>${escapeHtml(timeAgo(o.created_at))}</span>
            </div>
            <div class="o-status">
                <span class="status-badge s-${o.status}">${STATUS_LABELS[o.status] || o.status}</span>
            </div>
        </div>
    `).join('');

    list.querySelectorAll('.order-row').forEach((row) => {
        row.addEventListener('click', () => openOrderDetail(row.dataset.id));
    });
}

function openOrderDetail(orderNumber) {
    const o = allOrders.find((x) => x.order_number === orderNumber);
    if (!o) return;

    const items = Array.isArray(o.items) ? o.items : [];
    const itemsHtml = items.map((it) => `
        <div class="detail-item">
            <img src="${escapeHtml(it.image || 'logo without background.png')}" alt="">
            <div>
                <div class="di-name">${escapeHtml(it.name)}</div>
                <div class="di-meta">${escapeHtml(it.size)} × ${it.qty}</div>
            </div>
            <div class="di-price">${fmt((Number(it.price) || 0) * it.qty)}</div>
        </div>
    `).join('');

    const wMessage = encodeURIComponent(
        `مرحباً ${o.first_name}،\nبخصوص طلبك ${o.order_number} من H&R Perfume...`
    );
    const phoneClean = String(o.phone || '').replace(/\D/g, '');
    const waPhone = phoneClean.startsWith('0') ? '962' + phoneClean.slice(1) : phoneClean;

    const statusButtonsHtml = STATUS_FLOW.map((s) => {
        const isCurrent = o.status === s;
        const isPast = STATUS_FLOW.indexOf(o.status) > STATUS_FLOW.indexOf(s);
        return `<button data-status="${s}" ${isCurrent ? 'class="is-current" disabled' : ''} ${isPast ? 'disabled' : ''}>
            ${isCurrent ? '<i class="fas fa-check"></i>' : ''} ${STATUS_LABELS[s]}
        </button>`;
    }).join('') + (o.status !== 'cancelled' ? `
        <button class="cancel-action" data-status="cancelled"><i class="fas fa-times"></i> إلغاء الطلب</button>
    ` : `<button class="is-current cancel-action" disabled>الطلب ملغي</button>`);

    const html = `
        <div class="detail-block">
            <h4>الحالة</h4>
            <div class="status-actions" id="status-actions">${statusButtonsHtml}</div>
        </div>

        <div class="detail-block">
            <h4>العميل</h4>
            <div class="detail-row"><span class="label">الاسم</span><span class="value">${escapeHtml(o.first_name)} ${escapeHtml(o.last_name)}</span></div>
            <div class="detail-row"><span class="label">الهاتف</span><span class="value">
                <a href="tel:${escapeHtml(o.phone)}" style="color:var(--gold-primary);">${escapeHtml(o.phone)}</a>
            </span></div>
            <div class="detail-row"><span class="label">المحافظة</span><span class="value">${escapeHtml(o.governorate)}</span></div>
            <div class="detail-row"><span class="label">العنوان</span><span class="value">${escapeHtml(o.address)}</span></div>
            ${o.notes ? `<div class="detail-row"><span class="label">ملاحظات</span><span class="value">${escapeHtml(o.notes)}</span></div>` : ''}
        </div>

        <div class="detail-block">
            <h4>المنتجات</h4>
            <div class="detail-items">${itemsHtml}</div>
        </div>

        <div class="detail-block">
            <h4>المجموع</h4>
            <div class="detail-row"><span class="label">المجموع الفرعي</span><span class="value">${fmt(o.subtotal)}</span></div>
            ${o.discount_code ? `<div class="detail-row"><span class="label">خصم (${escapeHtml(o.discount_code)})</span><span class="value">-${fmt(o.discount_amount)}</span></div>` : ''}
            <div class="detail-row"><span class="label">التوصيل</span><span class="value">${o.shipping > 0 ? fmt(o.shipping) : 'مجاني'}</span></div>
            <div class="detail-row"><span class="label" style="font-weight:700;">المجموع النهائي</span><span class="value" style="color:var(--gold-primary);font-weight:700;font-size:1.1rem;">${fmt(o.total)}</span></div>
        </div>

        <div class="detail-block">
            <h4>التواصل</h4>
            <div class="detail-actions">
                <a class="btn-secondary" href="https://wa.me/${waPhone}?text=${wMessage}" target="_blank">
                    <i class="fab fa-whatsapp"></i> فتح واتساب
                </a>
                <a class="btn-secondary" href="tel:${escapeHtml(o.phone)}">
                    <i class="fas fa-phone"></i> اتصال
                </a>
            </div>
        </div>

        <div class="detail-block">
            <h4>الميتا</h4>
            <div class="detail-row"><span class="label">رقم الطلب</span><span class="value">${escapeHtml(o.order_number)}</span></div>
            <div class="detail-row"><span class="label">التاريخ</span><span class="value">${fmtDate(o.created_at)}</span></div>
        </div>

        <div class="detail-actions">
            <button class="btn-danger" id="order-delete">
                <i class="fas fa-trash"></i> حذف الطلب نهائياً
            </button>
        </div>
    `;

    openDrawer(`طلب ${o.order_number}`, html);

    $('#status-actions').addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-status]');
        if (!btn || btn.disabled) return;
        await updateOrderStatus(o.order_number, btn.dataset.status);
    });

    $('#order-delete').addEventListener('click', async () => {
        if (!confirm('هل أنت متأكد من حذف هذا الطلب نهائياً؟ لا يمكن التراجع.')) return;
        await deleteOrder(o.order_number);
    });
}

async function updateOrderStatus(orderNumber, status) {
    const { error } = await supabase.from('orders').update({ status }).eq('order_number', orderNumber);
    if (error) { toast('فشل التحديث: ' + error.message, 'error'); return; }
    toast('تم تحديث الحالة');
    closeDrawer();
    await loadOrders();
}

async function deleteOrder(orderNumber) {
    const { error } = await supabase.from('orders').delete().eq('order_number', orderNumber);
    if (error) { toast('فشل الحذف: ' + error.message, 'error'); return; }
    toast('تم حذف الطلب');
    closeDrawer();
    await loadOrders();
}

// ===== Discount codes =====
async function loadCodes() {
    const list = $('#codes-list');
    list.innerHTML = '<div class="list-empty">جارٍ التحميل...</div>';
    const { data, error } = await supabase
        .from('discount_codes')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) {
        list.innerHTML = `<div class="list-error">فشل التحميل: ${escapeHtml(error.message)}</div>`;
        return;
    }
    allCodes = data || [];
    renderCodes();
}

function renderCodes() {
    const list = $('#codes-list');
    if (allCodes.length === 0) {
        list.innerHTML = '<div class="list-empty">لا توجد أكواد. اضغط "كود جديد" لإضافة كود.</div>';
        return;
    }
    list.innerHTML = allCodes.map((c) => {
        const valueText = c.type === 'percentage' ? `${c.value}%` : fmt(c.value);
        const meta = [];
        if (c.expires_at) meta.push(`ينتهي ${fmtDate(c.expires_at)}`);
        if (c.min_order_total) meta.push(`حد أدنى ${fmt(c.min_order_total)}`);
        if (c.max_uses != null) meta.push(`${c.current_uses}/${c.max_uses} استخدامات`);
        else meta.push(`${c.current_uses} استخدامات`);
        return `
            <div class="code-row ${c.is_active ? '' : 'is-inactive'}" data-code="${escapeHtml(c.code)}">
                <div class="c-code">${escapeHtml(c.code)}</div>
                <div class="c-value">${valueText}</div>
                <div class="toggle-switch ${c.is_active ? 'on' : ''}" data-toggle="${escapeHtml(c.code)}"></div>
                <div class="c-meta">${meta.map((m) => `<span>${escapeHtml(m)}</span>`).join(' · ')}</div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('.code-row').forEach((row) => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('.toggle-switch')) return;
            openCodeEditor(row.dataset.code);
        });
    });
    list.querySelectorAll('[data-toggle]').forEach((el) => {
        el.addEventListener('click', async (e) => {
            e.stopPropagation();
            await toggleCode(el.dataset.toggle);
        });
    });
}

async function toggleCode(code) {
    const c = allCodes.find((x) => x.code === code);
    if (!c) return;
    const { error } = await supabase.from('discount_codes').update({ is_active: !c.is_active }).eq('code', code);
    if (error) { toast('فشل التحديث: ' + error.message, 'error'); return; }
    toast(c.is_active ? 'تم تعطيل الكود' : 'تم تفعيل الكود');
    await loadCodes();
}

function openCodeEditor(existingCode = null) {
    const c = existingCode ? allCodes.find((x) => x.code === existingCode) : null;
    const isEdit = !!c;

    const html = `
        <form class="form-grid" id="code-form">
            <div class="form-field">
                <label>الكود *</label>
                <input type="text" name="code" required maxlength="40" pattern="[A-Z0-9_-]+" style="text-transform:uppercase;font-family:monospace;letter-spacing:1px;" value="${c ? escapeHtml(c.code) : ''}" ${isEdit ? 'readonly' : ''}>
                <span class="hint">أحرف إنجليزية كبيرة وأرقام فقط (HR20)</span>
            </div>
            <div class="form-row">
                <div class="form-field">
                    <label>النوع *</label>
                    <select name="type" required>
                        <option value="percentage" ${c?.type === 'percentage' ? 'selected' : ''}>نسبة (%)</option>
                        <option value="fixed" ${c?.type === 'fixed' ? 'selected' : ''}>قيمة ثابتة (د.أ)</option>
                    </select>
                </div>
                <div class="form-field">
                    <label>القيمة *</label>
                    <input type="number" name="value" required min="0.01" step="0.01" value="${c?.value ?? ''}">
                </div>
            </div>
            <div class="form-field">
                <label>تاريخ انتهاء (اختياري)</label>
                <input type="datetime-local" name="expires_at" value="${c?.expires_at ? new Date(c.expires_at).toISOString().slice(0, 16) : ''}">
                <span class="hint">اتركه فارغاً للأكواد بدون انتهاء</span>
            </div>
            <div class="form-row">
                <div class="form-field">
                    <label>حد أدنى للطلب (د.أ)</label>
                    <input type="number" name="min_order_total" min="0" step="0.01" value="${c?.min_order_total ?? ''}" placeholder="بدون حد">
                </div>
                <div class="form-field">
                    <label>الحد الأقصى للاستخدام</label>
                    <input type="number" name="max_uses" min="1" step="1" value="${c?.max_uses ?? ''}" placeholder="غير محدود">
                </div>
            </div>
            <label class="form-toggle" id="code-active-toggle">
                <span class="ft-label">الكود مفعّل</span>
                <span class="toggle-switch ${c == null || c.is_active ? 'on' : ''}"></span>
                <input type="checkbox" name="is_active" ${c == null || c.is_active ? 'checked' : ''} hidden>
            </label>
            <div class="form-actions">
                ${isEdit ? '<button type="button" class="btn-danger" id="code-delete"><i class="fas fa-trash"></i> حذف</button>' : ''}
                <button type="submit" class="btn-primary"><i class="fas fa-check"></i> ${isEdit ? 'حفظ' : 'إنشاء'}</button>
            </div>
        </form>
    `;

    openDrawer(isEdit ? `تعديل ${c.code}` : 'كود خصم جديد', html);

    const toggle = $('#code-active-toggle');
    toggle.addEventListener('click', (e) => {
        e.preventDefault();
        const cb = toggle.querySelector('input[name="is_active"]');
        const sw = toggle.querySelector('.toggle-switch');
        cb.checked = !cb.checked;
        sw.classList.toggle('on', cb.checked);
    });

    $('#code-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const payload = {
            code: String(fd.get('code') || '').trim().toUpperCase(),
            type: fd.get('type'),
            value: Number(fd.get('value')),
            expires_at: fd.get('expires_at') ? new Date(fd.get('expires_at')).toISOString() : null,
            min_order_total: fd.get('min_order_total') ? Number(fd.get('min_order_total')) : null,
            max_uses: fd.get('max_uses') ? parseInt(fd.get('max_uses'), 10) : null,
            is_active: $('#code-active-toggle input[name="is_active"]').checked
        };
        if (!payload.code || !payload.value) { toast('املأ الحقول المطلوبة', 'error'); return; }

        let error;
        if (isEdit) {
            ({ error } = await supabase.from('discount_codes').update(payload).eq('code', existingCode));
        } else {
            ({ error } = await supabase.from('discount_codes').insert(payload));
        }
        if (error) { toast('فشل الحفظ: ' + error.message, 'error'); return; }
        toast(isEdit ? 'تم الحفظ' : 'تم إنشاء الكود');
        closeDrawer();
        await loadCodes();
    });

    if (isEdit) {
        $('#code-delete').addEventListener('click', async () => {
            if (!confirm(`حذف الكود "${c.code}" نهائياً؟`)) return;
            const { error } = await supabase.from('discount_codes').delete().eq('code', c.code);
            if (error) { toast('فشل الحذف: ' + error.message, 'error'); return; }
            toast('تم الحذف');
            closeDrawer();
            await loadCodes();
        });
    }
}

// ===== Products =====
async function loadProducts() {
    const list = $('#products-list');
    list.innerHTML = '<div class="list-empty">جارٍ التحميل...</div>';
    const { data, error } = await supabase
        .from('perfumes')
        .select('*')
        .order('ID', { ascending: true });
    if (error) {
        list.innerHTML = `<div class="list-error">فشل التحميل: ${escapeHtml(error.message)}</div>`;
        return;
    }
    allProducts = data || [];
    renderProducts();
}

function productCategory(p) {
    if (p.niche) return 'niche';
    return p.gender || '';
}

function renderProducts() {
    const list = $('#products-list');
    const filtered = allProducts.filter((p) => {
        if (productFilter === 'all') return true;
        return productCategory(p) === productFilter;
    });

    if (filtered.length === 0) {
        list.innerHTML = '<div class="list-empty">لا توجد منتجات.</div>';
        return;
    }

    list.innerHTML = filtered.map((p) => {
        const price = p.niche ? 20 : (p.price_100ml || 0);
        const cat = p.niche ? 'نيش' : (p.gender === 'Him' ? 'رجالي' : p.gender === 'Her' ? 'نسائي' : p.gender === 'Unisex' ? 'للجنسين' : '');
        return `
            <div class="product-row ${p.available === false ? 'is-unavailable' : ''}" data-id="${p.ID}">
                <img src="${escapeHtml(p.image_url || 'logo without background.png')}" alt="">
                <div>
                    <div class="p-name">${escapeHtml(p.name)}</div>
                    <div class="p-meta">
                        <span>${escapeHtml(p.brand || '')}</span>
                        ${cat ? `<span>·</span><span>${cat}</span>` : ''}
                        ${p.is_best_seller ? '<span>·</span><span style="color:var(--gold-primary);"><i class="fas fa-fire"></i> الأكثر مبيعاً</span>' : ''}
                    </div>
                </div>
                <div class="p-price">${fmt(price)}</div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('.product-row').forEach((row) => {
        row.addEventListener('click', () => openProductEditor(Number(row.dataset.id)));
    });
}

function openProductEditor(existingId = null) {
    const p = existingId != null ? allProducts.find((x) => Number(x.ID) === existingId) : null;
    const isEdit = !!p;

    const html = `
        <form class="form-grid" id="product-form">
            <div class="form-field">
                <label>الاسم *</label>
                <input type="text" name="name" required maxlength="200" value="${p ? escapeHtml(p.name) : ''}">
            </div>
            <div class="form-field">
                <label>البراند</label>
                <input type="text" name="brand" maxlength="100" value="${p ? escapeHtml(p.brand || '') : ''}">
            </div>
            <div class="form-row">
                <div class="form-field">
                    <label>الجنس</label>
                    <select name="gender">
                        <option value="">— غير محدد —</option>
                        <option value="Him" ${p?.gender === 'Him' ? 'selected' : ''}>رجالي</option>
                        <option value="Her" ${p?.gender === 'Her' ? 'selected' : ''}>نسائي</option>
                        <option value="Unisex" ${p?.gender === 'Unisex' ? 'selected' : ''}>للجنسين</option>
                    </select>
                </div>
                <div class="form-field">
                    <label>سعر 100مل</label>
                    <input type="number" name="price_100ml" min="0" step="0.01" value="${p?.price_100ml ?? ''}">
                    <span class="hint">سعر النيش ثابت 20 د.أ</span>
                </div>
            </div>
            <div class="form-field">
                <label>سعر 30مل (اختياري)</label>
                <input type="number" name="price_30ml" min="0" step="0.01" value="${p?.price_30ml ?? ''}">
            </div>
            <div class="form-field">
                <label>رابط الصورة</label>
                <input type="url" name="image_url" value="${p ? escapeHtml(p.image_url || '') : ''}" placeholder="https://...">
            </div>
            <label class="form-toggle">
                <span class="ft-label">متوفر للبيع</span>
                <span class="toggle-switch ${p == null || p.available !== false ? 'on' : ''}"></span>
                <input type="checkbox" name="available" ${p == null || p.available !== false ? 'checked' : ''} hidden>
            </label>
            <label class="form-toggle">
                <span class="ft-label">الأكثر مبيعاً</span>
                <span class="toggle-switch ${p?.is_best_seller ? 'on' : ''}"></span>
                <input type="checkbox" name="is_best_seller" ${p?.is_best_seller ? 'checked' : ''} hidden>
            </label>
            <label class="form-toggle">
                <span class="ft-label">عطر نيش (سعر ثابت 20 د.أ)</span>
                <span class="toggle-switch ${p?.niche ? 'on' : ''}"></span>
                <input type="checkbox" name="niche" ${p?.niche ? 'checked' : ''} hidden>
            </label>
            <div class="form-actions">
                ${isEdit ? '<button type="button" class="btn-danger" id="product-delete"><i class="fas fa-trash"></i> حذف</button>' : ''}
                <button type="submit" class="btn-primary"><i class="fas fa-check"></i> ${isEdit ? 'حفظ' : 'إنشاء'}</button>
            </div>
        </form>
    `;

    openDrawer(isEdit ? `تعديل ${p.name}` : 'منتج جديد', html);

    // Wire toggles
    $('#product-form').querySelectorAll('.form-toggle').forEach((t) => {
        t.addEventListener('click', (e) => {
            e.preventDefault();
            const cb = t.querySelector('input[type="checkbox"]');
            const sw = t.querySelector('.toggle-switch');
            cb.checked = !cb.checked;
            sw.classList.toggle('on', cb.checked);
        });
    });

    $('#product-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const payload = {
            name: String(fd.get('name') || '').trim(),
            brand: String(fd.get('brand') || '').trim() || null,
            gender: fd.get('gender') || null,
            price_100ml: fd.get('price_100ml') ? Number(fd.get('price_100ml')) : null,
            price_30ml: fd.get('price_30ml') ? Number(fd.get('price_30ml')) : null,
            image_url: String(fd.get('image_url') || '').trim() || null,
            available: $('#product-form input[name="available"]').checked,
            is_best_seller: $('#product-form input[name="is_best_seller"]').checked,
            niche: $('#product-form input[name="niche"]').checked
        };
        if (!payload.name) { toast('الاسم مطلوب', 'error'); return; }

        let error;
        if (isEdit) {
            ({ error } = await supabase.from('perfumes').update(payload).eq('ID', p.ID));
        } else {
            ({ error } = await supabase.from('perfumes').insert(payload));
        }
        if (error) { toast('فشل الحفظ: ' + error.message, 'error'); return; }
        toast(isEdit ? 'تم الحفظ' : 'تم إنشاء المنتج');
        closeDrawer();
        await loadProducts();
    });

    if (isEdit) {
        $('#product-delete').addEventListener('click', async () => {
            if (!confirm(`حذف "${p.name}" نهائياً؟`)) return;
            const { error } = await supabase.from('perfumes').delete().eq('ID', p.ID);
            if (error) { toast('فشل الحذف: ' + error.message, 'error'); return; }
            toast('تم الحذف');
            closeDrawer();
            await loadProducts();
        });
    }
}

// ===== Initial load =====
async function loadAll() {
    await Promise.all([loadOrders(), loadCodes(), loadProducts()]);
}

// ===== Wire up =====
function wireUp() {
    // Auth
    $('#auth-form').addEventListener('submit', handleAuthSubmit);
    $('#auth-toggle-mode').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'signup' : 'login'));
    $('#auth-forgot').addEventListener('click', handleForgotPassword);
    $('#admin-signout').addEventListener('click', handleSignOut);

    // Tabs
    $$('.bottom-nav .tab').forEach((t) => {
        t.addEventListener('click', () => switchSection(t.dataset.section));
    });

    // Order filters
    $$('#orders-filters .chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            $$('#orders-filters .chip').forEach((c) => c.classList.remove('active'));
            chip.classList.add('active');
            orderFilter = chip.dataset.filter;
            renderOrders();
        });
    });
    $('#orders-show-cancelled').addEventListener('change', (e) => {
        showCancelled = e.target.checked;
        renderOrders();
    });
    $('#orders-refresh').addEventListener('click', async () => {
        $('#orders-refresh').classList.add('spinning');
        await loadOrders();
        $('#orders-refresh').classList.remove('spinning');
    });

    // Codes
    $('#codes-add').addEventListener('click', () => openCodeEditor());

    // Products
    $('#products-add').addEventListener('click', () => openProductEditor());
    $$('#products-filters .chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            $$('#products-filters .chip').forEach((c) => c.classList.remove('active'));
            chip.classList.add('active');
            productFilter = chip.dataset.filter;
            renderProducts();
        });
    });

    // Drawer
    $('#drawer-close').addEventListener('click', closeDrawer);
    $('#drawer-overlay').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer();
    });
}

// ===== Boot =====
async function boot() {
    wireUp();
    setAuthMode('login');

    const { data: { session } } = await supabase.auth.getSession();
    await onSessionResolved(session);

    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
            currentUser = null;
            allOrders = []; allCodes = []; allProducts = [];
            showLoginScreen();
        } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
            onSessionResolved(session);
        } else if (event === 'PASSWORD_RECOVERY') {
            showAuthInfo('أنت في وضع إعادة تعيين كلمة السر — اكتب كلمة سر جديدة وسجل الدخول.');
        }
    });
}

boot();
