require('dotenv').config();

const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const { Client, GatewayIntentBits, Partials, ChannelType, PermissionFlagsBits } = require('discord.js');
const SaasService = require('./src/services/saasService');
const LicenseService = require('./src/services/licenseService');
const LogService = require('./src/services/logService');

const PORT = Number(process.env.PORT || process.env.SERVER_PORT || 3000);
const ROOT = __dirname;
const APP_URL = (process.env.APP_URL || process.env.COLMENA_PUBLIC_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');

const logService = new LogService({ rootDir: ROOT, dataDir: path.join(ROOT, 'data') });
const licenseService = new LicenseService({ rootDir: ROOT, dataDir: path.join(ROOT, 'data'), configDir: path.join(ROOT, 'config'), logService });
const saas = new SaasService({
    dataDir: path.join(ROOT, 'data'),
    configDir: path.join(ROOT, 'config'),
    licenseService,
    logService,
    jwtSecret: process.env.JWT_SECRET || process.env.COLMENA_JWT_SECRET || process.env.COLMENA_HMAC_SECRET || 'change-me',
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    publicBaseUrl: APP_URL
});

const app = express();
app.use(bodyParser.json({ limit: '256kb', strict: true, verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use('/web', express.static(path.join(ROOT, 'web')));

const hasEnv = (name) => Boolean(String(process.env[name] || '').trim());
const publicHealth = () => ({
    success: true,
    service: 'Colmena WorkSuite',
    mode: process.env.NODE_ENV || 'development',
    version: {
        app: process.env.APP_VERSION || require('./package.json').version,
        launcher: process.env.LAUNCHER_VERSION || 'unknown',
        backend: process.env.BACKEND_VERSION || 'production-server',
        bot: process.env.BOT_VERSION || 'production-bot'
    },
    url: APP_URL,
    checks: {
        jwtSecret: hasEnv('JWT_SECRET') || hasEnv('COLMENA_JWT_SECRET'),
        stripe: hasEnv('STRIPE_SECRET_KEY') && hasEnv('STRIPE_WEBHOOK_SECRET'),
        discordBot: hasEnv('DISCORD_BOT_TOKEN') || hasEnv('DISCORD_TOKEN'),
        discordGuild: hasEnv('DISCORD_GUILD_ID'),
        discordOwner: hasEnv('DISCORD_OWNER_ID'),
        smtp: hasEnv('SMTP_HOST') && hasEnv('SMTP_USER') && hasEnv('SMTP_PASS'),
        databaseUrl: hasEnv('DATABASE_URL')
    },
    discord: {
        connected: Boolean(discordClient?.isReady?.()),
        user: discordClient?.user?.tag || null
    },
    timestamp: new Date().toISOString()
});

const routeFile = (file) => (req, res) => res.sendFile(path.join(ROOT, 'web', file));
app.get('/', routeFile('index.html'));
app.get('/colmena-ss', routeFile('colmena-ss.html'));
app.get('/precios', routeFile('precios.html'));
app.get('/registro', routeFile('registro.html'));
app.get('/login', routeFile('login.html'));
app.get('/panel', routeFile('panel.html'));
app.get('/checkout/success', routeFile('checkout-success.html'));
app.get('/checkout/cancel', routeFile('checkout-cancel.html'));
app.get('/forgot-password', routeFile('forgot-password.html'));
app.get('/reset-password', routeFile('reset-password.html'));
app.get('/api/status', (req, res) => res.json(publicHealth()));
app.get('/api/health', (req, res) => {
    const health = publicHealth();
    const requiredOk = health.checks.jwtSecret && health.checks.stripe && health.checks.discordBot && health.checks.discordGuild && health.checks.discordOwner;
    return res.status(requiredOk ? 200 : 503).json({ ...health, ready: requiredOk });
});

const appendLog = (type, message, metadata = {}) => {
    saas.recordAuthLog(type, message, metadata);
};

const requireAuth = (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const user = saas.verifyToken(token);
    if (!user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', message: 'Login requerido.' });
    req.saasUser = user;
    return next();
};

app.get('/api/public/plans', (req, res) => res.json({ success: true, plans: saas.plans() }));
app.get('/api/public/colmena-ss-plans', (req, res) => res.json({ success: true, plans: saas.colmenaSSPlans() }));

app.post('/api/auth/register', (req, res) => {
    const result = saas.register(req.body || {});
    return res.status(result.success ? 200 : 400).json(result);
});

app.post('/api/auth/login', (req, res) => {
    const result = saas.login(req.body || {});
    return res.status(result.success ? 200 : 401).json(result);
});

app.get('/api/auth/me', requireAuth, (req, res) => {
    const user = saas.findUserById(req.saasUser.sub);
    return res.status(user ? 200 : 404).json(user ? { success: true, user: saas.publicUser(user) } : { success: false, code: 'USER_NOT_FOUND' });
});

app.post('/api/auth/profile', requireAuth, (req, res) => {
    const updated = saas.updateProfile(req.saasUser.sub, req.body || {});
    if (!updated) return res.status(400).json({ success: false, code: 'PROFILE_UPDATE_BLOCKED', message: 'No se puede cambiar el Discord ID si ya tienes rol asignado.' });
    const validation = saas.validateUserProfile(updated);
    return res.status(validation.ok ? 200 : 400).json(validation.ok ? { success: true, user: saas.publicUser(updated) } : { success: false, code: validation.code, message: validation.message });
});

const resetRequest = (req) => ({
    ...(req.body || {}),
    ipAddress: req.ip || req.socket?.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || ''
});
app.post('/api/auth/forgot-password', (req, res) => res.json(saas.createReset(resetRequest(req))));
app.post('/api/auth/recover', (req, res) => res.json(saas.createReset(resetRequest(req))));
app.post('/api/auth/reset-password', (req, res) => {
    const result = saas.resetPassword(req.body || {});
    return res.status(result.success ? 200 : 400).json(result);
});
app.post('/api/auth/reset', (req, res) => {
    const result = saas.resetPassword(req.body || {});
    return res.status(result.success ? 200 : 400).json(result);
});

app.post('/api/colmena-ss/order-checkout', requireAuth, async (req, res) => {
    try {
        let result = await saas.createOrderCheckout({
            userId: req.saasUser.sub,
            plan: req.body.plan,
            notes: req.body.notes,
            profileUpdates: req.body.profileUpdates || {}
        });
        if (result.success && result.order?.payment_status === 'PAID') {
            result = await createOrderDiscordInvite(result);
        }
        return res.status(result.success ? 200 : 400).json(result);
    } catch (err) {
        appendLog('order_checkout_failed', err.message);
        return res.status(500).json({ success: false, code: 'ORDER_CHECKOUT_FAILED', message: err.message });
    }
});

app.get('/api/panel/dashboard', requireAuth, (req, res) => res.json(saas.dashboard(req.saasUser)));

app.post('/api/panel/support', requireAuth, (req, res) => {
    const ticket = {
        id: saas.id('sup'),
        userId: req.saasUser.sub,
        subject: req.body.subject || 'Soporte',
        message: req.body.message || '',
        status: 'open',
        created_at: new Date().toISOString()
    };
    const tickets = saas.readJson('saas_support_tickets.json');
    tickets.unshift(ticket);
    saas.writeJson('saas_support_tickets.json', tickets.slice(0, 1000));
    return res.json({ success: true, ticket });
});

app.post('/api/stripe/webhook', (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!saas.verifyStripeSignature(req.rawBody || Buffer.from(JSON.stringify(req.body || {})), signature)) {
        appendLog('stripe_signature_invalid', 'Stripe webhook signature invalid');
        return res.status(400).json({ success: false, code: 'STRIPE_SIGNATURE_INVALID' });
    }
    const result = saas.handleStripeEvent(req.body);
    if (result?.order?.payment_status === 'PAID') {
        createOrderDiscordInvite(result).catch(err => appendLog('order_invite_failed', err.message, { orderId: result.order.id }));
    }
    return res.json(result);
});

let discordClient = null;

const getGuild = async () => {
    if (!discordClient?.isReady()) return null;
    return process.env.DISCORD_GUILD_ID
        ? await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID).catch(() => null)
        : discordClient.guilds.cache.first();
};

const ensureRole = async (guild, name, color) => {
    let role = guild.roles.cache.find(r => r.name === name);
    if (!role) role = await guild.roles.create({ name, color, reason: 'COLMENA-SS production role' }).catch(() => null);
    return role;
};

const orderRoleName = (plan) => plan === 'MONTHLY_SERVER' ? 'SERVIDOR_VERIFICADO' : 'CLIENTE_SCANER';

const resolveOrderRole = async (guild, plan) => {
    if (plan === 'SCANER' && process.env.ROLE_CLIENTE_SCANER_ID) return guild.roles.cache.get(process.env.ROLE_CLIENTE_SCANER_ID) || null;
    if (plan === 'MONTHLY_SERVER' && process.env.ROLE_SERVIDOR_VERIFICADO_ID) return guild.roles.cache.get(process.env.ROLE_SERVIDOR_VERIFICADO_ID) || null;
    return ensureRole(guild, orderRoleName(plan), plan === 'MONTHLY_SERVER' ? '#d6b35a' : '#22c55e');
};

const logBotChannel = async (guild, message) => {
    appendLog('discord_bot_log', message);
    const channel = guild?.channels.cache.find(c => c.type === ChannelType.GuildText && c.name.includes('logs-bot'));
    if (channel) await channel.send(message).catch(() => {});
};

const createOrderDiscordInvite = async (orderActivation) => {
    const result = { invite: null, errors: [] };
    const order = orderActivation?.order;
    if (!order) return { ...orderActivation, discord: result };
    const guild = await getGuild();
    if (!guild) {
        result.errors.push('BOT_DISCONNECTED_OR_GUILD_NOT_FOUND');
        return { ...orderActivation, discord: result };
    }
    await ensureRole(guild, 'CLIENTE_SCANER', '#22c55e');
    await ensureRole(guild, 'SERVIDOR_VERIFICADO', '#d6b35a');
    await ensureRole(guild, 'SIN_VERIFICAR', '#64748b');
    const inviteChannel =
        (process.env.DISCORD_INVITE_CHANNEL_ID ? guild.channels.cache.get(process.env.DISCORD_INVITE_CHANNEL_ID) : null) ||
        guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name.includes('solicitar-escaneo')) ||
        guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name.includes('bienvenida')) ||
        guild.channels.cache.find(c => c.type === ChannelType.GuildText);
    if (!inviteChannel) {
        result.errors.push('INVITE_CHANNEL_NOT_FOUND');
        return { ...orderActivation, discord: result };
    }
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const invite = await inviteChannel.createInvite({ maxAge: 7 * 24 * 60 * 60, maxUses: 1, unique: true, reason: `COLMENA-SS order ${order.id}` }).catch(err => {
        result.errors.push(err.message);
        return null;
    });
    if (!invite) return { ...orderActivation, discord: result };
    const updated = saas.saveOrderInvite(order.id, { inviteCode: invite.code, inviteUrl: invite.url, expiresAt });
    result.invite = { invite_code: invite.code, invite_url: invite.url, expires_at: expiresAt };
    const user = saas.findUserById(order.user_id);
    if (user) {
        saas.queueColmenaSSEmail({
            customer: { email: user.email },
            plan: { label: order.plan },
            subject: 'Acceso COLMENA-SS activado',
            body: [
                `Gracias por contratar COLMENA-SS, ${user.full_name}.`,
                `Plan contratado: ${order.plan}.`,
                `Enlace unico Discord: ${invite.url}`,
                `Recuerda entrar con este Discord ID: ${user.discord_id}.`,
                'Una vez dentro, el bot verificara tu pedido y asignara el rol correspondiente.'
            ].join('\n')
        });
    }
    appendLog('discord_invite_created', `Invitacion creada para pedido ${order.id}`, { orderId: order.id });
    return { ...orderActivation, order: updated || order, discord: result };
};

const ownerMessage = (order, user, roleName) => [
    '🛒 NUEVO CLIENTE VERIFICADO COLMENA-SS',
    '',
    `Cliente: ${user.full_name}`,
    `Email: ${user.email}`,
    `Discord: <@${user.discord_id}>`,
    `Discord ID: ${user.discord_id}`,
    `Servidor: ${user.server_name}`,
    `Discord del servidor: ${user.server_discord_invite}`,
    `Plan contratado: ${order.plan}`,
    `Importe: ${order.amount} ${order.currency}`,
    'Estado: PAGADO',
    `Rol asignado: ${roleName}`,
    `Fecha: ${order.created_at}`,
    '',
    'Acción:',
    'Usuario registrado en web, compra verificada y rol asignado automáticamente al entrar al Discord.'
].join('\n');

const clientMessage = (plan) => plan === 'MONTHLY_SERVER'
    ? 'Bienvenido a COLMENA-SS.\n\nTu servidor ha sido verificado mediante contratación mensual.\nYa tienes acceso a los canales de cliente, soporte y solicitudes.'
    : 'Bienvenido a COLMENA-SS.\n\nTu contratación por escáner individual ha sido verificada.\nYa tienes acceso para solicitar tu escaneo desde el canal correspondiente.';

const provisionMember = async (member, order) => {
    const user = saas.findUserById(order.user_id);
    if (!user || String(user.discord_id) !== String(member.id) || order.payment_status !== 'PAID') return order;
    const roleName = orderRoleName(order.plan);
    const role = await resolveOrderRole(member.guild, order.plan);
    let roleAssigned = false;
    if (role && !member.roles.cache.has(role.id)) await member.roles.add(role, `COLMENA-SS order ${order.id}`).catch(err => logBotChannel(member.guild, `Error asignando rol: ${err.message}`));
    if (role) roleAssigned = member.roles.cache.has(role.id);
    let ownerNotified = Boolean(order.owner_notified);
    const owner = process.env.DISCORD_OWNER_ID
        ? await discordClient.users.fetch(process.env.DISCORD_OWNER_ID).catch(() => null)
        : await member.guild.fetchOwner().catch(() => null);
    if (owner && !ownerNotified) {
        await owner.send(ownerMessage(order, user, roleName)).then(() => { ownerNotified = true; }).catch(err => logBotChannel(member.guild, `No se pudo enviar DM al owner: ${err.message}`));
    }
    await member.send(clientMessage(order.plan)).catch(() => {});
    const updated = saas.markOrderDiscordProvisioned(order.id, { roleAssigned, ownerNotified });
    await logBotChannel(member.guild, `Pedido COLMENA-SS vinculado: ${order.id} · ${user.discord_id} · ${order.plan} · rol=${roleName}`);
    return updated || order;
};

const startDiscordBot = async () => {
    const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
    if (!token) {
        console.warn('[DISCORD] No token configured. Bot disabled.');
        return;
    }
    const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
    if (process.env.DISCORD_ENABLE_GUILD_MEMBERS !== 'false') intents.push(GatewayIntentBits.GuildMembers);
    if (process.env.DISCORD_ENABLE_MESSAGE_CONTENT === 'true') intents.push(GatewayIntentBits.MessageContent);
    discordClient = new Client({ intents, partials: [Partials.Channel] });
    discordClient.once('ready', async () => {
        console.log(`[DISCORD] Ready as ${discordClient.user.tag}`);
        const guild = await getGuild();
        if (guild) {
            await guild.commands.set([
                { name: 'buscar_pedido', description: 'Busca un pedido COLMENA-SS por Discord ID', options: [{ name: 'discord_id', description: 'Discord ID', type: 3, required: true }] },
                { name: 'reasignar_rol', description: 'Reasigna el rol COLMENA-SS correcto', options: [{ name: 'discord_id', description: 'Discord ID', type: 3, required: true }] }
            ]).catch(err => console.warn(`[DISCORD] Slash commands failed: ${err.message}`));
        }
    });
    discordClient.on('guildMemberAdd', async member => {
        const order = saas.findPaidOrderByDiscordId(member.id);
        if (order) {
            await provisionMember(member, order);
            return;
        }
        const sinVerificar = (process.env.ROLE_SIN_VERIFICAR_ID ? member.guild.roles.cache.get(process.env.ROLE_SIN_VERIFICAR_ID) : null) ||
            member.guild.roles.cache.find(r => r.name === 'SIN_VERIFICAR');
        if (sinVerificar) await member.roles.add(sinVerificar, 'Sin compra activa COLMENA-SS').catch(() => {});
        await member.send('No hemos encontrado una compra activa asociada a tu Discord ID.\nRevisa tu perfil web o contacta con soporte.').catch(() => {});
        await logBotChannel(member.guild, `Entrada sin compra activa: ${member.user.tag} (${member.id}).`);
    });
    discordClient.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand?.()) return;
        const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator) || interaction.guild?.ownerId === interaction.member?.id;
        if (!isAdmin) return interaction.reply({ content: 'Permiso denegado.', ephemeral: true });
        const discordId = interaction.options.getString('discord_id', true);
        const order = saas.findLatestPaidOrderByDiscordId(discordId, { includeAssigned: true });
        const user = saas.findUserByDiscordId(discordId);
        if (interaction.commandName === 'buscar_pedido') {
            if (!order) return interaction.reply({ content: `No hay pedido pagado para Discord ID ${discordId}.`, ephemeral: true });
            return interaction.reply({
                content: [
                    `Cliente: ${user?.full_name || 'Sin perfil'}`,
                    `Email: ${user?.email || 'Sin email'}`,
                    `Servidor: ${user?.server_name || 'Sin servidor'}`,
                    `Plan: ${order.plan}`,
                    `Pago: ${order.payment_status}`,
                    `Rol asignado: ${order.role_assigned ? 'SI' : 'NO'}`,
                    `Fecha: ${order.created_at}`
                ].join('\n'),
                ephemeral: true
            });
        }
        if (interaction.commandName === 'reasignar_rol') {
            if (!order) return interaction.reply({ content: `No hay pedido pagado para Discord ID ${discordId}.`, ephemeral: true });
            const member = await interaction.guild.members.fetch(discordId).catch(() => null);
            if (!member) return interaction.reply({ content: 'Pedido encontrado, pero el usuario no esta en este Discord.', ephemeral: true });
            const updated = await provisionMember(member, order);
            return interaction.reply({ content: `Rol reasignado. Pedido ${updated.id}. Rol asignado: ${updated.role_assigned ? 'SI' : 'NO'}.`, ephemeral: true });
        }
    });
    discordClient.login(token).catch(err => console.error(`[DISCORD] Login error: ${err.message}`));
};

app.listen(PORT, () => {
    console.log(`[COLMENA] Production server listening on ${PORT}`);
    console.log(`[COLMENA] Public URL: ${APP_URL}`);
});

startDiscordBot();
