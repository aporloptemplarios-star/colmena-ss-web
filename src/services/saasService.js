const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

class SaasService {
    constructor(options = {}) {
        this.dataDir = options.dataDir || path.join(process.cwd(), 'data');
        this.configDir = options.configDir || path.join(process.cwd(), 'config');
        this.licenseService = options.licenseService;
        this.logService = options.logService;
        this.jwtSecret = options.jwtSecret || 'change-me';
        this.stripeSecretKey = options.stripeSecretKey || '';
        this.stripeWebhookSecret = options.stripeWebhookSecret || '';
        this.publicBaseUrl = (options.publicBaseUrl || 'http://127.0.0.1:3000').replace(/\/$/, '');
        this.ensureDirs();
    }

    ensureDirs() {
        if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    }

    file(name) {
        return path.join(this.dataDir, name);
    }

    readJson(name, fallback = []) {
        try {
            const filePath = this.file(name);
            if (!fs.existsSync(filePath)) return fallback;
            return JSON.parse(fs.readFileSync(filePath, 'utf8') || JSON.stringify(fallback));
        } catch {
            return fallback;
        }
    }

    writeJson(name, data) {
        fs.writeFileSync(this.file(name), JSON.stringify(data, null, 2), 'utf8');
    }

    id(prefix) {
        return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    }

    hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
        const hash = crypto.pbkdf2Sync(String(password), salt, 310000, 32, 'sha256').toString('hex');
        return { salt, hash };
    }

    hashToken(token) {
        return crypto.createHash('sha256').update(String(token || '')).digest('hex');
    }

    resetExpiryMinutes() {
        return Math.max(5, Number(process.env.PASSWORD_RESET_EXPIRES_MINUTES || 30));
    }

    validatePassword(password) {
        const value = String(password || '');
        if (value.length < 8) return { ok: false, code: 'PASSWORD_TOO_SHORT', message: 'La contraseña debe tener minimo 8 caracteres.' };
        if (!/[A-Z]/.test(value)) return { ok: false, code: 'PASSWORD_UPPERCASE_REQUIRED', message: 'La contraseña debe incluir al menos una mayuscula.' };
        if (!/[a-z]/.test(value)) return { ok: false, code: 'PASSWORD_LOWERCASE_REQUIRED', message: 'La contraseña debe incluir al menos una minuscula.' };
        if (!/[0-9]/.test(value)) return { ok: false, code: 'PASSWORD_NUMBER_REQUIRED', message: 'La contraseña debe incluir al menos un numero.' };
        return { ok: true };
    }

    resetGenericResponse() {
        return { success: true, message: 'Si el email existe, recibiras instrucciones para recuperar tu contraseña.' };
    }

    recordAuthLog(type, message, metadata = {}) {
        const logs = this.readJson('auth_logs.json');
        logs.unshift({ id: this.id('authlog'), type, message, metadata, created_at: new Date().toISOString() });
        this.writeJson('auth_logs.json', logs.slice(0, 2000));
        this.logService?.record(type, message, { metadata });
    }

    isResetRateLimited(email, ipAddress = 'unknown') {
        const now = Date.now();
        const windowMs = 15 * 60 * 1000;
        const attempts = this.readJson('password_reset_rate_limits.json')
            .filter(item => now - Date.parse(item.created_at) < windowMs);
        const byEmail = attempts.filter(item => item.email === email).length;
        const byIp = attempts.filter(item => item.ip_address === ipAddress).length;
        attempts.push({ email, ip_address: ipAddress, created_at: new Date().toISOString() });
        this.writeJson('password_reset_rate_limits.json', attempts.slice(-1000));
        return byEmail >= 3 || byIp >= 10;
    }

    queuePasswordResetEmail({ email, resetLink }) {
        const outbox = this.readJson('password_reset_email_outbox.json');
        outbox.unshift({
            id: this.id('mailreset'),
            to: email,
            from: process.env.SMTP_FROM || 'Colmena WorkSuite <no-reply@colmena.com>',
            subject: 'Recuperación de contraseña — Colmena WorkSuite',
            body: [
                'Hola,',
                '',
                'Hemos recibido una solicitud para restablecer la contraseña de tu cuenta Colmena.',
                '',
                'Haz clic en el siguiente enlace para crear una nueva contraseña:',
                '',
                resetLink,
                '',
                `Este enlace caduca en ${this.resetExpiryMinutes()} minutos.`,
                '',
                'Si no has solicitado este cambio, ignora este mensaje.',
                '',
                'Colmena WorkSuite'
            ].join('\n'),
            status: process.env.SMTP_HOST ? 'queued_smtp' : 'queued_local',
            created_at: new Date().toISOString()
        });
        this.writeJson('password_reset_email_outbox.json', outbox.slice(0, 1000));
        return outbox[0];
    }

    signToken(payload, expiresMs = 24 * 60 * 60 * 1000) {
        const body = { ...payload, exp: Date.now() + expiresMs };
        const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
        const sig = crypto.createHmac('sha256', this.jwtSecret).update(encoded).digest('base64url');
        return `${encoded}.${sig}`;
    }

    verifyToken(token) {
        const [encoded, sig] = String(token || '').split('.');
        if (!encoded || !sig) return null;
        const expected = crypto.createHmac('sha256', this.jwtSecret).update(encoded).digest('base64url');
        if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        if (payload.exp && payload.exp < Date.now()) return null;
        return payload;
    }

    plans() {
        return this.licenseService.plans();
    }

    colmenaSSPlans() {
        const defaults = {
            SCANER: {
                label: 'Contrato por Escáner',
                price: 15,
                billing: 'one_time',
                role: 'CLIENTE_SCANER',
                credits: 1,
                privateChannel: false,
                level: 'basico',
                features: ['1 escaneo individual', 'ticket privado', 'revision por Discord', 'reporte basico', 'resultado final']
            },
            MONTHLY_SERVER: {
                label: 'Contrato Mensual Servidor',
                price: 149,
                billing: 'monthly',
                role: 'SERVIDOR_VERIFICADO',
                credits: 20,
                privateChannel: true,
                level: 'servidor verificado',
                features: ['servicio mensual para servidor', 'canal privado de cliente', 'soporte mensual', 'reportes', 'acceso Discord COLMENA-SS']
            },
            SS_INDIVIDUAL: {
                label: 'Escaneo Individual',
                price: 15,
                billing: 'one_time',
                role: 'CLIENTE_SS_INDIVIDUAL',
                credits: 1,
                privateChannel: false,
                features: ['1 usuario escaneado', 'ticket privado', 'revision por Discord', 'reporte basico', 'resultado final']
            },
            SS_STARTER: {
                label: 'Pack Servidor Starter',
                price: 49,
                billing: 'monthly',
                role: 'CLIENTE_SS_STARTER',
                credits: 5,
                privateChannel: true,
                features: ['5 escaneos mensuales', 'canal privado de cliente', 'soporte basico', 'reportes simples', 'acceso Discord COLMENA-SS']
            },
            SS_PRO: {
                label: 'Pack Servidor Pro',
                price: 149,
                billing: 'monthly',
                role: 'CLIENTE_SS_PRO',
                credits: 20,
                privateChannel: true,
                features: ['20 escaneos mensuales', 'prioridad en cola', 'reportes avanzados', 'soporte prioritario', 'seguimiento de casos']
            },
            SS_DIAMOND: {
                label: 'Enterprise Diamond SS',
                price: 299,
                billing: 'monthly',
                role: 'CLIENTE_SS_DIAMOND',
                credits: 999,
                privateChannel: true,
                features: ['escaneos avanzados', 'prioridad maxima', 'integracion con su Discord', 'reportes premium', 'canal dedicado']
            }
        };
        try {
            const configPath = path.join(this.configDir, 'product.plans.json');
            const configured = JSON.parse(fs.readFileSync(configPath, 'utf8')).colmenaSSPlans || {};
            return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, { ...value, ...(configured[key] || {}) }]));
        } catch {
            return defaults;
        }
    }

    orderRole(plan) {
        return plan === 'MONTHLY_SERVER' ? 'SERVIDOR_VERIFICADO' : 'CLIENTE_SCANER';
    }

    normalizeOrderPlan(plan) {
        if (plan === 'SCANER' || plan === 'MONTHLY_SERVER') return plan;
        if (plan === 'SS_INDIVIDUAL') return 'SCANER';
        if (['SS_STARTER', 'SS_PRO', 'SS_DIAMOND'].includes(plan)) return 'MONTHLY_SERVER';
        return '';
    }

    publicOrder(order) {
        if (!order) return null;
        return { ...order };
    }

    findUserById(userId) {
        return this.readJson('saas_users.json').find(user => user.id === userId) || null;
    }

    findUserByDiscordId(discordId) {
        return this.readJson('saas_users.json').find(user => String(user.discord_id || '') === String(discordId || '')) || null;
    }

    findPaidOrderByDiscordId(discordId) {
        const user = this.findUserByDiscordId(discordId);
        if (!user) return null;
        const orders = this.readJson('orders.json');
        return orders.find(order => order.user_id === user.id && order.payment_status === 'PAID' && !order.role_assigned) || null;
    }

    findLatestPaidOrderByDiscordId(discordId, { includeAssigned = true } = {}) {
        const user = this.findUserByDiscordId(discordId);
        if (!user) return null;
        const orders = this.readJson('orders.json');
        return orders.find(order => order.user_id === user.id && order.payment_status === 'PAID' && (includeAssigned || !order.role_assigned)) || null;
    }

    updateOrder(orderId, updater) {
        const orders = this.readJson('orders.json');
        const order = orders.find(o => o.id === orderId);
        if (!order) return null;
        updater(order);
        this.writeJson('orders.json', orders);
        return order;
    }

    markOrderDiscordProvisioned(orderId, { roleAssigned = false, ownerNotified = false, inviteCode = null, inviteUrl = null } = {}) {
        return this.updateOrder(orderId, order => {
            order.discord_joined = true;
            order.role_assigned = Boolean(roleAssigned || order.role_assigned);
            order.owner_notified = Boolean(ownerNotified || order.owner_notified);
            if (inviteCode) order.invite_code = inviteCode;
            if (inviteUrl) order.invite_url = inviteUrl;
            order.updated_at = new Date().toISOString();
        });
    }

    saveOrderInvite(orderId, { inviteCode, inviteUrl, expiresAt }) {
        const updated = this.updateOrder(orderId, order => {
            order.invite_code = inviteCode;
            order.invite_url = inviteUrl;
            order.invite_expires_at = expiresAt;
            order.updated_at = new Date().toISOString();
        });
        const invites = this.readJson('ss_discord_invites.json');
        invites.unshift({
            id: this.id('invorder'),
            order_id: orderId,
            customer_id: updated?.customer_id || '',
            invite_code: inviteCode,
            invite_url: inviteUrl,
            used: false,
            expires_at: expiresAt,
            created_at: new Date().toISOString()
        });
        this.writeJson('ss_discord_invites.json', invites.slice(0, 1000));
        return updated;
    }

    markOrderInviteUsed(orderId) {
        const order = this.updateOrder(orderId, current => {
            current.discord_joined = true;
            current.updated_at = new Date().toISOString();
        });
        const invites = this.readJson('ss_discord_invites.json');
        for (const invite of invites.filter(i => i.order_id === orderId && !i.used)) {
            invite.used = true;
            invite.used_at = new Date().toISOString();
        }
        this.writeJson('ss_discord_invites.json', invites);
        return order;
    }

    async createOrderCheckout({ userId, plan, notes, profileUpdates = {} }) {
        const normalizedPlan = this.normalizeOrderPlan(plan);
        if (!normalizedPlan) return { success: false, code: 'INVALID_ORDER_PLAN', message: 'Tipo de contrato invalido.' };
        const plans = this.colmenaSSPlans();
        const selected = plans[normalizedPlan];
        const user = this.updateProfile(userId, profileUpdates);
        if (!user) return { success: false, code: 'AUTH_REQUIRED', message: 'Debes registrarte o iniciar sesion para contratar COLMENA-SS.' };
        const profileValidation = this.validateUserProfile(user);
        if (!profileValidation.ok) return { success: false, code: profileValidation.code, message: profileValidation.message };

        const orders = this.readJson('orders.json');
        const order = {
            id: this.id('ord'),
            user_id: user.id,
            plan: normalizedPlan,
            notes: String(notes || '').trim(),
            payment_status: this.stripeSecretKey ? 'PENDING' : 'PAID',
            stripe_session_id: '',
            stripe_customer_id: '',
            amount: selected.price,
            currency: 'eur',
            discord_invite_code: '',
            discord_joined: false,
            role_assigned: false,
            owner_notified: false,
            created_at: new Date().toISOString()
        };
        orders.unshift(order);
        this.writeJson('orders.json', orders.slice(0, 2000));

        if (!this.stripeSecretKey) {
            const activation = this.completeOrderPayment(order.id, { stripeSessionId: `sim_${order.id}` });
            return { success: true, simulated: true, order: activation.order, checkoutUrl: `${this.publicBaseUrl}/colmena-ss?order=success` };
        }

        const params = new URLSearchParams();
        params.append('mode', selected.billing === 'one_time' ? 'payment' : 'subscription');
        params.append('success_url', `${this.publicBaseUrl}/colmena-ss?order=success`);
        params.append('cancel_url', `${this.publicBaseUrl}/colmena-ss?order=cancel`);
        params.append('customer_email', order.email);
        params.append('client_reference_id', order.id);
        params.append('metadata[service_type]', 'colmena_ss_order');
        params.append('metadata[order_id]', order.id);
        params.append('metadata[user_id]', user.id);
        params.append('metadata[plan]', normalizedPlan);
        params.append('metadata[discord_id]', user.discord_id);
        params.append('line_items[0][quantity]', '1');
        params.append('line_items[0][price_data][currency]', 'eur');
        params.append('line_items[0][price_data][product_data][name]', `COLMENA-SS ${selected.label}`);
        params.append('line_items[0][price_data][unit_amount]', String(Math.max(100, Math.round(selected.price * 100))));
        if (selected.billing === 'monthly') params.append('line_items[0][price_data][recurring][interval]', 'month');
        const response = await axios.post('https://api.stripe.com/v1/checkout/sessions', params, {
            headers: { Authorization: `Bearer ${this.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 12000
        });
        this.updateOrder(order.id, current => {
            current.stripe_session_id = response.data.id;
            current.updated_at = new Date().toISOString();
        });
        return { success: true, order: this.findOrderById(order.id), checkoutUrl: response.data.url };
    }

    findOrderById(orderId) {
        return this.readJson('orders.json').find(order => order.id === orderId) || null;
    }

    completeOrderPayment(orderId, { stripeSessionId = '', stripeCustomerId = '' } = {}) {
        const order = this.updateOrder(orderId, current => {
            current.payment_status = 'PAID';
            if (stripeSessionId) current.stripe_session_id = stripeSessionId;
            if (stripeCustomerId) current.stripe_customer_id = stripeCustomerId;
            current.updated_at = new Date().toISOString();
        });
        if (!order) return { success: false, code: 'ORDER_NOT_FOUND' };
        return { success: true, order };
    }

    validateUserProfile(user) {
        if (!String(user.full_name || '').trim()) return { ok: false, code: 'FULL_NAME_REQUIRED', message: 'Introduce tu nombre completo.' };
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(user.email || '').trim().toLowerCase())) return { ok: false, code: 'INVALID_EMAIL', message: 'Email invalido.' };
        if (!String(user.discord_username || '').trim()) return { ok: false, code: 'DISCORD_USERNAME_REQUIRED', message: 'Introduce tu usuario Discord.' };
        if (!/^\d{16,25}$/.test(String(user.discord_id || '').trim())) return { ok: false, code: 'DISCORD_ID_REQUIRED', message: 'Introduce un Discord ID valido.' };
        if (!String(user.server_name || '').trim()) return { ok: false, code: 'SERVER_NAME_REQUIRED', message: 'Introduce el nombre del servidor.' };
        if (!String(user.server_discord_invite || '').trim()) return { ok: false, code: 'SERVER_INVITE_REQUIRED', message: 'Introduce el enlace del Discord del servidor.' };
        if (!user.terms_accepted) return { ok: false, code: 'TERMS_REQUIRED', message: 'Debes aceptar los terminos.' };
        if (!user.ss_policy_accepted) return { ok: false, code: 'SS_POLICY_REQUIRED', message: 'Debes aceptar la politica COLMENA-SS.' };
        return { ok: true };
    }

    register({ email, password, company, fullName, discordUsername, discordId, serverName, serverDiscordInvite, termsAccepted, ssPolicyAccepted }) {
        const normalized = String(email || '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) return { success: false, code: 'INVALID_EMAIL', message: 'Email invalido.' };
        if (!password || String(password).length < 8) return { success: false, code: 'WEAK_PASSWORD', message: 'La contrasena debe tener minimo 8 caracteres.' };
        const users = this.readJson('saas_users.json');
        if (users.some(u => u.email === normalized)) return { success: false, code: 'USER_EXISTS', message: 'El usuario ya existe.' };
        if (discordId && users.some(u => String(u.discord_id || '') === String(discordId).trim())) return { success: false, code: 'DISCORD_ID_EXISTS', message: 'Este Discord ID ya esta registrado.' };
        const pass = this.hashPassword(password);
        const user = {
            id: this.id('usr'),
            full_name: String(fullName || '').trim(),
            email: normalized,
            discord_username: String(discordUsername || '').trim(),
            discord_id: String(discordId || '').trim(),
            server_name: String(serverName || company || '').trim(),
            server_discord_invite: String(serverDiscordInvite || '').trim(),
            company: company || '',
            role: users.length === 0 ? 'admin' : 'client',
            password: pass.hash,
            password_hash: pass.hash,
            salt: pass.salt,
            terms_accepted: Boolean(termsAccepted),
            ss_policy_accepted: Boolean(ssPolicyAccepted),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            status: 'active'
        };
        const profileValidation = this.validateUserProfile(user);
        if (!profileValidation.ok) return { success: false, code: profileValidation.code, message: profileValidation.message };
        users.push(user);
        this.writeJson('saas_users.json', users);
        this.logService?.record('saas_user_registered', normalized, { metadata: { userId: user.id } });
        return { success: true, user: this.publicUser(user), token: this.signToken({ sub: user.id, role: user.role, email: user.email }) };
    }

    login({ email, password }) {
        const normalized = String(email || '').trim().toLowerCase();
        const user = this.readJson('saas_users.json').find(u => u.email === normalized);
        if (!user || user.status !== 'active') return { success: false, code: 'INVALID_LOGIN', message: 'Credenciales invalidas.' };
        const pass = this.hashPassword(password, user.salt);
        if (pass.hash !== user.password) return { success: false, code: 'INVALID_LOGIN', message: 'Credenciales invalidas.' };
        return { success: true, user: this.publicUser(user), token: this.signToken({ sub: user.id, role: user.role, email: user.email }) };
    }

    publicUser(user) {
        return {
            id: user.id,
            full_name: user.full_name || '',
            email: user.email,
            discord_username: user.discord_username || '',
            discord_id: user.discord_id || '',
            server_name: user.server_name || user.company || '',
            server_discord_invite: user.server_discord_invite || '',
            terms_accepted: Boolean(user.terms_accepted),
            ss_policy_accepted: Boolean(user.ss_policy_accepted),
            company: user.company,
            role: user.role,
            status: user.status
        };
    }

    updateProfile(userId, updates = {}) {
        const users = this.readJson('saas_users.json');
        const user = users.find(u => u.id === userId);
        if (!user) return null;
        const orders = this.readJson('orders.json');
        const hasAssignedRole = orders.some(order => order.user_id === user.id && order.role_assigned);
        if (updates.discordId && String(updates.discordId).trim() !== String(user.discord_id || '').trim() && hasAssignedRole) {
            return null;
        }
        if (updates.fullName !== undefined) user.full_name = String(updates.fullName || '').trim();
        if (updates.discordUsername !== undefined) user.discord_username = String(updates.discordUsername || '').trim();
        if (updates.discordId !== undefined) user.discord_id = String(updates.discordId || '').trim();
        if (updates.serverName !== undefined) user.server_name = String(updates.serverName || '').trim();
        if (updates.serverDiscordInvite !== undefined) user.server_discord_invite = String(updates.serverDiscordInvite || '').trim();
        if (updates.termsAccepted !== undefined) user.terms_accepted = Boolean(updates.termsAccepted);
        if (updates.ssPolicyAccepted !== undefined) user.ss_policy_accepted = Boolean(updates.ssPolicyAccepted);
        user.updated_at = new Date().toISOString();
        this.writeJson('saas_users.json', users);
        return user;
    }

    createReset({ email, ipAddress = 'unknown', userAgent = '' }) {
        const normalized = String(email || '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
            this.recordAuthLog('password_reset_failed', 'Solicitud de recuperacion con email invalido.', { ipAddress });
            return this.resetGenericResponse();
        }
        if (this.isResetRateLimited(normalized, ipAddress)) {
            this.recordAuthLog('password_reset_rate_limited', 'Rate limit en recuperacion de contraseña.', { email: normalized, ipAddress });
            return this.resetGenericResponse();
        }
        this.recordAuthLog('password_reset_requested', 'Solicitud de recuperacion de contraseña.', { email: normalized, ipAddress });
        const user = this.readJson('saas_users.json').find(u => u.email === normalized);
        if (!user) return this.resetGenericResponse();

        const rawToken = crypto.randomBytes(32).toString('base64url');
        const resetLink = `${this.publicBaseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
        const tokens = this.readJson('password_reset_tokens.json');
        tokens.unshift({
            id: this.id('prt'),
            user_id: user.id,
            token_hash: this.hashToken(rawToken),
            expires_at: new Date(Date.now() + this.resetExpiryMinutes() * 60 * 1000).toISOString(),
            used_at: null,
            created_at: new Date().toISOString(),
            ip_address: ipAddress,
            user_agent: String(userAgent || '').slice(0, 300)
        });
        this.writeJson('password_reset_tokens.json', tokens.slice(0, 1000));
        this.queuePasswordResetEmail({ email: user.email, resetLink });
        this.recordAuthLog('password_reset_email_sent', 'Email de recuperacion preparado.', { userId: user.id, email: user.email });
        return { ...this.resetGenericResponse(), resetLink: process.env.NODE_ENV === 'production' ? undefined : resetLink };
    }

    resetPassword({ token, newPassword, password }) {
        const requestedPassword = newPassword || password;
        const passwordValidation = this.validatePassword(requestedPassword);
        if (!passwordValidation.ok) {
            this.recordAuthLog('password_reset_failed', 'Nueva contraseña no cumple politica.', { code: passwordValidation.code });
            return { success: false, code: passwordValidation.code, message: passwordValidation.message };
        }
        const tokenHash = this.hashToken(token);
        const tokens = this.readJson('password_reset_tokens.json');
        const reset = tokens.find(r => r.token_hash === tokenHash);
        if (!reset || reset.used_at) {
            this.recordAuthLog('password_reset_failed', 'Token invalido o usado.', {});
            return { success: false, code: 'RESET_INVALID', message: 'Token invalido o expirado.' };
        }
        if (Date.parse(reset.expires_at) < Date.now()) {
            this.recordAuthLog('password_reset_token_expired', 'Token de recuperacion expirado.', { resetId: reset.id, userId: reset.user_id });
            return { success: false, code: 'RESET_EXPIRED', message: 'Token invalido o expirado.' };
        }
        const users = this.readJson('saas_users.json');
        const user = users.find(u => u.id === reset.user_id);
        if (!user) {
            this.recordAuthLog('password_reset_failed', 'Usuario de token no encontrado.', { resetId: reset.id });
            return { success: false, code: 'USER_NOT_FOUND', message: 'Usuario no encontrado.' };
        }
        const pass = this.hashPassword(requestedPassword);
        user.password = pass.hash;
        user.password_hash = pass.hash;
        user.salt = pass.salt;
        user.sessions_invalidated_at = new Date().toISOString();
        user.updated_at = new Date().toISOString();
        reset.used_at = new Date().toISOString();
        this.writeJson('saas_users.json', users);
        this.writeJson('password_reset_tokens.json', tokens);
        this.recordAuthLog('password_reset_completed', 'Contraseña actualizada correctamente.', { userId: user.id, email: user.email });
        return { success: true, message: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.' };
    }

    async createCheckout({ userId, plan, mode = 'subscription', scanQuantity = 1, serverId }) {
        const plans = this.plans();
        if (!plans[plan]) return { success: false, code: 'INVALID_PLAN', message: 'Plan invalido.' };
        const payments = this.readJson('saas_payments.json');
        const payment = {
            id: this.id('pay'),
            user_id: userId,
            plan,
            mode,
            server_id: serverId || '',
            amount: mode === 'scan' ? (plans[plan].pricePerScan || 0) * scanQuantity : plans[plan].priceMonthly || 0,
            currency: 'eur',
            status: this.stripeSecretKey ? 'pending' : 'simulated',
            created_at: new Date().toISOString()
        };
        payments.push(payment);
        this.writeJson('saas_payments.json', payments);
        if (!this.stripeSecretKey) {
            const license = this.generateLicenseForPayment(payment);
            return { success: true, simulated: true, payment, license, checkoutUrl: `${this.publicBaseUrl}/web/panel.html` };
        }
        const params = new URLSearchParams();
        params.append('mode', mode === 'scan' ? 'payment' : 'subscription');
        params.append('success_url', `${this.publicBaseUrl}/web/panel.html?checkout=success`);
        params.append('cancel_url', `${this.publicBaseUrl}/web/precios.html?checkout=cancel`);
        params.append('client_reference_id', payment.id);
        params.append('metadata[payment_id]', payment.id);
        params.append('metadata[plan]', plan);
        params.append('metadata[user_id]', userId);
        params.append('line_items[0][quantity]', '1');
        params.append('line_items[0][price_data][currency]', 'eur');
        params.append('line_items[0][price_data][product_data][name]', `Colmena WorkSuite ${plan}`);
        params.append('line_items[0][price_data][unit_amount]', String(Math.max(100, Math.round(payment.amount * 100))));
        if (mode !== 'scan') params.append('line_items[0][price_data][recurring][interval]', 'month');
        const response = await axios.post('https://api.stripe.com/v1/checkout/sessions', params, {
            headers: { Authorization: `Bearer ${this.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 12000
        });
        payment.stripe_session_id = response.data.id;
        this.writeJson('saas_payments.json', payments);
        return { success: true, payment, checkoutUrl: response.data.url };
    }

    upsertCustomer({ email, discordId, serverName, serverInvite, plan, stripeCustomerId = null }) {
        const customers = this.readJson('ss_customers.json');
        const normalized = String(email || '').trim().toLowerCase();
        let customer = customers.find(c => c.email === normalized && c.discord_id === String(discordId || '').trim());
        if (!customer) {
            customer = {
                id: this.id('ssc'),
                email: normalized,
                discord_id: String(discordId || '').trim(),
                server_name: String(serverName || '').trim(),
                server_invite: String(serverInvite || '').trim(),
                plan,
                status: 'pending_payment',
                stripe_customer_id: stripeCustomerId,
                created_at: new Date().toISOString()
            };
            customers.push(customer);
        } else {
            customer.server_name = String(serverName || customer.server_name || '').trim();
            customer.server_invite = String(serverInvite || customer.server_invite || '').trim();
            customer.plan = plan;
            customer.stripe_customer_id = stripeCustomerId || customer.stripe_customer_id || null;
        }
        this.writeJson('ss_customers.json', customers);
        return customer;
    }

    async createColmenaSSCheckout({ email, discordId, serverName, serverInvite, plan }) {
        const plans = this.colmenaSSPlans();
        if (!plans[plan]) return { success: false, code: 'INVALID_SS_PLAN', message: 'Plan COLMENA-SS invalido.' };
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || '').trim().toLowerCase())) return { success: false, code: 'INVALID_EMAIL', message: 'Email invalido.' };
        if (!/^\d{16,25}$/.test(String(discordId || '').trim())) return { success: false, code: 'DISCORD_ID_REQUIRED', message: 'Introduce un Discord ID valido.' };
        if (!String(serverName || '').trim()) return { success: false, code: 'SERVER_NAME_REQUIRED', message: 'Introduce el nombre del servidor.' };

        const customer = this.upsertCustomer({ email, discordId, serverName, serverInvite, plan });
        const payments = this.readJson('ss_payments.json');
        const selected = plans[plan];
        const payment = {
            id: this.id('ssp'),
            customer_id: customer.id,
            email: customer.email,
            discord_id: customer.discord_id,
            server_name: customer.server_name,
            server_invite: customer.server_invite,
            plan,
            service_type: 'colmena_ss',
            amount: selected.price,
            currency: 'eur',
            mode: selected.billing === 'one_time' ? 'payment' : 'subscription',
            status: this.stripeSecretKey ? 'pending' : 'simulated',
            created_at: new Date().toISOString()
        };
        payments.push(payment);
        this.writeJson('ss_payments.json', payments);

        if (!this.stripeSecretKey) {
            const activation = this.activateColmenaSSPayment(payment.id, { simulated: true });
            return { success: true, simulated: true, payment, customer, activation, checkoutUrl: `${this.publicBaseUrl}/web/panel.html?ss=success` };
        }

        const params = new URLSearchParams();
        params.append('mode', selected.billing === 'one_time' ? 'payment' : 'subscription');
        params.append('success_url', `${this.publicBaseUrl}/web/panel.html?ss=success`);
        params.append('cancel_url', `${this.publicBaseUrl}/colmena-ss?checkout=cancel`);
        params.append('customer_email', customer.email);
        params.append('client_reference_id', payment.id);
        params.append('metadata[payment_id]', payment.id);
        params.append('metadata[service_type]', 'colmena_ss');
        params.append('metadata[customer_id]', customer.id);
        params.append('metadata[plan]', plan);
        params.append('metadata[discord_id]', customer.discord_id);
        params.append('line_items[0][quantity]', '1');
        params.append('line_items[0][price_data][currency]', 'eur');
        params.append('line_items[0][price_data][product_data][name]', `COLMENA-SS ${selected.label}`);
        params.append('line_items[0][price_data][unit_amount]', String(Math.max(100, Math.round(selected.price * 100))));
        if (selected.billing === 'monthly') params.append('line_items[0][price_data][recurring][interval]', 'month');
        const response = await axios.post('https://api.stripe.com/v1/checkout/sessions', params, {
            headers: { Authorization: `Bearer ${this.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 12000
        });
        payment.stripe_session_id = response.data.id;
        this.writeJson('ss_payments.json', payments);
        return { success: true, payment, customer, checkoutUrl: response.data.url };
    }

    activateColmenaSSPayment(paymentId, metadata = {}) {
        const payments = this.readJson('ss_payments.json');
        const payment = payments.find(p => p.id === paymentId);
        if (!payment) return { success: false, code: 'SS_PAYMENT_NOT_FOUND' };
        const plans = this.colmenaSSPlans();
        const selected = plans[payment.plan];
        if (!selected) return { success: false, code: 'INVALID_SS_PLAN' };

        payment.status = 'paid';
        payment.paid_at = new Date().toISOString();
        if (metadata.stripeCustomerId) payment.stripe_customer_id = metadata.stripeCustomerId;
        this.writeJson('ss_payments.json', payments);

        const customers = this.readJson('ss_customers.json');
        const customer = customers.find(c => c.id === payment.customer_id) || this.upsertCustomer(payment);
        customer.status = 'active';
        customer.plan = payment.plan;
        customer.stripe_customer_id = metadata.stripeCustomerId || customer.stripe_customer_id || null;
        this.writeJson('ss_customers.json', customers);

        const subscriptions = this.readJson('ss_subscriptions.json');
        subscriptions.unshift({
            id: this.id('subss'),
            customer_id: customer.id,
            plan: payment.plan,
            status: 'active',
            started_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + (selected.billing === 'one_time' ? 14 : 31) * 24 * 60 * 60 * 1000).toISOString(),
            stripe_subscription_id: metadata.stripeSubscriptionId || null
        });
        this.writeJson('ss_subscriptions.json', subscriptions.slice(0, 1000));

        const credits = this.readJson('ss_scan_credits.json');
        credits.unshift({
            id: this.id('credss'),
            customer_id: customer.id,
            payment_id: payment.id,
            plan: payment.plan,
            total: selected.credits,
            used: 0,
            remaining: selected.credits,
            created_at: new Date().toISOString()
        });
        this.writeJson('ss_scan_credits.json', credits.slice(0, 1000));

        const audit = this.readJson('ss_access_logs.json');
        audit.unshift({ id: this.id('sslog'), action: 'payment_activated', customer_id: customer.id, plan: payment.plan, at: new Date().toISOString(), metadata });
        this.writeJson('ss_access_logs.json', audit.slice(0, 1000));
        this.queueColmenaSSEmail({
            customer,
            plan: selected,
            subject: 'Acceso COLMENA-SS activado',
            body: [
                `Gracias por contratar COLMENA-SS.`,
                `Plan contratado: ${selected.label}.`,
                `Tu acceso Discord se generara con invitacion unica tras confirmar el pago.`,
                `Normas basicas: escaneos consentidos, no publicar datos personales y seguir instrucciones del staff.`,
                `Para solicitar un escaneo usa #📋・solicitar-escaneo dentro del Discord COLMENA-SS.`
            ].join('\n')
        });
        return { success: true, customer, payment, plan: selected };
    }

    queueColmenaSSEmail({ customer, plan, subject, body }) {
        const outbox = this.readJson('ss_email_outbox.json');
        outbox.unshift({
            id: this.id('mailss'),
            to: customer.email,
            subject,
            body,
            plan: plan.label,
            status: 'queued',
            created_at: new Date().toISOString()
        });
        this.writeJson('ss_email_outbox.json', outbox.slice(0, 1000));
        return outbox[0];
    }

    saveDiscordInvite({ customerId, inviteCode, inviteUrl, expiresAt }) {
        const invites = this.readJson('ss_discord_invites.json');
        invites.unshift({
            id: this.id('invss'),
            customer_id: customerId,
            invite_code: inviteCode,
            invite_url: inviteUrl,
            used: false,
            expires_at: expiresAt,
            created_at: new Date().toISOString()
        });
        this.writeJson('ss_discord_invites.json', invites.slice(0, 1000));
        return invites[0];
    }

    markDiscordInviteUsed(discordId) {
        const customers = this.readJson('ss_customers.json');
        const customer = customers.find(c => c.discord_id === String(discordId || ''));
        if (!customer) return null;
        const invites = this.readJson('ss_discord_invites.json');
        for (const invite of invites.filter(i => i.customer_id === customer.id && !i.used)) {
            invite.used = true;
            invite.used_at = new Date().toISOString();
        }
        this.writeJson('ss_discord_invites.json', invites);
        return customer;
    }

    generateLicenseForPayment(payment) {
        const licenses = this.licenseService.readLicenses();
        const rawKey = `COLMENA-${payment.plan}-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
        const planMaxUsers = payment.plan === 'ENTERPRISE_DIAMOND' ? 250 : payment.plan === 'PREMIUM' ? 25 : 5;
        const license = {
            license_key_hash: this.licenseService.hashLicenseKey(rawKey),
            plan: payment.plan,
            status: 'active',
            expires_at: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString(),
            max_users: planMaxUsers,
            max_activations: payment.plan === 'ENTERPRISE_DIAMOND' ? 10 : payment.plan === 'PREMIUM' ? 2 : 1,
            server_id: payment.server_id || `srv_${payment.id}`,
            created_at: new Date().toISOString(),
            payment_id: payment.id,
            activations: []
        };
        licenses.push(license);
        this.licenseService.writeLicenses(licenses);
        const generated = { license_key: rawKey, license: this.licenseService.sanitizeLicense(license) };
        const generatedLicenses = this.readJson('saas_generated_licenses.json');
        generatedLicenses.unshift({ payment_id: payment.id, user_id: payment.user_id, plan: payment.plan, license_key_preview: `${rawKey.slice(0, 14)}...`, created_at: new Date().toISOString() });
        this.writeJson('saas_generated_licenses.json', generatedLicenses.slice(0, 1000));
        return generated;
    }

    handleStripeEvent(event) {
        if (['invoice.payment_succeeded', 'payment_failed'].includes(event.type)) return { success: true, tracked: true, type: event.type };
        if (event.type === 'customer.subscription.deleted') return this.expireColmenaSSSubscription(event.data?.object?.id);
        if (event.type !== 'checkout.session.completed') return { success: true, ignored: true };
        if (event.data?.object?.metadata?.service_type === 'colmena_ss_order') {
            return this.completeOrderPayment(event.data.object.metadata.order_id, {
                stripeSessionId: event.data.object.id,
                stripeCustomerId: event.data.object.customer || null
            });
        }
        if (event.data?.object?.metadata?.service_type === 'colmena_ss') {
            return this.activateColmenaSSPayment(event.data.object.metadata.payment_id, {
                stripeCustomerId: event.data.object.customer || null,
                stripeSubscriptionId: event.data.object.subscription || null,
                stripe: true
            });
        }
        const paymentId = event.data?.object?.metadata?.payment_id;
        const payments = this.readJson('saas_payments.json');
        const payment = payments.find(p => p.id === paymentId);
        if (!payment) return { success: false, code: 'PAYMENT_NOT_FOUND' };
        payment.status = 'paid';
        payment.stripe_customer = event.data.object.customer || null;
        payment.paid_at = new Date().toISOString();
        const license = this.generateLicenseForPayment(payment);
        this.writeJson('saas_payments.json', payments);
        return { success: true, payment, license };
    }

    expireColmenaSSSubscription(stripeSubscriptionId) {
        const subscriptions = this.readJson('ss_subscriptions.json');
        const sub = subscriptions.find(s => s.stripe_subscription_id === stripeSubscriptionId);
        if (!sub) return { success: true, ignored: true };
        sub.status = 'expired';
        sub.expired_at = new Date().toISOString();
        this.writeJson('ss_subscriptions.json', subscriptions);
        const customers = this.readJson('ss_customers.json');
        const customer = customers.find(c => c.id === sub.customer_id);
        if (customer) {
            customer.status = 'expired';
            this.writeJson('ss_customers.json', customers);
        }
        return { success: true, expired: true, customer };
    }

    verifyStripeSignature(rawBody, signature) {
        if (!this.stripeWebhookSecret) return true;
        const parts = Object.fromEntries(String(signature || '').split(',').map(p => p.split('=')));
        const signed = `${parts.t}.${rawBody.toString('utf8')}`;
        const expected = crypto.createHmac('sha256', this.stripeWebhookSecret).update(signed).digest('hex');
        return Boolean(parts.v1 && parts.v1.length === expected.length && crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected)));
    }

    dashboard(user) {
        const dbUser = this.findUserById(user.sub);
        const publicUser = dbUser ? this.publicUser(dbUser) : user;
        const payments = this.readJson('saas_payments.json').filter(p => user.role === 'admin' || p.user_id === user.sub);
        const scans = this.readJson('backend_ss_sessions.json');
        const logs = this.readJson('backend_logs.json');
        const licenses = this.licenseService.readLicenses().map(l => this.licenseService.sanitizeLicense(l));
        return {
            success: true,
            user: publicUser,
            payments,
            ssServices: this.colmenaSSDashboard(user),
            subscriptions: payments.filter(p => p.mode === 'subscription'),
            licenses: user.role === 'admin' ? licenses : licenses.filter(l => payments.some(p => p.plan === l.plan)),
            scans: scans.slice(0, 100),
            logs: logs.slice(0, 100),
            revenue: payments.filter(p => ['paid', 'simulated'].includes(p.status)).reduce((sum, p) => sum + (p.amount || 0), 0)
        };
    }

    colmenaSSDashboard(user) {
        const customers = this.readJson('ss_customers.json').filter(c => user.role === 'admin' || c.email === user.email);
        const customerIds = new Set(customers.map(c => c.id));
        const subscriptions = this.readJson('ss_subscriptions.json').filter(s => user.role === 'admin' || customerIds.has(s.customer_id));
        const credits = this.readJson('ss_scan_credits.json').filter(c => user.role === 'admin' || customerIds.has(c.customer_id));
        const invites = this.readJson('ss_discord_invites.json').filter(i => user.role === 'admin' || customerIds.has(i.customer_id));
        const payments = this.readJson('ss_payments.json').filter(p => user.role === 'admin' || customerIds.has(p.customer_id));
        const orders = this.readJson('orders.json').filter(order => user.role === 'admin' || order.user_id === user.sub);
        return { customers, subscriptions, credits, invites, payments, orders };
    }
}

module.exports = SaasService;
