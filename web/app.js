const API = '';
const tokenKey = 'colmena_saas_token';

const $ = (id) => document.getElementById(id);
const token = () => localStorage.getItem(tokenKey);
const authHeaders = () => token() ? { Authorization: `Bearer ${token()}` } : {};

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      ...authHeaders()
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data;
}

async function loadPlans(targetId = 'plans') {
  const box = $(targetId);
  if (!box) return;
  const data = await api('/api/public/plans');
  const copy = {
    BASIC: {
      badge: 'Entrada',
      pitch: 'Para servidores que quieren ordenar launcher, logs y Discord sin entrar todavia en operativa avanzada.',
      cta: 'Empezar Basic'
    },
    PREMIUM: {
      badge: 'Recomendado',
      pitch: 'El plan principal para servidores RedM/FiveM con launcher completo, bot, IA basica, logs avanzados y COLMENA-SS.',
      cta: 'Comprar Premium'
    },
    ENTERPRISE_DIAMOND: {
      badge: 'Profesional',
      pitch: 'Para comunidades, redes multi-servidor y clientes que necesitan auditoria, personalizacion y soporte prioritario.',
      cta: 'Solicitar Enterprise'
    }
  };

  const visiblePlans = Object.entries(data.plans).filter(([key]) => ['SCANER', 'MONTHLY_SERVER'].includes(key));
  box.innerHTML = visiblePlans.map(([key, plan]) => `
    <article class="card plan-card ${key === 'PREMIUM' ? 'featured' : ''}">
      <div class="badge">${copy[key]?.badge || plan.label}</div>
      <h3>${plan.label}</h3>
      <div class="price">${key === 'ENTERPRISE_DIAMOND' ? 'Desde ' : ''}${plan.priceMonthly}&euro;/mes</div>
      <p class="muted">${copy[key]?.pitch || ''}</p>
      <ul>
        ${Object.entries(plan.features).filter(([,v]) => v).slice(0, 8).map(([feature]) => `<li>${feature}</li>`).join('')}
      </ul>
      <button class="btn" onclick="checkout('${key}')">${copy[key]?.cta || 'Comprar'}</button>
    </article>
  `).join('');
}

async function loadSSPlans(targetId = 'ss-plans') {
  const box = $(targetId);
  if (!box) return;
  const data = await api('/api/public/colmena-ss-plans');
  const visiblePlans = Object.entries(data.plans).filter(([key]) => ['SCANER', 'MONTHLY_SERVER'].includes(key));
  box.innerHTML = visiblePlans.map(([key, plan]) => `
    <article class="card plan-card ${key === 'MONTHLY_SERVER' ? 'featured' : ''}">
      <div class="badge">${key === 'MONTHLY_SERVER' ? 'Recomendado' : 'Puntual'}</div>
      <h3>${plan.label}</h3>
      <div class="price">${plan.price}&euro;${plan.billing === 'monthly' ? '/mes' : ''}</div>
      <p class="muted">Rol Discord: ${plan.role}</p>
      <ul>${plan.features.map(feature => `<li>${feature}</li>`).join('')}</ul>
      <button class="btn" onclick="selectSSPlan('${key}')">Contratar</button>
    </article>
  `).join('');
}

function selectSSPlan(plan) {
  const input = $('ss-plan');
  if (input) input.value = plan;
  const form = $('ss-contract');
  if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function checkoutColmenaSS() {
  const result = $('ss-result');
  if (!token()) {
    if (result) result.textContent = 'Debes registrarte o iniciar sesión para contratar COLMENA-SS.';
    setTimeout(() => { location.href = '/registro?next=colmena-ss'; }, 900);
    return;
  }
  if (result) result.textContent = 'Preparando checkout...';
  try {
    const data = await api('/api/colmena-ss/order-checkout', {
      method: 'POST',
      body: JSON.stringify({
        plan: $('ss-plan').value,
        notes: $('ss-notes').value,
        profileUpdates: {
          fullName: $('ss-customer-name').value,
          discordUsername: $('ss-discord-username').value,
          discordId: $('ss-discord-id').value,
          serverName: $('ss-server-name').value,
          serverDiscordInvite: $('ss-server-invite').value,
          termsAccepted: $('ss-terms').checked,
          ssPolicyAccepted: $('ss-policy').checked
        }
      })
    });
    if (data.checkoutUrl && !data.simulated) {
      location.href = data.checkoutUrl;
      return;
    }
    const invite = data.discord?.invite?.invite_url || data.order?.invite_url || '';
    if (result) result.innerHTML = `Pedido activado. ${invite ? `<a href="${invite}">Entrar al Discord COLMENA-SS</a>` : 'La invitacion se generara cuando el bot este conectado.'}`;
  } catch (err) {
    if (result) result.textContent = err.message || err.code || 'No se pudo preparar el servicio COLMENA-SS.';
  }
}

async function checkout(plan) {
  if (!token()) {
    location.href = '/web/login.html';
    return;
  }
  const data = await api('/api/payments/checkout', {
    method: 'POST',
    body: JSON.stringify({ plan, mode: 'subscription' })
  });
  if (data.checkoutUrl) location.href = data.checkoutUrl;
}

async function register() {
  if ($('password-confirm') && $('password').value !== $('password-confirm').value) {
    alert('Las contrasenas no coinciden.');
    return;
  }
  const data = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      fullName: $('full-name').value,
      email: $('email').value,
      discordUsername: $('discord-username').value,
      discordId: $('discord-id').value,
      serverName: $('server-name').value,
      serverDiscordInvite: $('server-invite').value,
      password: $('password').value,
      company: $('server-name')?.value || '',
      termsAccepted: $('terms-accepted').checked,
      ssPolicyAccepted: $('ss-policy-accepted').checked
    })
  });
  localStorage.setItem(tokenKey, data.token);
  const params = new URLSearchParams(location.search);
  location.href = params.get('next') === 'colmena-ss' ? '/colmena-ss' : '/panel';
}

async function login() {
  const data = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: $('email').value, password: $('password').value })
  });
  localStorage.setItem(tokenKey, data.token);
  const params = new URLSearchParams(location.search);
  location.href = params.get('next') === 'colmena-ss' ? '/colmena-ss' : '/panel';
}

async function forgotPasswordWeb() {
  const result = $('forgot-result');
  if (result) result.textContent = 'Enviando solicitud...';
  try {
    const data = await api('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: $('forgot-email').value })
    });
    if (result) result.textContent = data.message || 'Si el email existe, recibirás instrucciones para recuperar tu contraseña.';
  } catch {
    if (result) result.textContent = 'Si el email existe, recibirás instrucciones para recuperar tu contraseña.';
  }
}

async function resetPasswordWeb() {
  const result = $('reset-result');
  const params = new URLSearchParams(location.search);
  const token = params.get('token') || '';
  const password = $('reset-password').value;
  const confirm = $('reset-password-confirm').value;
  if (password !== confirm) {
    if (result) result.textContent = 'Las contraseñas no coinciden.';
    return;
  }
  if (result) result.textContent = 'Actualizando contraseña...';
  try {
    const data = await api('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword: password })
    });
    if (result) result.textContent = data.message || 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.';
    setTimeout(() => { location.href = '/login'; }, 1200);
  } catch (err) {
    if (result) result.textContent = err.message || 'Token inválido o expirado.';
  }
}

async function loadPanel() {
  if (!token()) {
    location.href = '/login';
    return;
  }
  const data = await api('/api/panel/dashboard');
  $('panel-user').textContent = `${data.user.email}${data.user.discord_id ? ` · Discord ID ${data.user.discord_id}` : ''}`;
  renderAccountStatus(data);
  $('panel-revenue').textContent = `${data.revenue || 0} EUR`;
  $('panel-licenses').textContent = data.licenses?.length || 0;
  $('panel-scans').textContent = data.scans?.length || 0;
  renderSSPanel(data.ssServices);
  $('panel-json').textContent = JSON.stringify(data, null, 2);
}

async function loadSSPage() {
  await loadSSPlans();
  if (!token()) {
    const result = $('ss-result');
    if (result) result.textContent = 'Debes registrarte o iniciar sesión para contratar COLMENA-SS.';
    return;
  }
  try {
    const data = await api('/api/auth/me');
    const user = data.user;
    if ($('ss-customer-name')) $('ss-customer-name').value = user.full_name || '';
    if ($('ss-email')) $('ss-email').value = user.email || '';
    if ($('ss-discord-username')) $('ss-discord-username').value = user.discord_username || '';
    if ($('ss-discord-id')) $('ss-discord-id').value = user.discord_id || '';
    if ($('ss-server-name')) $('ss-server-name').value = user.server_name || '';
    if ($('ss-server-invite')) $('ss-server-invite').value = user.server_discord_invite || '';
    if ($('ss-terms')) $('ss-terms').checked = Boolean(user.terms_accepted);
    if ($('ss-policy')) $('ss-policy').checked = Boolean(user.ss_policy_accepted);
  } catch {
    localStorage.removeItem(tokenKey);
  }
}

function renderAccountStatus(data) {
  const box = $('account-status');
  if (!box) return;
  const user = data.user || {};
  const orders = data.ssServices?.orders || [];
  const activeOrder = orders.find(order => order.payment_status === 'PAID') || orders[0] || {};
  const items = [
    ['Cuenta registrada', Boolean(user.id)],
    ['Pago completado', activeOrder.payment_status === 'PAID'],
    ['Discord ID vinculado', Boolean(user.discord_id)],
    ['Invitacion generada', Boolean(activeOrder.discord_invite_code || activeOrder.invite_url)],
    ['Entro al Discord', Boolean(activeOrder.discord_joined)],
    ['Rol asignado', Boolean(activeOrder.role_assigned)]
  ];
  box.innerHTML = items.map(([label, ok]) => `<div class="status-row"><span>${label}</span><strong>${ok ? '✅' : '❌'}</strong></div>`).join('');
}

async function updateDiscordId() {
  const input = $('update-discord-id');
  const result = $('update-discord-result');
  try {
    const data = await api('/api/auth/profile', {
      method: 'POST',
      body: JSON.stringify({ discordId: input.value })
    });
    if (result) result.textContent = `Discord ID actualizado: ${data.user.discord_id}`;
    await loadPanel();
  } catch (err) {
    if (result) result.textContent = err.message || err.code || 'No se pudo actualizar Discord ID.';
  }
}

function renderSSPanel(ssServices = {}) {
  const box = $('panel-ss');
  if (!box) return;
  const orders = ssServices.orders || [];
  if (orders.length) {
    box.innerHTML = orders.map(order => `
      <article class="card">
        <h3>${order.plan}</h3>
        <p class="muted">Pago: ${order.payment_status} · Rol asignado: ${order.role_assigned ? 'SI' : 'NO'}</p>
        <p>Importe: <strong>${order.amount || 0} ${order.currency || 'eur'}</strong></p>
        <p>Discord: ${order.discord_joined ? 'verificado' : 'pendiente'}</p>
        ${order.invite_url ? `<a class="btn secondary" href="${order.invite_url}">Abrir invitacion Discord</a>` : '<p class="muted">Invitacion pendiente.</p>'}
      </article>
    `).join('');
    return;
  }
  const customers = ssServices.customers || [];
  const credits = ssServices.credits || [];
  const invites = ssServices.invites || [];
  if (!customers.length) {
    box.innerHTML = '<p class="muted">Aun no tienes servicios COLMENA-SS activos.</p>';
    return;
  }
  box.innerHTML = customers.map(customer => {
    const credit = credits.find(c => c.customer_id === customer.id) || {};
    const invite = invites.find(i => i.customer_id === customer.id) || {};
    return `
      <article class="card">
        <h3>${customer.server_name}</h3>
        <p class="muted">Plan: ${customer.plan} · Estado: ${customer.status}</p>
        <p>Escaneos disponibles: <strong>${credit.remaining ?? 0}</strong> / ${credit.total ?? 0}</p>
        <p>Escaneos usados: <strong>${credit.used ?? 0}</strong></p>
        ${invite.invite_url ? `<a class="btn secondary" href="${invite.invite_url}">Abrir invitacion Discord</a>` : '<p class="muted">Invitacion pendiente.</p>'}
      </article>
    `;
  }).join('');
}

async function openSupport() {
  const data = await api('/api/panel/support', {
    method: 'POST',
    body: JSON.stringify({ subject: $('support-subject').value, message: $('support-message').value })
  });
  $('support-result').textContent = `Ticket creado: ${data.ticket.id}`;
}

function logout() {
  localStorage.removeItem(tokenKey);
  location.href = '/web/index.html';
}
