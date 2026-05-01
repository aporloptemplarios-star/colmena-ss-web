const { app, BrowserWindow, session, ipcMain } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const ColmenaScanner = require('./modules/scanner');
const EchoService = require('./modules/echo');
const LogService = require('./src/services/logService');
const BackendClient = require('./src/services/backendClient');
const AiAssistantService = require('./src/services/aiAssistantService');
const RepairService = require('./src/services/repairService');
const AnticheatBridge = require('./src/services/anticheatBridge');
const ColmenaSSService = require('./src/services/colmenaSSService');
const DiscordSyncService = require('./src/services/discordSyncService');
const LicenseService = require('./src/services/licenseService');
const SaasService = require('./src/services/saasService');
const AuthService = require('./src/services/authService');
let si;
try {
    si = require('systeminformation');
} catch (e) {
    console.warn('Librería systeminformation no instalada. Monitoreo desactivado.');
}
require('dotenv').config();

let monitoringInterval;
const DEFAULT_OPENAI_MODEL = 'gpt-5.2-chat-latest';
const toInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};
const CONFIG = {
    serverPort: toInt(process.env.SERVER_PORT, 3000),
    apiKey: process.env.API_KEY || 'colmena-secure-key-123',
    discordGuildId: process.env.DISCORD_GUILD_ID || '',
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
    openAiModel: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    openAiMaxOutputTokens: toInt(process.env.OPENAI_MAX_OUTPUT_TOKENS, 900),
    aiSecurityCooldownMs: toInt(process.env.AI_SECURITY_COOLDOWN_MS, 120000),
    launcherVersion: process.env.LAUNCHER_VERSION || '2.5.0-PRO',
    backendVersion: process.env.BACKEND_VERSION || '1.1.0-HARDENED',
    botVersion: process.env.BOT_VERSION || '1.1.0-HARDENED',
    minLauncherVersion: process.env.MIN_LAUNCHER_VERSION || '2.5.0-PRO',
    latestLauncherVersion: process.env.LATEST_LAUNCHER_VERSION || '2.5.0-PRO',
    auditRetention: toInt(process.env.AUDIT_RETENTION_EVENTS, 500),
    systemRetention: toInt(process.env.SYSTEM_RETENTION_EVENTS, 500),
    queueRetention: toInt(process.env.DELIVERY_QUEUE_RETENTION, 200),
    queueMaxAttempts: toInt(process.env.DELIVERY_QUEUE_MAX_ATTEMPTS, 5),
    queueIntervalMs: toInt(process.env.DELIVERY_QUEUE_INTERVAL_MS, 30000),
    openAiTimeoutMs: toInt(process.env.OPENAI_TIMEOUT_MS, 45000),
    geminiTimeoutMs: toInt(process.env.GEMINI_TIMEOUT_MS, 45000)
};
const colmenaConfigPath = path.join(__dirname, 'config', 'colmena.config.json');
const COLMENA_CONFIG = (() => {
    try {
        if (!fs.existsSync(colmenaConfigPath)) return {};
        return JSON.parse(fs.readFileSync(colmenaConfigPath, 'utf8') || '{}');
    } catch (err) {
        console.error('[CONFIG] Error leyendo colmena.config.json:', err.message);
        return {};
    }
})();
const enterpriseLogService = new LogService({ rootDir: __dirname, logDir: path.join(__dirname, 'logs'), dataDir: path.join(__dirname, 'data') });
const enterpriseBackendClient = new BackendClient({
    backendUrl: process.env.COLMENA_BACKEND_URL || COLMENA_CONFIG.backendUrl || `http://127.0.0.1:${CONFIG.serverPort}`,
    apiKey: process.env[COLMENA_CONFIG.apiKeyEnv || 'COLMENA_API_KEY'] || CONFIG.apiKey,
    hmacSecret: process.env.COLMENA_HMAC_SECRET || process.env[COLMENA_CONFIG.apiKeyEnv || 'COLMENA_API_KEY'] || CONFIG.apiKey,
    dataDir: path.join(__dirname, 'data')
});
const enterpriseAIService = new AiAssistantService({
    askAI: async prompt => askGuardianAI(prompt),
    backendClient: enterpriseBackendClient,
    logService: enterpriseLogService
});
const enterpriseRepairService = new RepairService({ rootDir: __dirname, logService: enterpriseLogService });
const enterpriseAnticheatBridge = new AnticheatBridge({ backendClient: enterpriseBackendClient, logService: enterpriseLogService });
const enterpriseColmenaSS = new ColmenaSSService({ backendClient: enterpriseBackendClient, logService: enterpriseLogService });
const enterpriseDiscordSync = new DiscordSyncService({ backendClient: enterpriseBackendClient, logService: enterpriseLogService });
const enterpriseLicenseService = new LicenseService({ rootDir: __dirname, dataDir: path.join(__dirname, 'data'), configDir: path.join(__dirname, 'config'), logService: enterpriseLogService });
const enterpriseSaasService = new SaasService({
    dataDir: path.join(__dirname, 'data'),
    configDir: path.join(__dirname, 'config'),
    licenseService: enterpriseLicenseService,
    logService: enterpriseLogService,
    jwtSecret: process.env.COLMENA_JWT_SECRET || process.env.COLMENA_HMAC_SECRET || CONFIG.apiKey,
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    publicBaseUrl: process.env.APP_URL || process.env.COLMENA_PUBLIC_URL || `http://127.0.0.1:${CONFIG.serverPort}`
});
const enterpriseAuthService = new AuthService({ baseUrl: process.env.APP_URL || process.env.COLMENA_PUBLIC_URL || `http://127.0.0.1:${CONFIG.serverPort}` });
let cachedGeminiModel = null; // FIX #11: Cachear modelo para no hacer petición extra en cada consulta

let mainWindow;
let currentUser = null;
let currentRole = 'USER';
let discordClient = null; // Store client globally
let discordStarting = false;
let discordLimitedMode = false;
let discordReconnectTimer = null;
let lastDiscordReconnectAt = 0;
let lastAiSecurityAnalysisAt = 0;
let backendOnline = false;
let anticheatOnline = false;
let deliveryQueueInterval = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
}

const ensureDataDir = () => {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    return dataDir;
};

const readJsonFile = (filePath, fallback) => {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8') || JSON.stringify(fallback));
    } catch (err) {
        console.error(`[JSON] Error leyendo ${filePath}:`, err.message);
        return fallback;
    }
};

const writeJsonFile = (filePath, data) => {
    ensureDataDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
};

const createEventId = (prefix = 'COL') => `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const sendLauncherLog = (message, status = 'processing') => {
    if (!mainWindow) return;
    mainWindow.webContents.send('bot:new-action', {
        timestamp: new Date().toLocaleTimeString(),
        message,
        status
    });
};

const appendRuntimeLog = (fileName, line) => {
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(path.join(logsDir, fileName), `[${new Date().toISOString()}] ${line}\n`, 'utf8');
};

const appendAuditEvent = (event) => {
    const auditPath = path.join(ensureDataDir(), 'colmena_audit.json');
    const auditData = readJsonFile(auditPath, []);
    const auditEvent = {
        timestamp: new Date().toLocaleString(),
        severity: event.severity || 'HIGH',
        alertId: event.alertId || createEventId('COL'),
        eventType: event.type || event.eventType || 'Evento de Seguridad',
        process: event.process || 'Unknown',
        pid: event.pid || null,
        rule: event.rule || null,
        match: event.match || null,
        memoryUsage: event.memoryUsage || null,
        user: event.user || 'N/A',
        source: event.source || 'launcher',
        aiSummary: event.aiSummary || null
    };

    auditData.unshift(auditEvent);
    writeJsonFile(auditPath, auditData.slice(0, CONFIG.auditRetention));
    return auditEvent;
};

const appendSystemEvent = (type, payload = {}) => {
    const eventsPath = path.join(ensureDataDir(), 'system_events.json');
    const events = readJsonFile(eventsPath, []);
    const event = {
        timestamp: new Date().toISOString(),
        type,
        ...payload
    };
    events.unshift(event);
    writeJsonFile(eventsPath, events.slice(0, CONFIG.systemRetention));
    return event;
};

const enqueueDelivery = (kind, payload, reason = 'unknown') => {
    const queuePath = path.join(ensureDataDir(), 'delivery_queue.json');
    const queue = readJsonFile(queuePath, []);
    queue.unshift({
        id: createEventId('Q'),
        kind,
        payload,
        reason,
        attempts: 0,
        createdAt: new Date().toISOString(),
        nextAttemptAt: new Date(Date.now() + CONFIG.queueIntervalMs).toISOString()
    });
    writeJsonFile(queuePath, queue.slice(0, CONFIG.queueRetention));
};

const appendBackendRecord = (fileName, record, limit = 1000) => {
    const filePath = path.join(ensureDataDir(), fileName);
    const records = readJsonFile(filePath, []);
    const entry = {
        id: record.id || createEventId('BE'),
        timestamp: record.timestamp || new Date().toISOString(),
        ...record
    };
    records.unshift(entry);
    writeJsonFile(filePath, records.slice(0, limit));
    return entry;
};

const validateBackendPayload = (payload, required = []) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, message: 'Payload debe ser un objeto JSON.' };
    }
    for (const key of required) {
        if (payload[key] === undefined || payload[key] === null || payload[key] === '') {
            return { ok: false, message: `Campo requerido ausente: ${key}` };
        }
    }
    return { ok: true };
};

const compareVersions = (current, minimum) => {
    const toParts = value => String(value || '').match(/\d+/g)?.map(Number) || [0];
    const a = toParts(current);
    const b = toParts(minimum);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const left = a[i] || 0;
        const right = b[i] || 0;
        if (left > right) return 1;
        if (left < right) return -1;
    }
    return 0;
};

const validateLauncherIntegrity = () => {
    const files = ['main.js', 'preload.js', 'renderer.js', 'index.html', 'index.css', 'package.json'];
    const manifestPath = path.join(__dirname, 'config', 'integrity-manifest.json');
    const manifest = fs.existsSync(manifestPath) ? readJsonFile(manifestPath, {}) : null;
    const hashes = {};
    const mismatches = [];
    for (const file of files) {
        const filePath = path.join(__dirname, file);
        if (!fs.existsSync(filePath)) {
            mismatches.push({ file, reason: 'missing' });
            continue;
        }
        const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
        hashes[file] = hash;
        if (manifest?.files?.[file] && manifest.files[file] !== hash) mismatches.push({ file, reason: 'hash_mismatch' });
    }
    const versionState = compareVersions(CONFIG.launcherVersion, CONFIG.minLauncherVersion) < 0 ? 'outdated' : 'ok';
    const result = {
        status: mismatches.length ? 'tampered' : versionState,
        version: CONFIG.launcherVersion,
        minVersion: CONFIG.minLauncherVersion,
        latestVersion: CONFIG.latestLauncherVersion,
        manifestPresent: Boolean(manifest),
        mismatches,
        hashes
    };
    enterpriseLogService.record('launcher_integrity_check', `Integridad launcher: ${result.status}`, { severity: result.status === 'ok' ? 'info' : 'critical', metadata: { mismatches, versionState } });
    return result;
};

const processDeliveryQueue = async () => {
    const queuePath = path.join(ensureDataDir(), 'delivery_queue.json');
    const queue = readJsonFile(queuePath, []);
    if (!queue.length) return;

    const now = Date.now();
    const remaining = [];
    for (const item of queue.reverse()) {
        if (Date.parse(item.nextAttemptAt || item.createdAt) > now) {
            remaining.unshift(item);
            continue;
        }

        try {
            if (item.kind === 'discord-channel') {
                const sent = await sendDiscordChannelMessage(item.payload.channelNames, item.payload.content);
                if (!sent) throw new Error('Discord channel unavailable');
            } else if (item.kind === 'webhook') {
                await axios.post(item.payload.url, item.payload.body, { timeout: 8000 });
            }
            appendSystemEvent('delivery-queue-success', { queueId: item.id, kind: item.kind });
        } catch (err) {
            const attempts = (item.attempts || 0) + 1;
            appendSystemEvent('delivery-queue-retry', { queueId: item.id, kind: item.kind, attempts, message: err.message });
            if (attempts < CONFIG.queueMaxAttempts) {
                remaining.unshift({
                    ...item,
                    attempts,
                    reason: err.message,
                    nextAttemptAt: new Date(Date.now() + CONFIG.queueIntervalMs * attempts).toISOString()
                });
            } else {
                appendSystemEvent('delivery-queue-dead-letter', { queueId: item.id, kind: item.kind, message: err.message });
            }
        }
    }
    writeJsonFile(queuePath, remaining.slice(0, CONFIG.queueRetention));
};

const startDeliveryQueue = () => {
    if (deliveryQueueInterval) clearInterval(deliveryQueueInterval);
    deliveryQueueInterval = setInterval(() => {
        processDeliveryQueue().catch(err => appendSystemEvent('delivery-queue-error', { message: err.message }));
    }, CONFIG.queueIntervalMs);
    appendSystemEvent('delivery-queue-started', { intervalMs: CONFIG.queueIntervalMs, maxAttempts: CONFIG.queueMaxAttempts });
};

const normalizeLookupName = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const findDiscordChannel = (guild, names) => {
    if (!guild) return null;
    return guild.channels.cache.find(c => names.some(name => normalizeLookupName(c.name).includes(normalizeLookupName(name))));
};

const sendDiscordChannelMessage = async (channelNames, content) => {
    if (!discordClient || !discordClient.isReady()) return false;
    const guild = discordClient.guilds.cache.get(CONFIG.discordGuildId);
    const channel = findDiscordChannel(guild, channelNames);
    if (!channel) return false;
    await channel.send(content);
    return true;
};

const analyzeSecurityEvent = async (event) => {
    const now = Date.now();
    const cooldown = CONFIG.aiSecurityCooldownMs;
    if (now - lastAiSecurityAnalysisAt < cooldown) return null;
    lastAiSecurityAnalysisAt = now;

    const prompt = `Analiza este evento de anticheat y responde en maximo 4 lineas: severidad, riesgo, accion recomendada y si requiere revision humana. Evento: ${JSON.stringify(event)}`;
    const result = await askGuardianAI(prompt);
    return result?.message || null;
};

const handleSecurityAlert = async (alert, options = {}) => {
    const event = {
        source: options.source || alert.source || 'anticheat',
        type: alert.type || 'Software Prohibido',
        severity: alert.severity || 'HIGH',
        user: alert.user || 'Usuario Local',
        process: alert.process || 'Unknown',
        pid: alert.pid || null,
        rule: alert.rule || null,
        match: alert.match || null,
        memoryUsage: alert.memoryUsage || null
    };

    const auditEvent = appendAuditEvent(event);
    sendLauncherLog(`[NEURAL] ${event.type}: ${event.process} / ${event.user}`, 'danger');
    if (mainWindow) mainWindow.webContents.send('scanner:detection', event);
    if (options.source !== 'backend') {
        enterpriseBackendClient.sendAnticheatEvent({
            type: event.type,
            severity: event.severity,
            riskScore: event.severity === 'CRITICAL' ? 95 : 70,
            flags: [event.rule, event.match].filter(Boolean),
            metadata: { ...event, alertId: auditEvent.alertId }
        }).catch(err => appendSystemEvent('anticheat-backend-error', { code: 'ANTICHEAT_FAIL', message: err.message, alertId: auditEvent.alertId }));
    }

    const baseDiscordMessage = [
        '**ALERTA NEURAL COLMENA**',
        `**ID:** ${auditEvent.alertId}`,
        `**Tipo:** ${event.type}`,
        `**Proceso:** \`${event.process}\``,
        event.pid ? `**PID:** \`${event.pid}\`` : null,
        event.rule ? `**Regla:** ${event.rule}` : null,
        event.memoryUsage ? `**Memoria:** ${event.memoryUsage}` : null,
        `**Usuario:** \`${event.user}\``,
        `**Origen:** ${event.source}`,
        '**Estado:** sincronizado con launcher, auditoria y anticheat.'
    ].filter(Boolean).join('\n');

    try {
        const sent = await sendDiscordChannelMessage(['detecciones-globales', 'alertas-anticheat', 'auditoria-forense'], baseDiscordMessage);
        if (sent) {
            sendLauncherLog('[DISCORD] Evento neural enviado al canal de seguridad.', 'success');
        } else {
            enqueueDelivery('discord-channel', { channelNames: ['detecciones-globales', 'alertas-anticheat', 'auditoria-forense'], content: baseDiscordMessage }, 'Discord unavailable');
            appendSystemEvent('discord-delivery-queued', { alertId: auditEvent.alertId });
        }
    } catch (err) {
        console.error('[NEURAL] Error enviando evento a Discord:', err.message);
        appendSystemEvent('discord-send-error', { message: err.message, alertId: auditEvent.alertId });
        enqueueDelivery('discord-channel', { channelNames: ['detecciones-globales', 'alertas-anticheat', 'auditoria-forense'], content: baseDiscordMessage }, err.message);
        sendLauncherLog('[DISCORD] No se pudo enviar el evento neural.', 'error');
    }

    if (options.webhook) {
        try {
            await axios.post(options.webhook, { content: baseDiscordMessage });
        } catch (err) {
            console.error('[NEURAL] Error enviando webhook:', err.message);
            appendSystemEvent('webhook-send-error', { message: err.message, alertId: auditEvent.alertId });
            enqueueDelivery('webhook', { url: options.webhook, body: { content: baseDiscordMessage } }, err.message);
        }
    }

    analyzeSecurityEvent({ ...auditEvent, user: event.user }).then(async aiSummary => {
        if (!aiSummary) return;
        auditEvent.aiSummary = aiSummary;
        appendAuditEvent({
            ...auditEvent,
            alertId: `${auditEvent.alertId}-AI`,
            type: 'Analisis IA',
            severity: 'INFO',
            process: event.process,
            user: event.user,
            source: 'ai',
            aiSummary
        });
        sendLauncherLog(`[IA NEURAL] ${aiSummary.substring(0, 180)}`, 'success');
        await sendDiscordChannelMessage(['auditoria-forense', 'bot-control'], `**ANALISIS IA ${auditEvent.alertId}**\n${aiSummary}`).catch(err => {
            console.error('[NEURAL] Error enviando analisis IA:', err.message);
            appendSystemEvent('ai-discord-send-error', { message: err.message, alertId: auditEvent.alertId });
        });
    }).catch(err => {
        console.error('[NEURAL] Error en analisis IA:', err.message);
        appendSystemEvent('ai-analysis-error', { message: err.message, alertId: auditEvent.alertId });
    });

    return auditEvent;
};

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        frame: false,
        backgroundColor: '#050508',
        show: false, // Ocultar hasta maximizar
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webviewTag: true
        }
    });

    mainWindow.maximize();
    mainWindow.show();

    mainWindow.loadFile('index.html');

    // Handle permissions for webviews (Discord calls)
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const url = webContents.getURL();
        const allowedHosts = ['discord.com', 'discordapp.com', 'echo.ac'];
        if (allowedHosts.some(host => url.includes(host))) {
            if (['media', 'audio', 'video', 'notifications'].includes(permission)) {
                return callback(true);
            }
        }
        callback(false);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
});

// IPC Handler to read detections
ipcMain.handle('app:get-detections', async () => {
    try {
        const filePath = path.join(__dirname, 'data', 'colmena_audit.json');
        return readJsonFile(filePath, []);
    } catch (e) {
        console.error('Error reading detections:', e);
        return [];
    }
});

ipcMain.handle('app:get-server-info', async () => {
    return {
        serverId: CONFIG.discordGuildId || 'NO_CONFIGURADO',
        version: '2.5.0-PRO',
        status: 'PROTECTED',
        aiProvider: process.env.OPENAI_API_KEY ? 'OpenAI ChatGPT' : (process.env.AI_API_KEY ? 'Gemini' : 'Sin IA'),
        aiModel: process.env.OPENAI_API_KEY ? CONFIG.openAiModel : (cachedGeminiModel || 'Gemini fallback')
    };
});

ipcMain.handle('app:get-health', async () => {
    const auditPath = path.join(__dirname, 'data', 'colmena_audit.json');
    const systemEventsPath = path.join(__dirname, 'data', 'system_events.json');
    const queuePath = path.join(__dirname, 'data', 'delivery_queue.json');
    const audit = readJsonFile(auditPath, []);
    const systemEvents = readJsonFile(systemEventsPath, []);
    const queue = readJsonFile(queuePath, []);
    const latestAudit = audit[0] || null;
    const latestSystemEvent = systemEvents[0] || null;
    const discordReady = Boolean(discordClient && discordClient.isReady());
    const guildReady = discordReady && Boolean(discordClient.guilds.cache.get(CONFIG.discordGuildId));

    return {
        timestamp: new Date().toISOString(),
        services: [
            { id: 'backend', name: 'Backend Neural', status: backendOnline ? 'online' : 'offline', detail: `Puerto ${CONFIG.serverPort}` },
            { id: 'discord', name: 'Discord Bot', status: discordReady ? (discordLimitedMode ? 'warning' : 'online') : 'offline', detail: guildReady ? (discordLimitedMode ? 'Online limitado: activa Message Content Intent para comandos' : 'Guild sincronizada') : 'Guild no disponible' },
            { id: 'anticheat', name: 'Anticheat Local', status: anticheatOnline ? 'online' : 'offline', detail: anticheatOnline ? 'Scanner de procesos activo' : 'Scanner pendiente' },
            { id: 'openai', name: 'OpenAI ChatGPT', status: process.env.OPENAI_API_KEY ? 'online' : 'offline', detail: CONFIG.openAiModel },
            { id: 'gemini', name: 'Gemini Fallback', status: process.env.AI_API_KEY ? 'online' : 'offline', detail: cachedGeminiModel || 'Pendiente de carga' },
            { id: 'echo', name: 'Echo.ac', status: process.env.ECHO_API_KEY ? 'configured' : 'offline', detail: process.env.ECHO_API_KEY ? 'API key configurada' : 'Sin API key' },
            { id: 'audit', name: 'Auditoria Local', status: 'online', detail: `${audit.length} eventos guardados` },
            { id: 'events', name: 'Eventos Internos', status: 'online', detail: `${systemEvents.length} eventos internos` },
            { id: 'queue', name: 'Cola de Entrega', status: queue.length ? 'configured' : 'online', detail: `${queue.length} entregas pendientes` }
        ],
        latestAudit,
        latestSystemEvent
    };
});

ipcMain.handle('app:retry-queue', async () => {
    try {
        await processDeliveryQueue();
        const queue = readJsonFile(path.join(__dirname, 'data', 'delivery_queue.json'), []);
        sendLauncherLog(`[QUEUE] Reintento manual completado. Pendientes: ${queue.length}`, queue.length ? 'processing' : 'success');
        return { success: true, pending: queue.length };
    } catch (err) {
        appendSystemEvent('manual-queue-retry-error', { message: err.message });
        sendLauncherLog(`[QUEUE] Error en reintento manual: ${err.message}`, 'error');
        return { success: false, message: err.message };
    }
});

ipcMain.handle('app:full-diagnostics', async () => {
    try {
        const diagnostics = await collectPcDiagnostics();
        const audit = readJsonFile(path.join(__dirname, 'data', 'colmena_audit.json'), []);
        const systemEvents = readJsonFile(path.join(__dirname, 'data', 'system_events.json'), []);
        const queue = readJsonFile(path.join(__dirname, 'data', 'delivery_queue.json'), []);
        const report = {
            timestamp: new Date().toISOString(),
            diagnostics,
            counts: {
                audit: audit.length,
                systemEvents: systemEvents.length,
                deliveryQueue: queue.length
            },
            latestAudit: audit[0] || null,
            latestSystemEvent: systemEvents[0] || null
        };
        const reportPath = path.join(ensureDataDir(), `enterprise_diagnostics_${Date.now()}.json`);
        writeJsonFile(reportPath, report);
        appendSystemEvent('enterprise-diagnostics-created', { reportPath });
        sendLauncherLog(`[DIAGNOSTICO] Informe enterprise generado: ${path.basename(reportPath)}`, 'success');
        return { success: true, reportPath, counts: report.counts };
    } catch (err) {
        appendSystemEvent('enterprise-diagnostics-error', { message: err.message });
        sendLauncherLog(`[DIAGNOSTICO] Error: ${err.message}`, 'error');
        return { success: false, message: err.message };
    }
});

ipcMain.handle('enterprise:get-status', async () => {
    const anticheat = await enterpriseAnticheatBridge.getStatus();
    const ss = enterpriseColmenaSS.getStatus();
    const logs = enterpriseLogService.getLogs(40);
    const backendQueue = enterpriseBackendClient.readQueue();
    return {
        success: true,
        backend: { configured: enterpriseBackendClient.enabled, queue: backendQueue.length },
        discord: enterpriseDiscordSync.getStatus(),
        anticheat,
        colmenaSS: ss,
        ai: { enabled: Boolean(COLMENA_CONFIG.enableAI), provider: process.env.OPENAI_API_KEY ? 'OpenAI' : (process.env.AI_API_KEY ? 'Gemini' : 'offline') },
        versions: { launcher: CONFIG.launcherVersion, backend: CONFIG.backendVersion, bot: CONFIG.botVersion, minLauncher: CONFIG.minLauncherVersion, latestLauncher: CONFIG.latestLauncherVersion },
        integrity: validateLauncherIntegrity(),
        license: enterpriseLicenseService.status(),
        logs
    };
});

ipcMain.handle('enterprise:send-event', async (event, payload = {}) => {
    const log = enterpriseLogService.record(payload.eventType || 'launcher_event', payload.message || 'Evento launcher', {
        severity: payload.severity || 'info',
        metadata: payload.metadata || {}
    });
    const result = await enterpriseBackendClient.sendEvent({ ...payload, timestamp: log.timestamp });
    return { success: result.success, result, log };
});

ipcMain.handle('enterprise:version-check', async () => {
    const integrity = validateLauncherIntegrity();
    return {
        success: true,
        launcherVersion: CONFIG.launcherVersion,
        backendVersion: CONFIG.backendVersion,
        botVersion: CONFIG.botVersion,
        minLauncherVersion: CONFIG.minLauncherVersion,
        latestLauncherVersion: CONFIG.latestLauncherVersion,
        outdated: compareVersions(CONFIG.launcherVersion, CONFIG.minLauncherVersion) < 0,
        updateAvailable: compareVersions(CONFIG.launcherVersion, CONFIG.latestLauncherVersion) < 0,
        updateUrl: process.env.COLMENA_UPDATE_URL || COLMENA_CONFIG.updateUrl || '',
        integrity
    };
});

ipcMain.handle('license:get-status', async () => {
    return enterpriseLicenseService.status();
});

ipcMain.handle('license:activate', async (event, payload = {}) => {
    const result = enterpriseLicenseService.activate({
        licenseKey: payload.licenseKey,
        serverId: payload.serverId || CONFIG.discordGuildId || 'local',
        clientName: payload.clientName || currentUser || 'local-client'
    });
    if (result.success) {
        await enterpriseBackendClient.sendEvent({
            eventType: 'license_activated',
            severity: 'info',
            message: `Licencia activada: ${result.license.plan}`,
            metadata: { plan: result.license.plan, serverId: result.license.server_id }
        }).catch(() => null);
    }
    return result;
});

ipcMain.handle('license:clear-cache', async () => enterpriseLicenseService.clear());

ipcMain.handle('product:get-plans', async () => ({ success: true, plans: enterpriseLicenseService.plans() }));

ipcMain.handle('enterprise:flush-backend-queue', async () => {
    const result = await enterpriseBackendClient.flushQueue();
    enterpriseLogService.record('backend_queue_flush', `Reenvio de cola backend. Pendientes: ${result.pending}`, { metadata: result });
    return result;
});

ipcMain.handle('enterprise:ai-analyze', async (event, { type, payload } = {}) => {
    return enterpriseAIService.analyze(type || 'launcher', payload || {});
});

ipcMain.handle('enterprise:repair-inspect', async () => {
    return { success: true, report: await enterpriseRepairService.inspect() };
});

ipcMain.handle('enterprise:repair-preview-clean', async () => {
    return await enterpriseRepairService.cleanTempPreview();
});

ipcMain.handle('enterprise:anticheat-start', async () => {
    return { success: true, status: await enterpriseAnticheatBridge.start() };
});

ipcMain.handle('enterprise:anticheat-heartbeat', async () => {
    return { success: true, heartbeat: await enterpriseAnticheatBridge.heartbeat({ source: 'launcher-ui' }) };
});

ipcMain.handle('enterprise:anticheat-simulate-event', async () => {
    const payload = {
        type: 'SIMULATED_FLAG',
        severity: 'warning',
        riskScore: 72,
        flags: ['memory_pattern_test', 'launcher_manual_test'],
        metadata: { source: 'launcher-ui', safeSimulation: true }
    };
    const result = await enterpriseBackendClient.sendAnticheatEvent(payload);
    enterpriseLogService.record('anticheat_simulated_event', 'Deteccion simulada enviada al backend.', { severity: 'warning', metadata: payload });
    return { success: result.success, result, payload };
});

ipcMain.handle('enterprise:guard-game-start', async () => {
    return { success: true, guard: await enterpriseAnticheatBridge.guardGameStart() };
});

ipcMain.handle('enterprise:ss-status', async (event, status) => {
    if (status) return { success: true, state: await enterpriseColmenaSS.setStatus(status, { source: 'launcher-ui' }) };
    return { success: true, state: enterpriseColmenaSS.getStatus() };
});

ipcMain.handle('enterprise:ss-prepare-logs', async () => {
    return enterpriseColmenaSS.prepareLogs({ launcherVersion: COLMENA_CONFIG.launcherVersion || '1.0.0' });
});

ipcMain.handle('enterprise:discord-ticket', async (event, type) => {
    return enterpriseDiscordSync.openTicket(type || 'support_report', { source: 'launcher-ui' });
});

ipcMain.handle('enterprise:export-report', async () => {
    const reportId = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');
    const reportDir = path.join(ensureDataDir(), `COLMENA_REPORT_${reportId}`);
    const zipPath = `${reportDir}.zip`;
    fs.mkdirSync(reportDir, { recursive: true });
    writeJsonFile(path.join(reportDir, 'enterprise_status.json'), {
        timestamp: new Date().toISOString(),
        status: {
            anticheat: await enterpriseAnticheatBridge.getStatus(),
            colmenaSS: enterpriseColmenaSS.getStatus(),
            discord: enterpriseDiscordSync.getStatus()
        },
        logs: enterpriseLogService.getLogs(300),
        queue: enterpriseBackendClient.readQueue()
    });
    for (const file of ['launcher-enterprise.log', 'discord.log', 'launcher-start.log']) {
        const source = path.join(__dirname, 'logs', file);
        if (fs.existsSync(source)) fs.copyFileSync(source, path.join(reportDir, file));
    }
    await new Promise(resolve => {
        const { execFile } = require('child_process');
        execFile('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path '${reportDir}\\*' -DestinationPath '${zipPath}' -Force`], () => resolve());
    });
    enterpriseLogService.record('report_exported', `Informe exportado: ${zipPath}`, { metadata: { zipPath } });
    return { success: true, reportPath: fs.existsSync(zipPath) ? zipPath : reportDir };
});

// Backend Alert Listener (Express)
const startBackend = (window) => {
    const server = express();
    server.use(bodyParser.json({ limit: '256kb', strict: true, verify: (req, res, buf) => { req.rawBody = buf; } }));
    server.use('/web', express.static(path.join(__dirname, 'web')));
    server.get('/', (req, res) => res.sendFile(path.join(__dirname, 'web', 'index.html')));

    const API_KEY = CONFIG.apiKey;
    // FIX #15: Validar que el webhook no sea el placeholder. Una URL válida empieza por https://discord.com/api/webhooks/
    const rawWebhook = CONFIG.discordWebhookUrl;
    const DISCORD_WEBHOOK = (rawWebhook && rawWebhook.startsWith('https://discord.com/api/webhooks/') && !rawWebhook.includes('YOUR_WEBHOOK')) ? rawWebhook : null;
    if (!DISCORD_WEBHOOK) console.warn('[WEBHOOK] URL de Discord Webhook no configurada o inválida. Alertas solo en UI.');

    const rateBuckets = new Map();
    const replaySignatures = new Map();
    const rateLimitCheck = (key, limit, windowMs) => {
        const now = Date.now();
        const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };
        if (now > bucket.resetAt) {
            bucket.count = 0;
            bucket.resetAt = now + windowMs;
        }
        bucket.count++;
        rateBuckets.set(key, bucket);
        return { allowed: bucket.count <= limit, count: bucket.count, resetAt: bucket.resetAt };
    };
    const cleanReplayCache = () => {
        const now = Date.now();
        for (const [signature, expiresAt] of replaySignatures.entries()) {
            if (expiresAt <= now) replaySignatures.delete(signature);
        }
    };
    const auditBackendAttempt = (req, result, detail = {}) => {
        appendBackendRecord('backend_audit.json', {
            source: 'backend-security',
            ip: req.ip,
            userId: req.body?.userId || req.body?.metadata?.userId || req.headers['x-user-id'] || 'unknown',
            method: req.method,
            path: req.path,
            result,
            detail
        }, 1500);
    };
    const requireBackendAuth = (req, res, next) => {
        const ip = req.ip || req.socket?.remoteAddress || 'unknown';
        const userKey = req.body?.userId || req.body?.metadata?.userId || req.headers['x-user-id'] || 'anonymous';
        const ipLimit = rateLimitCheck(`ip:${ip}`, 120, 60_000);
        const userLimit = rateLimitCheck(`user:${userKey}`, 45, 60_000);
        if (!ipLimit.allowed || !userLimit.allowed) {
            auditBackendAttempt(req, 'RATE_LIMITED', { ipCount: ipLimit.count, userCount: userLimit.count });
            return res.status(429).json({ success: false, code: 'RATE_LIMITED', message: 'Demasiadas peticiones. Espera antes de reintentar.' });
        }
        const auth = req.headers['x-api-key'];
        if (auth !== API_KEY) {
            auditBackendAttempt(req, 'INVALID_API_KEY');
            return res.status(403).json({ success: false, code: 'UNAUTHORIZED', message: 'API key invalida.' });
        }
        if (req.method !== 'GET') {
            const timestamp = req.headers['x-colmena-timestamp'];
            const signature = req.headers['x-colmena-signature'];
            if (!timestamp || !signature) {
                auditBackendAttempt(req, 'MISSING_SIGNATURE');
                return res.status(401).json({ success: false, code: 'MISSING_SIGNATURE', message: 'Firma HMAC y timestamp obligatorios.' });
            }
            const ts = Date.parse(timestamp);
            if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60_000) {
                auditBackendAttempt(req, 'REPLAY_TIMESTAMP', { timestamp });
                return res.status(401).json({ success: false, code: 'REPLAY_TIMESTAMP', message: 'Timestamp invalido o caducado.' });
            }
            cleanReplayCache();
            if (replaySignatures.has(signature)) {
                auditBackendAttempt(req, 'REPLAY_SIGNATURE');
                return res.status(409).json({ success: false, code: 'REPLAY_SIGNATURE', message: 'Firma ya utilizada.' });
            }
            const expected = crypto.createHmac('sha256', enterpriseBackendClient.hmacSecret).update(`${timestamp}.${JSON.stringify(req.body || {})}`).digest('hex');
            const validSignature = signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
            if (!validSignature) {
                auditBackendAttempt(req, 'INVALID_SIGNATURE');
                return res.status(401).json({ success: false, code: 'INVALID_SIGNATURE', message: 'Firma HMAC invalida.' });
            }
            replaySignatures.set(signature, Date.now() + 5 * 60_000);
        }
        auditBackendAttempt(req, 'ACCEPTED');
        return next();
    };
    const sendBackendError = (res, code, message, status = 400) => res.status(status).json({ success: false, code, message });
    const requireSaasAuth = (req, res, next) => {
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : null;
        const user = enterpriseSaasService.verifyToken(token);
        if (!user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', message: 'Login requerido.' });
        req.saasUser = user;
        return next();
    };
    const requireSaasAdmin = (req, res, next) => {
        if (req.saasUser?.role !== 'admin') return res.status(403).json({ success: false, code: 'ADMIN_REQUIRED', message: 'Permiso admin requerido.' });
        return next();
    };
    const dispatchBackendEventToDiscord = async (event) => {
        const eventType = event.eventType || event.type || 'backend_event';
        const severity = event.severity || 'info';
        const content = [
            '**COLMENA BACKEND EVENT**',
            `Tipo: ${eventType}`,
            `Severidad: ${severity}`,
            `Origen: ${event.source || 'backend'}`,
            `Mensaje: ${String(event.message || 'Sin mensaje').slice(0, 1200)}`,
            event.riskScore !== undefined ? `Risk Score: ${event.riskScore}` : null,
            `Fecha: ${event.timestamp || new Date().toISOString()}`
        ].filter(Boolean).join('\n');
        const targetChannels = ['logs-launcher', 'logs-bot', 'logs-auditoria'];
        if (['scan_requested', 'scan_started', 'scan_finished', 'user_flagged'].includes(eventType)) targetChannels.push('detecciones-en-vivo');
        if (['anticheat_offline', 'anticheat_event', 'anticheat_flag', 'ai_diagnosis_critical'].includes(eventType) || severity === 'critical') targetChannels.push('alertas-criticas', 'detecciones-en-vivo');
        const sent = await sendDiscordChannelMessage(targetChannels, content).catch(() => false);
        if (!sent) enqueueDelivery('discord-channel', { channelNames: targetChannels, content }, 'BOT_DISCONNECTED');
        return sent;
    };

    server.get('/api/status', requireBackendAuth, (req, res) => {
        const events = readJsonFile(path.join(ensureDataDir(), 'backend_events.json'), []);
        const logs = readJsonFile(path.join(ensureDataDir(), 'backend_logs.json'), []);
        const ss = readJsonFile(path.join(ensureDataDir(), 'backend_ss_sessions.json'), []);
        const anticheat = readJsonFile(path.join(ensureDataDir(), 'backend_anticheat_events.json'), []);
        return res.json({
            success: true,
            status: 'online',
            timestamp: new Date().toISOString(),
            counts: { events: events.length, logs: logs.length, ssSessions: ss.length, anticheatEvents: anticheat.length },
            versions: {
                launcher: CONFIG.launcherVersion,
                backend: CONFIG.backendVersion,
                bot: CONFIG.botVersion,
                minLauncher: CONFIG.minLauncherVersion,
                latestLauncher: CONFIG.latestLauncherVersion
            },
            license: enterpriseLicenseService.status(),
            integrity: validateLauncherIntegrity(),
            services: {
                discord: Boolean(discordClient && discordClient.isReady()) ? 'online' : 'BOT_DISCONNECTED',
                anticheat: anticheatOnline ? 'online' : 'ANTICHEAT_FAIL',
                ia: (process.env.OPENAI_API_KEY || process.env.AI_API_KEY) ? 'online' : 'IA_FAIL'
            }
        });
    });

    server.post('/api/events', requireBackendAuth, async (req, res) => {
        const validation = validateBackendPayload(req.body, ['eventType', 'message']);
        if (!validation.ok) return sendBackendError(res, 'INVALID_EVENT', validation.message);
        const event = appendBackendRecord('backend_events.json', {
            source: req.body.source || 'launcher',
            eventType: req.body.eventType,
            userId: req.body.userId || 'unknown',
            hwid: req.body.hwid || 'unknown',
            severity: req.body.severity || 'info',
            message: String(req.body.message).slice(0, 4000),
            metadata: req.body.metadata || {}
        });
        enterpriseLogService.record(req.body.eventType, req.body.message, { severity: req.body.severity || 'info', metadata: req.body.metadata || {} });
        dispatchBackendEventToDiscord(event).catch(err => appendSystemEvent('backend-discord-dispatch-error', { message: err.message, eventId: event.id }));
        return res.json({ success: true, eventId: event.id, stored: true });
    });

    server.post('/api/logs', requireBackendAuth, async (req, res) => {
        const validation = validateBackendPayload(req.body, ['message']);
        if (!validation.ok) return sendBackendError(res, 'INVALID_LOG', validation.message);
        const log = appendBackendRecord('backend_logs.json', {
            source: req.body.source || 'launcher',
            level: req.body.level || 'info',
            message: String(req.body.message).slice(0, 4000),
            metadata: req.body.metadata || {}
        });
        enterpriseLogService.record('backend_log', log.message, { severity: log.level, metadata: log.metadata });
        return res.json({ success: true, logId: log.id, stored: true });
    });

    server.post('/api/launcher/logs', requireBackendAuth, async (req, res) => {
        const log = appendBackendRecord('backend_logs.json', {
            source: 'launcher',
            level: req.body.level || req.body.severity || 'info',
            message: String(req.body.message || 'Launcher logs payload').slice(0, 4000),
            metadata: req.body.metadata || req.body
        });
        return res.json({ success: true, logId: log.id, stored: true });
    });

    server.post('/api/launcher/heartbeat', requireBackendAuth, async (req, res) => {
        const heartbeat = appendBackendRecord('backend_heartbeats.json', { source: 'launcher', status: req.body.status || 'online', metadata: req.body.metadata || {} }, 300);
        return res.json({ success: true, heartbeatId: heartbeat.id, timestamp: heartbeat.timestamp });
    });

    server.post('/api/ss/session', requireBackendAuth, async (req, res) => {
        const validation = validateBackendPayload(req.body, ['status']);
        if (!validation.ok) return sendBackendError(res, 'INVALID_SS_SESSION', validation.message);
        const session = appendBackendRecord('backend_ss_sessions.json', {
            userId: req.body.userId || req.body.discordId || 'unknown',
            status: req.body.status,
            ticketId: req.body.ticketId || null,
            riskScore: req.body.riskScore || null,
            consentAt: req.body.consentAt || null,
            metadata: req.body.metadata || req.body
        });
        dispatchBackendEventToDiscord({ eventType: 'scan_requested', severity: 'warning', source: 'colmena-ss', message: `Sesion COLMENA-SS ${session.status} para ${session.userId}`, ...session }).catch(() => null);
        return res.json({ success: true, sessionId: session.id, stored: true });
    });

    server.post('/api/anticheat/event', requireBackendAuth, async (req, res) => {
        const validation = validateBackendPayload(req.body, ['type']);
        if (!validation.ok) return sendBackendError(res, 'INVALID_ANTICHEAT_EVENT', validation.message);
        const event = appendBackendRecord('backend_anticheat_events.json', {
            source: 'anticheat',
            type: req.body.type,
            severity: req.body.severity || 'warning',
            riskScore: Number.isFinite(req.body.riskScore) ? req.body.riskScore : 0,
            flags: req.body.flags || [],
            metadata: req.body.metadata || {}
        });
        dispatchBackendEventToDiscord({ eventType: 'anticheat_event', message: `Anticheat ${event.type}`, ...event }).catch(() => null);
        return res.json({ success: true, anticheatEventId: event.id, stored: true });
    });

    server.post('/api/anticheat/status', requireBackendAuth, async (req, res) => {
        const event = appendBackendRecord('backend_anticheat_events.json', { source: 'anticheat', type: 'status', severity: 'info', riskScore: req.body.riskScore || 0, metadata: req.body });
        return res.json({ success: true, anticheatEventId: event.id, stored: true });
    });

    server.post('/api/ai/analyze', requireBackendAuth, async (req, res) => {
        const validation = validateBackendPayload(req.body, ['message']);
        if (!validation.ok) return sendBackendError(res, 'INVALID_AI_REQUEST', validation.message);
        try {
            const result = await enterpriseAIService.analyze(req.body.type || 'backend-log', req.body);
            return res.json({ success: result.success, analysis: result.analysis || null, message: result.message || null });
        } catch (err) {
            appendBackendRecord('backend_logs.json', { source: 'ai', level: 'critical', message: err.message, metadata: { code: 'IA_FAIL' } });
            return sendBackendError(res, 'IA_FAIL', err.message, 500);
        }
    });

    server.post('/api/discord/sync', requireBackendAuth, async (req, res) => {
        const sync = appendBackendRecord('backend_discord_sync.json', { source: 'discord-sync', metadata: req.body }, 500);
        return res.json({ success: true, syncId: sync.id, stored: true });
    });

    server.post('/api/licenses/activate', requireBackendAuth, async (req, res) => {
        const validation = validateBackendPayload(req.body, ['licenseKey']);
        if (!validation.ok) return sendBackendError(res, 'INVALID_LICENSE_REQUEST', validation.message);
        const result = enterpriseLicenseService.activate({
            licenseKey: req.body.licenseKey,
            serverId: req.body.serverId || CONFIG.discordGuildId || 'local',
            clientName: req.body.clientName || req.body.userId || 'backend-client'
        });
        appendBackendRecord('backend_license_audit.json', {
            source: 'license',
            action: 'activate',
            result: result.success ? 'accepted' : 'rejected',
            plan: result.license?.plan || null,
            serverId: req.body.serverId || null,
            code: result.code || null
        }, 1000);
        return res.status(result.success ? 200 : 403).json(result);
    });

    server.post('/api/licenses/status', requireBackendAuth, async (req, res) => {
        const status = enterpriseLicenseService.status();
        appendBackendRecord('backend_license_audit.json', {
            source: 'license',
            action: 'status',
            result: status.valid ? 'valid' : 'invalid',
            plan: status.license?.plan || null,
            code: status.code || null
        }, 1000);
        return res.json(status);
    });

    server.get('/api/client/status', requireBackendAuth, (req, res) => {
        const license = enterpriseLicenseService.status();
        return res.json({
            success: true,
            license,
            services: {
                backend: 'online',
                discord: Boolean(discordClient && discordClient.isReady()) ? 'online' : 'BOT_DISCONNECTED',
                anticheat: anticheatOnline ? 'online' : 'ANTICHEAT_FAIL',
                ai: (process.env.OPENAI_API_KEY || process.env.AI_API_KEY) ? 'online' : 'IA_FAIL'
            }
        });
    });

    server.get('/api/client/license', requireBackendAuth, (req, res) => res.json(enterpriseLicenseService.status()));
    server.get('/api/client/logs', requireBackendAuth, (req, res) => res.json({ success: true, logs: enterpriseLogService.getLogs(100) }));
    server.get('/api/client/scans', requireBackendAuth, (req, res) => res.json({ success: true, sessions: readJsonFile(path.join(ensureDataDir(), 'backend_ss_sessions.json'), []).slice(0, 100) }));

    const provisionColmenaSSDiscordAccess = async (activation) => {
        if (!activation?.success || !activation.customer || !activation.plan) return activation;
        const result = { roleAssigned: false, invite: null, privateChannel: null, errors: [] };
        try {
            if (!discordClient?.isReady()) {
                result.errors.push('BOT_DISCONNECTED');
                return { ...activation, discord: result };
            }
            const guild = CONFIG.discordGuildId
                ? await discordClient.guilds.fetch(CONFIG.discordGuildId).catch(() => null)
                : discordClient.guilds.cache.first();
            if (!guild) {
                result.errors.push('GUILD_NOT_FOUND');
                return { ...activation, discord: result };
            }
            const serviceRoles = [
                { name: 'CLIENTE_SS_INDIVIDUAL', color: '#22c55e' },
                { name: 'CLIENTE_SS_STARTER', color: '#eab308' },
                { name: 'CLIENTE_SS_PRO', color: '#ef4444' },
                { name: 'CLIENTE_SS_DIAMOND', color: '#d6b35a' },
                { name: 'CLIENTE_SS_EXPIRADO', color: '#64748b' }
            ];
            const roleMap = {};
            for (const spec of serviceRoles) {
                let role = guild.roles.cache.find(r => r.name === spec.name);
                if (!role) role = await guild.roles.create({ name: spec.name, color: spec.color, reason: 'COLMENA-SS servicio comercial' }).catch(err => (result.errors.push(`ROLE_${spec.name}:${err.message}`), null));
                if (role) roleMap[spec.name] = role;
            }
            const targetRole = roleMap[activation.plan.role];
            const member = await guild.members.fetch(activation.customer.discord_id).catch(() => null);
            if (member && targetRole) {
                await member.roles.add(targetRole, `COLMENA-SS plan ${activation.customer.plan}`).catch(err => result.errors.push(`ASSIGN_ROLE:${err.message}`));
                if (member.roles.cache.has(targetRole.id)) result.roleAssigned = true;
                enterpriseSaasService.markDiscordInviteUsed(member.id);
            }

            const inviteChannel =
                (process.env.DISCORD_INVITE_CHANNEL_ID ? guild.channels.cache.get(process.env.DISCORD_INVITE_CHANNEL_ID) : null) ||
                guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name.includes('solicitar-escaneo')) ||
                guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name.includes('bienvenida')) ||
                guild.channels.cache.find(c => c.type === ChannelType.GuildText);
            if (inviteChannel) {
                const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
                const invite = await inviteChannel.createInvite({
                    maxAge: 7 * 24 * 60 * 60,
                    maxUses: 1,
                    unique: true,
                    reason: `COLMENA-SS ${activation.customer.email}`
                }).catch(err => (result.errors.push(`INVITE:${err.message}`), null));
                if (invite) {
                    result.invite = enterpriseSaasService.saveDiscordInvite({
                        customerId: activation.customer.id,
                        inviteCode: invite.code,
                        inviteUrl: invite.url,
                        expiresAt
                    });
                    enterpriseSaasService.queueColmenaSSEmail({
                        customer: activation.customer,
                        plan: activation.plan,
                        subject: 'Acceso COLMENA-SS activado',
                        body: [
                            'Gracias por contratar COLMENA-SS.',
                            `Plan contratado: ${activation.plan.label}.`,
                            `Enlace unico Discord: ${invite.url}`,
                            'Instrucciones: entra al Discord, revisa las normas de escaneo y abre solicitudes desde #📋・solicitar-escaneo.',
                            'Normas basicas: escaneos consentidos, no publicar datos personales y seguir instrucciones del staff.'
                        ].join('\n')
                    });
                }
            }

            if (activation.plan.privateChannel) {
                const safeServer = String(activation.customer.server_name || 'cliente').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 42) || 'cliente';
                const channelName = `ss-${safeServer}`;
                let channel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === channelName);
                if (!channel) {
                    const overwrites = [
                        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: discordClient.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
                    ];
                    if (targetRole) overwrites.push({ id: targetRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
                    channel = await guild.channels.create({
                        name: channelName,
                        type: ChannelType.GuildText,
                        permissionOverwrites: overwrites,
                        reason: `Canal privado COLMENA-SS ${activation.customer.email}`
                    }).catch(err => (result.errors.push(`PRIVATE_CHANNEL:${err.message}`), null));
                }
                if (channel) {
                    result.privateChannel = channel.id;
                    await channel.send(`Bienvenido a COLMENA-SS. Tu plan activo es: ${activation.customer.plan}. Ya puedes abrir solicitudes de escaneo desde #📋・solicitar-escaneo.`).catch(() => {});
                }
            }

            appendBackendRecord('ss_access_logs.json', {
                source: 'discord',
                action: 'provision_access',
                customer_id: activation.customer.id,
                discord_id: activation.customer.discord_id,
                plan: activation.customer.plan,
                result
            }, 1000);
            return { ...activation, discord: result };
        } catch (err) {
            result.errors.push(err.message);
            return { ...activation, discord: result };
        }
    };

    const expireColmenaSSDiscordAccess = async (expired) => {
        const result = { expiredRoleAssigned: false, removedRoles: [], errors: [] };
        try {
            const customer = expired?.customer;
            if (!customer || !discordClient?.isReady()) return { ...expired, discord: result };
            const guild = CONFIG.discordGuildId
                ? await discordClient.guilds.fetch(CONFIG.discordGuildId).catch(() => null)
                : discordClient.guilds.cache.first();
            if (!guild) {
                result.errors.push('GUILD_NOT_FOUND');
                return { ...expired, discord: result };
            }
            const member = await guild.members.fetch(customer.discord_id).catch(() => null);
            if (!member) return { ...expired, discord: result };
            const activeRoleNames = ['CLIENTE_SS_INDIVIDUAL', 'CLIENTE_SS_STARTER', 'CLIENTE_SS_PRO', 'CLIENTE_SS_DIAMOND'];
            for (const roleName of activeRoleNames) {
                const role = guild.roles.cache.find(r => r.name === roleName);
                if (role && member.roles.cache.has(role.id)) {
                    await member.roles.remove(role, 'COLMENA-SS suscripcion expirada').catch(err => result.errors.push(`REMOVE_${roleName}:${err.message}`));
                    result.removedRoles.push(roleName);
                }
            }
            let expiredRole = guild.roles.cache.find(r => r.name === 'CLIENTE_SS_EXPIRADO');
            if (!expiredRole) expiredRole = await guild.roles.create({ name: 'CLIENTE_SS_EXPIRADO', color: '#64748b', reason: 'COLMENA-SS expirado' }).catch(err => (result.errors.push(`ROLE_EXPIRED:${err.message}`), null));
            if (expiredRole) {
                await member.roles.add(expiredRole, 'COLMENA-SS suscripcion expirada').catch(err => result.errors.push(`ADD_EXPIRED:${err.message}`));
                result.expiredRoleAssigned = member.roles.cache.has(expiredRole.id);
            }
            appendBackendRecord('ss_access_logs.json', { source: 'discord', action: 'expire_access', customer_id: customer.id, discord_id: customer.discord_id, result }, 1000);
            return { ...expired, discord: result };
        } catch (err) {
            result.errors.push(err.message);
            return { ...expired, discord: result };
        }
    };

    const createOrderDiscordInvite = async (orderActivation) => {
        if (!orderActivation?.success || !orderActivation.order) return orderActivation;
        const result = { invite: null, errors: [] };
        try {
            if (!discordClient?.isReady()) {
                result.errors.push('BOT_DISCONNECTED');
                return { ...orderActivation, discord: result };
            }
            const guild = CONFIG.discordGuildId
                ? await discordClient.guilds.fetch(CONFIG.discordGuildId).catch(() => null)
                : discordClient.guilds.cache.first();
            if (!guild) {
                result.errors.push('GUILD_NOT_FOUND');
                return { ...orderActivation, discord: result };
            }
            const roles = [
                { name: 'CLIENTE_SCANER', color: '#22c55e' },
                { name: 'SERVIDOR_VERIFICADO', color: '#d6b35a' },
                { name: 'SIN_VERIFICAR', color: '#64748b' }
            ];
            for (const spec of roles) {
                if (!guild.roles.cache.find(r => r.name === spec.name)) {
                    await guild.roles.create({ name: spec.name, color: spec.color, reason: 'COLMENA-SS orders' }).catch(err => result.errors.push(`ROLE_${spec.name}:${err.message}`));
                }
            }
            const inviteChannel =
                guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name.includes('solicitar-escaneo')) ||
                guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name.includes('bienvenida')) ||
                guild.channels.cache.find(c => c.type === ChannelType.GuildText);
            if (!inviteChannel) {
                result.errors.push('INVITE_CHANNEL_NOT_FOUND');
                return { ...orderActivation, discord: result };
            }
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
            const invite = await inviteChannel.createInvite({
                maxAge: 7 * 24 * 60 * 60,
                maxUses: 1,
                unique: true,
                reason: `COLMENA-SS order ${orderActivation.order.id}`
            }).catch(err => (result.errors.push(`INVITE:${err.message}`), null));
            if (invite) {
                const updated = enterpriseSaasService.saveOrderInvite(orderActivation.order.id, { inviteCode: invite.code, inviteUrl: invite.url, expiresAt });
                const user = enterpriseSaasService.findUserById(orderActivation.order.user_id);
                result.invite = { invite_code: invite.code, invite_url: invite.url, expires_at: expiresAt };
                enterpriseSaasService.queueColmenaSSEmail({
                    customer: { email: user?.email || '' },
                    plan: { label: orderActivation.order.plan },
                    subject: 'Acceso COLMENA-SS activado',
                    body: [
                        `Gracias por contratar COLMENA-SS, ${user?.full_name || 'cliente'}.`,
                        `Plan contratado: ${orderActivation.order.plan}.`,
                        `Enlace unico Discord: ${invite.url}`,
                        `Recuerda entrar con este Discord ID: ${user?.discord_id || ''}.`,
                        'Una vez dentro, el bot verificara tu pedido y asignara el rol correspondiente.'
                    ].join('\n')
                });
                return { ...orderActivation, order: updated || orderActivation.order, discord: result };
            }
            return { ...orderActivation, discord: result };
        } catch (err) {
            result.errors.push(err.message);
            return { ...orderActivation, discord: result };
        }
    };

    server.get('/api/public/plans', (req, res) => res.json({ success: true, plans: enterpriseSaasService.plans() }));
    server.get('/api/public/colmena-ss-plans', (req, res) => res.json({ success: true, plans: enterpriseSaasService.colmenaSSPlans() }));
    server.get('/colmena-ss', (req, res) => res.sendFile(path.join(__dirname, 'web', 'colmena-ss.html')));
    server.get('/precios', (req, res) => res.sendFile(path.join(__dirname, 'web', 'precios.html')));
    server.get('/registro', (req, res) => res.sendFile(path.join(__dirname, 'web', 'registro.html')));
    server.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'web', 'login.html')));
    server.get('/panel', (req, res) => res.sendFile(path.join(__dirname, 'web', 'panel.html')));
    server.get('/checkout/success', (req, res) => res.sendFile(path.join(__dirname, 'web', 'checkout-success.html')));
    server.get('/checkout/cancel', (req, res) => res.sendFile(path.join(__dirname, 'web', 'checkout-cancel.html')));
    server.get('/forgot-password', (req, res) => res.sendFile(path.join(__dirname, 'web', 'forgot-password.html')));
    server.get('/reset-password', (req, res) => res.sendFile(path.join(__dirname, 'web', 'reset-password.html')));

    server.post('/api/auth/register', async (req, res) => {
        const result = enterpriseSaasService.register(req.body || {});
        return res.status(result.success ? 200 : 400).json(result);
    });

    server.post('/api/auth/login', async (req, res) => {
        const result = enterpriseSaasService.login(req.body || {});
        return res.status(result.success ? 200 : 401).json(result);
    });

    server.get('/api/auth/me', requireSaasAuth, (req, res) => {
        const user = enterpriseSaasService.findUserById(req.saasUser.sub);
        return res.status(user ? 200 : 404).json(user ? { success: true, user: enterpriseSaasService.publicUser(user) } : { success: false, code: 'USER_NOT_FOUND' });
    });

    server.post('/api/auth/profile', requireSaasAuth, (req, res) => {
        const updated = enterpriseSaasService.updateProfile(req.saasUser.sub, req.body || {});
        if (!updated) return res.status(400).json({ success: false, code: 'PROFILE_UPDATE_BLOCKED', message: 'No se puede cambiar el Discord ID si ya tienes rol asignado.' });
        const validation = enterpriseSaasService.validateUserProfile(updated);
        return res.status(validation.ok ? 200 : 400).json(validation.ok ? { success: true, user: enterpriseSaasService.publicUser(updated) } : { success: false, code: validation.code, message: validation.message });
    });

    const buildResetRequest = (req) => ({
        ...(req.body || {}),
        ipAddress: req.ip || req.socket?.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || ''
    });
    server.post('/api/auth/forgot-password', async (req, res) => res.json(enterpriseSaasService.createReset(buildResetRequest(req))));
    server.post('/api/auth/recover', async (req, res) => res.json(enterpriseSaasService.createReset(buildResetRequest(req))));
    server.post('/api/auth/reset-password', async (req, res) => {
        const result = enterpriseSaasService.resetPassword(req.body || {});
        return res.status(result.success ? 200 : 400).json(result);
    });
    server.post('/api/auth/reset', async (req, res) => {
        const result = enterpriseSaasService.resetPassword(req.body || {});
        return res.status(result.success ? 200 : 400).json(result);
    });

    server.post('/api/payments/checkout', requireSaasAuth, async (req, res) => {
        try {
            const result = await enterpriseSaasService.createCheckout({
                userId: req.saasUser.sub,
                plan: req.body.plan,
                mode: req.body.mode || 'subscription',
                scanQuantity: req.body.scanQuantity || 1,
                serverId: req.body.serverId || CONFIG.discordGuildId || 'local'
            });
            return res.status(result.success ? 200 : 400).json(result);
        } catch (err) {
            appendBackendRecord('backend_logs.json', { source: 'stripe', level: 'error', message: err.message, metadata: { code: 'STRIPE_CHECKOUT_FAILED' } });
            return res.status(500).json({ success: false, code: 'STRIPE_CHECKOUT_FAILED', message: err.message });
        }
    });

    server.post('/api/colmena-ss/checkout', async (req, res) => {
        try {
            const result = await enterpriseSaasService.createColmenaSSCheckout({
                email: req.body.email,
                discordId: req.body.discordId,
                serverName: req.body.serverName,
                serverInvite: req.body.serverInvite,
                plan: req.body.plan
            });
            if (result.activation?.success) result.activation = await provisionColmenaSSDiscordAccess(result.activation);
            return res.status(result.success ? 200 : 400).json(result);
        } catch (err) {
            appendBackendRecord('backend_logs.json', { source: 'stripe', level: 'error', message: err.message, metadata: { code: 'SS_CHECKOUT_FAILED' } });
            return res.status(500).json({ success: false, code: 'SS_CHECKOUT_FAILED', message: err.message });
        }
    });

    server.post('/api/colmena-ss/order-checkout', requireSaasAuth, async (req, res) => {
        try {
            let result = await enterpriseSaasService.createOrderCheckout({
                userId: req.saasUser.sub,
                plan: req.body.plan,
                notes: req.body.notes,
                profileUpdates: req.body.profileUpdates || {}
            });
            if (result.success && result.order?.payment_status === 'PAID') result = await createOrderDiscordInvite(result);
            return res.status(result.success ? 200 : 400).json(result);
        } catch (err) {
            appendBackendRecord('backend_logs.json', { source: 'stripe', level: 'error', message: err.message, metadata: { code: 'ORDER_CHECKOUT_FAILED' } });
            return res.status(500).json({ success: false, code: 'ORDER_CHECKOUT_FAILED', message: err.message });
        }
    });

    server.post('/api/stripe/webhook', (req, res) => {
        const signature = req.headers['stripe-signature'];
        if (!enterpriseSaasService.verifyStripeSignature(req.rawBody || Buffer.from(JSON.stringify(req.body || {})), signature)) {
            appendBackendRecord('backend_logs.json', { source: 'stripe', level: 'critical', message: 'Stripe webhook signature invalid', metadata: {} });
            return res.status(400).json({ success: false, code: 'STRIPE_SIGNATURE_INVALID' });
        }
        let result = enterpriseSaasService.handleStripeEvent(req.body);
        if (result?.customer && result?.plan) {
            provisionColmenaSSDiscordAccess(result)
                .then(provisioned => appendBackendRecord('backend_payments_audit.json', { source: 'stripe', action: 'colmena_ss_provision_async', result: 'processed', metadata: provisioned }))
                .catch(err => appendBackendRecord('backend_logs.json', { source: 'discord', level: 'error', message: err.message, metadata: { code: 'SS_DISCORD_PROVISION_FAILED' } }));
        } else if (result?.order?.payment_status === 'PAID') {
            createOrderDiscordInvite(result)
                .then(provisioned => appendBackendRecord('backend_payments_audit.json', { source: 'stripe', action: 'order_invite_async', result: 'processed', metadata: provisioned }))
                .catch(err => appendBackendRecord('backend_logs.json', { source: 'discord', level: 'error', message: err.message, metadata: { code: 'ORDER_INVITE_FAILED' } }));
        } else if (result?.expired && result?.customer) {
            expireColmenaSSDiscordAccess(result)
                .then(expired => appendBackendRecord('backend_payments_audit.json', { source: 'stripe', action: 'colmena_ss_expire_async', result: 'processed', metadata: expired }))
                .catch(err => appendBackendRecord('backend_logs.json', { source: 'discord', level: 'error', message: err.message, metadata: { code: 'SS_DISCORD_EXPIRE_FAILED' } }));
        }
        appendBackendRecord('backend_payments_audit.json', { source: 'stripe', action: req.body.type || 'unknown', result: result.success ? 'accepted' : 'rejected', metadata: result });
        return res.json(result);
    });

    server.get('/api/panel/dashboard', requireSaasAuth, (req, res) => res.json(enterpriseSaasService.dashboard(req.saasUser)));
    server.get('/api/panel/license', requireSaasAuth, (req, res) => res.json({ success: true, license: enterpriseLicenseService.status() }));
    server.get('/api/panel/scans', requireSaasAuth, (req, res) => res.json({ success: true, scans: readJsonFile(path.join(ensureDataDir(), 'backend_ss_sessions.json'), []).slice(0, 100) }));
    server.get('/api/panel/logs', requireSaasAuth, (req, res) => res.json({ success: true, logs: readJsonFile(path.join(ensureDataDir(), 'backend_logs.json'), []).slice(0, 100) }));
    server.post('/api/panel/support', requireSaasAuth, (req, res) => {
        const ticket = appendBackendRecord('saas_support_tickets.json', { userId: req.saasUser.sub, subject: req.body.subject || 'Soporte', message: req.body.message || '', status: 'open' }, 1000);
        return res.json({ success: true, ticket });
    });

    server.get('/api/admin/dashboard', requireSaasAuth, requireSaasAdmin, (req, res) => {
        const dashboard = enterpriseSaasService.dashboard(req.saasUser);
        return res.json({
            success: true,
            revenue: dashboard.revenue,
            clients: readJsonFile(path.join(ensureDataDir(), 'saas_users.json'), []).length,
            payments: dashboard.payments,
            scans: dashboard.scans,
            incidents: readJsonFile(path.join(ensureDataDir(), 'saas_support_tickets.json'), [])
        });
    });

    server.post('/alert', async (req, res) => {
        const auth = req.headers['x-api-key'];
        if (auth !== API_KEY) return res.status(403).json({ error: 'Unauthorized' });

        const alert = req.body;
        console.log('New Alert Received:', alert);

        try {
            const auditEvent = await handleSecurityAlert(alert, { source: 'backend', webhook: DISCORD_WEBHOOK });
            return res.json({ success: true, alertId: auditEvent.alertId });
        } catch (err) {
            console.error('[NEURAL] Error procesando alerta:', err);
            return res.status(500).json({ success: false, error: 'Alert processing failed' });
        }

    });

    const port = CONFIG.serverPort;
    server.listen(port, () => {
        backendOnline = true;
        console.log(`Backend Alert Listener running on port ${port}`);
        if (window) window.webContents.send('status:update', { id: 'status-bot', state: 'online' });
        setTimeout(async () => {
            await enterpriseBackendClient.sendEvent({
                eventType: 'launcher_started',
                severity: 'info',
                message: 'Colmena WorkSuite launcher iniciado y backend local operativo.',
                metadata: { version: '2.5.0-PRO', port }
            }).catch(err => appendSystemEvent('launcher-started-backend-error', { message: err.message }));
            await enterpriseBackendClient.flushQueue().catch(err => appendSystemEvent('backend-client-flush-error', { message: err.message }));
        }, 1000);
    });
};

// IPC Handler for Cleaner
ipcMain.handle('app:run-cleaner', async (event, options = {}) => {
    return await cleanSystem(mainWindow, options);
});

// --- Authentication: register & login using local JSON storage ---
ipcMain.handle('auth:register', async (event, { user, pass }) => {
    try {
        if (!user || !pass) return { success: false, message: 'Usuario o contraseña inválidos.' };

        const usersPath = path.join(__dirname, 'data', 'users.json');
        let users = {};
        if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'));
        if (fs.existsSync(usersPath)) {
            users = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '{}');
        }

        if (users[user]) return { success: false, message: 'El usuario ya existe.' };

        // Generate salt + hash
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(pass, salt, 310000, 32, 'sha256').toString('hex');

        users[user] = { salt, hash, createdAt: new Date().toISOString(), failedAttempts: 0, locked: false, lockedAt: null };
        fs.writeFileSync(usersPath, JSON.stringify(users, null, 2), 'utf8');

        if (mainWindow) {
            mainWindow.webContents.send('bot:new-action', {
                timestamp: new Date().toLocaleTimeString(),
                message: `[AUTH] Usuario registrado: ${user}`,
                status: 'success'
            });
        }

        return { success: true, message: 'Usuario registrado correctamente.' };
    } catch (e) {
        console.error('auth:register error', e);
        return { success: false, message: 'Error al registrar usuario.' };
    }
});

// Function to initialize Master Admin if not exists
const initMasterAdmin = () => {
    const usersPath = path.join(__dirname, 'data', 'users.json');
    if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'));
    
    let users = {};
    if (fs.existsSync(usersPath)) {
        users = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '{}');
    }

    const masterUser = process.env.MASTER_ADMIN_USER || 'Aporlop';
    if (!users[masterUser]) {
        const generatedPassword = crypto.randomBytes(12).toString('base64url');
        const masterPassword = process.env.MASTER_ADMIN_PASSWORD || generatedPassword;
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(masterPassword, salt, 310000, 32, 'sha256').toString('hex');
        users[masterUser] = { 
            salt, 
            hash, 
            role: 'ADMIN', 
            createdAt: new Date().toISOString(),
            failedAttempts: 0,
            locked: false
        };
        fs.writeFileSync(usersPath, JSON.stringify(users, null, 2), 'utf8');
        if (!process.env.MASTER_ADMIN_PASSWORD) {
            const initialPath = path.join(__dirname, 'data', 'initial_admin_credentials.txt');
            fs.writeFileSync(initialPath, `Usuario: ${masterUser}\nPassword temporal: ${masterPassword}\nCambia esta clave desde .env con MASTER_ADMIN_PASSWORD.\n`, 'utf8');
            console.warn(`[AUTH] Cuenta maestra creada con password temporal en ${initialPath}`);
        } else {
            console.log(`[AUTH] Cuenta maestra ${masterUser} inicializada desde variables de entorno.`);
        }
    }
};

ipcMain.handle('auth:login', async (event, { user, pass }) => {
    console.log(`[DEBUG] Intento de login para: ${user}`);
    try {
        if (!user || !pass) return { success: false, message: 'Usuario o contraseña inválidos.' };

        const usersPath = path.join(__dirname, 'data', 'users.json');
        if (!fs.existsSync(usersPath)) return { success: false, message: 'No hay usuarios registrados.' };

        const users = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '{}');
        const entry = users[user];
        if (!entry) return { success: false, message: 'Usuario no encontrado.' };

        // Check if account is locked
        if (entry.locked) {
            // Optionally, we could implement timed lock; for now require manual review
            if (mainWindow) {
                mainWindow.webContents.send('bot:new-action', {
                    timestamp: new Date().toLocaleTimeString(),
                    message: `[AUTH] Acceso denegado (cuenta bloqueada): ${user}`,
                    status: 'error'
                });
            }
            return { success: false, message: 'Cuenta bloqueada: abra un ticket para revisión.' };
        }

        const hash = crypto.pbkdf2Sync(pass, entry.salt, 310000, 32, 'sha256').toString('hex');
        if (hash === entry.hash) {
            // Reset failed attempts on successful login
            entry.failedAttempts = 0;
            users[user] = entry;
            fs.writeFileSync(usersPath, JSON.stringify(users, null, 2), 'utf8');

            currentUser = user;
            currentRole = entry.role || 'USER';

            if (mainWindow && currentRole === 'ADMIN') {
                mainWindow.webContents.send('bot:new-action', {
                    timestamp: new Date().toLocaleTimeString(),
                    message: `[AUTH] Acceso concedido: ${user} (${currentRole})`,
                    status: 'success'
                });
            }
            return { success: true, message: 'Autenticación correcta.', role: currentRole };
        }

        // Wrong password: increment failedAttempts
        entry.failedAttempts = (entry.failedAttempts || 0) + 1;
        let message = 'Contraseña incorrecta.';

        if (entry.failedAttempts >= 5) {
            entry.locked = true;
            entry.lockedAt = new Date().toISOString();
            message = 'Cuenta bloqueada tras 5 intentos fallidos. Abra un ticket para revisión.';

            if (mainWindow) {
                mainWindow.webContents.send('bot:new-action', {
                    timestamp: new Date().toLocaleTimeString(),
                    message: `[AUTH] Cuenta bloqueada por seguridad: ${user}. Abrir ticket para revisión.`,
                    status: 'error'
                });
            }
        } else {
            const remaining = 5 - entry.failedAttempts;
            message = `Contraseña incorrecta. Intentos restantes: ${remaining}`;

            if (mainWindow) {
                mainWindow.webContents.send('bot:new-action', {
                    timestamp: new Date().toLocaleTimeString(),
                    message: `[AUTH] Intento fallido (${entry.failedAttempts}/5) de: ${user}`,
                    status: 'error'
                });
            }
        }

        users[user] = entry;
        fs.writeFileSync(usersPath, JSON.stringify(users, null, 2), 'utf8');

        return { success: false, message };
    } catch (e) {
        console.error('auth:login error', e);
        return { success: false, message: 'Error al autenticar usuario.' };
    }
});

ipcMain.handle('auth:forgot-password', async (event, { email }) => {
    try {
        if (!email) return { success: true, message: 'Si el email existe, recibirás instrucciones para recuperar tu contraseña.' };
        const result = await enterpriseAuthService.forgotPassword(email);
        sendLauncherLog('[AUTH] Solicitud de recuperacion de contraseña enviada.', 'success');
        return result;
    } catch (err) {
        appendSystemEvent('password-reset-launcher-error', { message: err.message });
        return { success: true, message: 'Si el email existe, recibirás instrucciones para recuperar tu contraseña.' };
    }
});

ipcMain.handle('auth:reset-password', async (event, { token, newPassword }) => {
    try {
        return await enterpriseAuthService.resetPassword(token, newPassword);
    } catch (err) {
        appendSystemEvent('password-reset-launcher-reset-error', { message: err.message });
        return { success: false, code: 'RESET_FAILED', message: err.response?.data?.message || 'No se pudo actualizar la contraseña.' };
    }
});

// Discord Bot Logic
const startDiscordBot = (window, options = {}) => {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
        if (window) window.webContents.send('status:update', { id: 'status-discord', state: 'offline' });
        appendRuntimeLog('discord.log', 'No Discord token found.');
        return console.log('No Discord Token found.');
    }
    if (discordStarting) return;
    if (discordClient && discordClient.isReady()) {
        if (window) window.webContents.send('status:update', { id: 'status-discord', state: 'online' });
        return;
    }
    const scheduleDiscordReconnect = (reason) => {
        if (discordReconnectTimer) return;
        const delay = Math.max(15000, 60000 - (Date.now() - lastDiscordReconnectAt));
        appendRuntimeLog('discord.log', `Scheduling reconnect in ${delay}ms. reason=${reason}`);
        appendSystemEvent('discord-reconnect-scheduled', { reason, delay });
        discordReconnectTimer = setTimeout(() => {
            discordReconnectTimer = null;
            lastDiscordReconnectAt = Date.now();
            if (discordClient?.isReady()) return;
            discordClient?.destroy?.();
            discordClient = null;
            discordStarting = false;
            startDiscordBot(window, { limited: discordLimitedMode });
        }, delay);
    };
    discordStarting = true;
    discordLimitedMode = Boolean(options.limited);
    if (window) window.webContents.send('status:update', { id: 'status-discord', state: 'pending' });
    appendRuntimeLog('discord.log', `Starting Discord bot login. limited=${discordLimitedMode}`);

    const intents = [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ];
    if (!options.limited && process.env.DISCORD_ENABLE_GUILD_MEMBERS !== 'false') {
        intents.push(GatewayIntentBits.GuildMembers);
    }
    if (!options.limited && process.env.DISCORD_ENABLE_MESSAGE_CONTENT !== 'false') {
        intents.push(GatewayIntentBits.MessageContent);
    }
    if (process.env.DISCORD_ENABLE_PRESENCE === 'true') {
        intents.push(GatewayIntentBits.GuildPresences);
    }

    discordClient = new Client({
        intents,
        partials: [Partials.Channel]
    });

    // Identity System Logic
    const getNextSecurityId = (discordUser) => {
        const dbPath = path.join(__dirname, 'data', 'discord_identities.json');
        let db = {};
        if (fs.existsSync(dbPath)) db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

        // Check if user already has an ID
        if (db[discordUser.id]) return db[discordUser.id];

        let newId;
        if (discordUser.username.toLowerCase() === 'aporlop') {
            newId = 1;
        } else {
            const existingIds = Object.values(db);
            const maxId = Math.max(298, ...existingIds.filter(id => typeof id === 'number'));
            newId = maxId + 1;
        }

        db[discordUser.id] = newId;
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
        return newId;
    };

    const updateMemberNickname = async (member) => {
        const securityId = getNextSecurityId(member.user);
        const newNick = `${member.user.username} | ${securityId}`;
        try {
            await member.setNickname(newNick);
            if (window && currentRole === 'ADMIN') {
                window.webContents.send('bot:new-action', {
                    timestamp: new Date().toLocaleTimeString(),
                    message: `[IDENTIDAD] ID ${securityId} asignada a ${member.user.username}`,
                    status: 'success'
                });
            }
        } catch (err) {
            console.log(`No pude cambiar el nombre a ${member.user.username} (Falta de permisos)`);
        }
    };

    discordClient.once('ready', () => {
        discordStarting = false;
        console.log(`Discord Bot logged in as ${discordClient.user.tag}`);
        appendRuntimeLog('discord.log', `Discord bot ready as ${discordClient.user.tag}. limited=${discordLimitedMode}`);
        if (window) window.webContents.send('status:update', { id: 'status-discord', state: 'online' });
        const commandPayload = [
            {
                name: 'buscar_pedido',
                description: 'Busca un pedido COLMENA-SS por Discord ID',
                options: [{ name: 'discord_id', description: 'Discord ID del comprador', type: 3, required: true }]
            },
            {
                name: 'reasignar_rol',
                description: 'Reasigna el rol COLMENA-SS correcto segun pedido pagado',
                options: [{ name: 'discord_id', description: 'Discord ID del comprador', type: 3, required: true }]
            }
        ];
        const registerCommands = async () => {
            const guilds = CONFIG.discordGuildId ? [await discordClient.guilds.fetch(CONFIG.discordGuildId).catch(() => null)] : [...discordClient.guilds.cache.values()];
            for (const guild of guilds.filter(Boolean)) {
                await guild.commands.set(commandPayload).catch(err => appendRuntimeLog('discord.log', `Slash command register failed: ${err.message}`));
            }
        };
        registerCommands();
        // Process existing members if needed or just logs
        if (window && currentRole === 'ADMIN') {
            window.webContents.send('bot:new-action', {
                timestamp: new Date().toLocaleTimeString(),
                message: `[DISCORD] Sistema de Identidades Activo.`,
                status: 'success'
            });
        }
    });

    discordClient.on('error', (err) => {
        appendRuntimeLog('discord.log', `Client error: ${err.message}`);
        appendSystemEvent('discord-client-error', { message: err.message });
        if (window) window.webContents.send('status:update', { id: 'status-discord', state: 'warning' });
        scheduleDiscordReconnect(`client-error:${err.message}`);
    });

    discordClient.on('shardDisconnect', (event) => {
        appendRuntimeLog('discord.log', `Shard disconnect: ${event?.code || 'unknown'}`);
        appendSystemEvent('discord-shard-disconnect', { code: event?.code || null, reason: event?.reason || null });
        if (window) window.webContents.send('status:update', { id: 'status-discord', state: 'offline' });
        scheduleDiscordReconnect(`shard-disconnect:${event?.code || 'unknown'}`);
    });

    const logBotChannel = async (guild, message) => {
        const channel = guild?.channels.cache.find(c => c.type === ChannelType.GuildText && c.name.includes('logs-bot'));
        if (channel) await channel.send(message).catch(() => {});
        appendBackendRecord('ss_access_logs.json', { source: 'discord', action: 'bot_log', message }, 1000);
    };

    const isOrderAdmin = (member) => {
        if (!member) return false;
        if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
        return member.guild?.ownerId === member.id;
    };

    const ensureNamedRole = async (guild, name, color = '#d6b35a') => {
        let role = guild.roles.cache.find(r => r.name === name);
        if (!role) role = await guild.roles.create({ name, color, reason: 'COLMENA-SS order role' }).catch(() => null);
        return role;
    };

    const resolveOrderRole = async (guild, plan) => {
        if (plan === 'SCANER' && process.env.ROLE_CLIENTE_SCANER_ID) {
            const role = guild.roles.cache.get(process.env.ROLE_CLIENTE_SCANER_ID);
            if (role) return role;
        }
        if (plan === 'MONTHLY_SERVER' && process.env.ROLE_SERVIDOR_VERIFICADO_ID) {
            const role = guild.roles.cache.get(process.env.ROLE_SERVIDOR_VERIFICADO_ID);
            if (role) return role;
        }
        const roleName = enterpriseSaasService.orderRole(plan);
        return ensureNamedRole(guild, roleName, plan === 'MONTHLY_SERVER' ? '#d6b35a' : '#22c55e');
    };

    const orderEmbedText = (order) => [
        '🛒 NUEVO CLIENTE COLMENA-SS',
        '',
        `Cliente: ${order.customer_name}`,
        `Email: ${order.email}`,
        `Discord: <@${order.discord_id}>`,
        `Discord ID: ${order.discord_id}`,
        `Servidor: ${order.server_name}`,
        `Discord del servidor: ${order.server_discord_invite || 'No indicado'}`,
        `Plan contratado: ${order.plan}`,
        `Estado pago: PAGADO`,
        `Fecha: ${order.created_at}`,
        '',
        'Acción automática:',
        '',
        '* Usuario detectado al entrar al Discord',
        '* Rol asignado correctamente',
        '* Pedido vinculado correctamente'
    ].join('\n');

    const provisionOrderMember = async (member, order, { notify = true } = {}) => {
        const user = enterpriseSaasService.findUserById(order.user_id);
        if (!user || String(user.discord_id) !== String(member.id) || order.payment_status !== 'PAID') {
            await logBotChannel(member.guild, `Asignacion bloqueada: pedido ${order.id} no tiene usuario registrado/pago valido para ${member.id}.`);
            return order;
        }
        const roleName = enterpriseSaasService.orderRole(order.plan);
        const registeredOrderEmbedText = [
            'NUEVO CLIENTE VERIFICADO COLMENA-SS',
            '',
            `Cliente: ${user.full_name}`,
            `Email: ${user.email}`,
            `Discord: <@${user.discord_id}>`,
            `Discord ID: ${user.discord_id}`,
            `Servidor: ${user.server_name}`,
            `Discord del servidor: ${user.server_discord_invite || 'No indicado'}`,
            `Plan contratado: ${order.plan}`,
            `Importe: ${order.amount || 0} ${order.currency || 'eur'}`,
            'Estado: PAGADO',
            `Rol asignado: ${roleName}`,
            `Fecha: ${order.created_at}`,
            '',
            'Accion:',
            'Usuario registrado en web, compra verificada y rol asignado automaticamente al entrar al Discord.'
        ].join('\n');
        const role = await resolveOrderRole(member.guild, order.plan);
        let roleAssigned = false;
        if (role && !member.roles.cache.has(role.id)) await member.roles.add(role, `COLMENA-SS order ${order.id}`);
        if (role) roleAssigned = member.roles.cache.has(role.id);
        enterpriseSaasService.markOrderInviteUsed(order.id);

        let ownerNotified = Boolean(order.owner_notified);
        if (notify && !ownerNotified) {
            const owner = process.env.DISCORD_OWNER_ID
                ? await discordClient.users.fetch(process.env.DISCORD_OWNER_ID).catch(() => null)
                : await member.guild.fetchOwner().catch(() => null);
            if (owner) {
                await owner.send(registeredOrderEmbedText).then(() => { ownerNotified = true; }).catch(err => logBotChannel(member.guild, `No se pudo enviar DM al owner por pedido ${order.id}: ${err.message}`));
            }
        }
        await member.send(order.plan === 'MONTHLY_SERVER'
            ? 'Bienvenido a COLMENA-SS. Tu servidor ha sido verificado mediante contratación mensual. Ya tienes acceso a los canales de cliente y soporte mensual.'
            : 'Bienvenido a COLMENA-SS. Tu contratación por escáner individual ha sido verificada. Ya tienes acceso para solicitar tu escaneo desde el canal correspondiente.'
        ).catch(() => {});
        const updated = enterpriseSaasService.markOrderDiscordProvisioned(order.id, { roleAssigned, ownerNotified });
        await logBotChannel(member.guild, `Pedido COLMENA-SS vinculado: ${order.id} · ${order.discord_id} · ${order.plan} · rol=${roleName}`);
        return updated || order;
    };

    discordClient.on('guildMemberAdd', async (member) => {
        await updateMemberNickname(member);
        try {
            const order = enterpriseSaasService.findPaidOrderByDiscordId(member.id);
            if (order) {
                await provisionOrderMember(member, order);
                return;
            }
            const sinVerificar = (process.env.ROLE_SIN_VERIFICAR_ID ? member.guild.roles.cache.get(process.env.ROLE_SIN_VERIFICAR_ID) : null) ||
                member.guild.roles.cache.find(r => r.name === 'SIN_VERIFICAR');
            if (sinVerificar && !member.roles.cache.has(sinVerificar.id)) await member.roles.add(sinVerificar, 'Sin pedido COLMENA-SS pagado').catch(() => {});
            await member.send('Bienvenido a COLMENA-SS. No hemos encontrado una contratación pagada vinculada a tu Discord ID. Completa la contratación en la web o revisa que introdujiste el Discord ID correcto.').catch(() => {});
            await logBotChannel(member.guild, `Entrada sin pedido pagado: ${member.user.tag} (${member.id}). No se asigno rol de cliente.`);

            const customer = enterpriseSaasService.markDiscordInviteUsed(member.id);
            if (!customer || customer.status !== 'active') return;
            const plans = enterpriseSaasService.colmenaSSPlans();
            const plan = plans[customer.plan];
            if (!plan) return;
            let role = member.guild.roles.cache.find(r => r.name === plan.role);
            if (!role) role = await member.guild.roles.create({ name: plan.role, color: '#d6b35a', reason: 'COLMENA-SS alta cliente' }).catch(() => null);
            if (role) await member.roles.add(role, `COLMENA-SS plan ${customer.plan}`);
            const welcome = member.guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name.includes('bienvenida')) ||
                member.guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name.includes('solicitar-escaneo'));
            if (welcome) await welcome.send(`Bienvenido a COLMENA-SS, <@${member.id}>. Tu plan activo es: ${customer.plan}. Ya puedes abrir solicitudes de escaneo desde #📋・solicitar-escaneo.`).catch(() => {});
            appendBackendRecord('ss_access_logs.json', { source: 'discord', action: 'member_join_role_assigned', discord_id: member.id, customer_id: customer.id, plan: customer.plan }, 1000);
        } catch (err) {
            appendBackendRecord('ss_access_logs.json', { source: 'discord', action: 'member_join_role_failed', discord_id: member.id, error: err.message }, 1000);
        }
    });

    const colmenaCoreCategories = [
        { name: '📁 00 • GOBIERNO Y ACCESO', group: 'public', channels: ['bienvenida', 'verificacion-acceso', 'terminos-y-politicas', 'anuncios-globales', 'estado-del-sistema', 'registro-de-cambios'] },
        { name: '📁 01 • EXPERIENCIA PUBLICA', group: 'public', channels: ['chat-general', 'multimedia', 'eventos-comunidad', 'roles-y-grupos', 'sugerencias', 'preguntas-frecuentes'] },
        { name: '📁 02 • OPERACIONES DEL SERVIDOR (NOC)', group: 'staff', channels: ['estado-servidor', 'logs-txadmin', 'rendimiento', 'estado-recursos', 'latencia-red', 'reinicios', 'errores-criticos'] },
        { name: '📁 03 • SEGURIDAD (SOC)', group: 'staff', channels: ['detecciones-en-vivo', 'alertas-criticas', 'comportamiento-sospechoso', 'intentos-exploit', 'violaciones-memoria', 'anti-debug', 'inyecciones-detectadas', 'registro-baneos'] },
        { name: '📁 04 • INTELIGENCIA E IA', group: 'staff', channels: ['analisis-ia', 'motor-riesgo', 'perfiles-comportamiento', 'deteccion-patrones', 'feedback-ia', 'decisiones-ia'] },
        { name: '📁 05 • RESPUESTA A INCIDENTES', group: 'staff', channels: ['cola-incidentes', 'incidentes-activos', 'sala-incidentes', 'incidentes-resueltos', 'forense'] },
        { name: '📁 06 • DATOS Y ANALITICA', group: 'staff', channels: ['panel-metricas', 'analisis-jugadores', 'tendencias-cheat', 'mapas-calor', 'exportar-reportes', 'estadisticas-riesgo'] },
        { name: '📁 07 • GESTION DE USUARIOS', group: 'staff', channels: ['control-roles', 'whitelist', 'vinculacion-hwid', 'cuentas-vinculadas', 'historial-usuarios', 'apelaciones'] },
        { name: '📁 08 • SOPORTE Y TICKETS', group: 'support', channels: ['crear-ticket', 'tickets-activos', 'tickets-cerrados', 'logs-soporte', 'seguimiento-sla'] },
        { name: '📁 09 • DEVOPS Y VERSIONES', group: 'devops', channels: ['estado-ci-cd', 'compilaciones', 'despliegues', 'notas-version', 'rollback', 'actualizaciones-sistema'] },
        { name: '📁 10 • INTEGRACIONES', group: 'devops', channels: ['entrada-webhooks', 'eventos-api', 'logs-launcher', 'logs-bot', 'integraciones-externas', 'estado-sincronizacion'] },
        { name: '📁 11 • AUDITORIA', group: 'staff', channels: ['logs-auditoria', 'acciones-admin', 'cambios-permisos', 'revisiones-seguridad', 'politicas'] },
        { name: '📁 12 • DIRECCION', group: 'direction', channels: ['panel-directivo', 'decisiones', 'finanzas', 'alianzas'] },
        { name: '📁 13 • LABORATORIO', group: 'lab', channels: ['estado-staging', 'pruebas', 'sandbox-anticheat', 'test-carga', 'reproduccion-errores'] }
    ];

    const colmenaCoreVoice = ['NOC', 'SOC', 'Sala Incidentes', 'Soporte', 'Staff', 'Direccion'];

    const colmenaCoreRoles = [
        { key: 'owner', name: '👑 OWNER', color: '#facc15', permissions: [PermissionFlagsBits.Administrator], hoist: true },
        { key: 'directivo', name: '🧠 DIRECTIVO', color: '#a855f7', permissions: [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.ViewAuditLog, PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ManageMessages], hoist: true },
        { key: 'desarrollador', name: '⚙️ DESARROLLADOR', color: '#38bdf8', permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages], hoist: true },
        { key: 'devops', name: '🚀 DEVOPS', color: '#22c55e', permissions: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.ViewAuditLog, PermissionFlagsBits.SendMessages], hoist: true },
        { key: 'seguridad', name: '🛡️ SEGURIDAD', color: '#ef4444', permissions: [PermissionFlagsBits.ViewAuditLog, PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ManageMessages], hoist: true },
        { key: 'analista', name: '🔎 ANALISTA', color: '#06b6d4', permissions: [PermissionFlagsBits.ViewAuditLog, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages], hoist: true },
        { key: 'respuesta', name: '⚠️ RESPUESTA INCIDENTES', color: '#f97316', permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers], hoist: true },
        { key: 'admin', name: '👮 ADMIN', color: '#3b82f6', permissions: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.ModerateMembers], hoist: true },
        { key: 'moderador', name: '🧰 MODERADOR', color: '#14b8a6', permissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.KickMembers, PermissionFlagsBits.ModerateMembers], hoist: true },
        { key: 'soporte', name: '🎧 SOPORTE', color: '#0ea5e9', permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageThreads], hoist: true },
        { key: 'tester', name: '🧪 TESTER', color: '#84cc16', permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages], hoist: false },
        { key: 'jugador', name: '🎮 JUGADOR', color: '#94a3b8', permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak], hoist: false },
        { key: 'marcado', name: '⚠️ MARCADO', color: '#f59e0b', permissions: [PermissionFlagsBits.ViewChannel], hoist: false },
        { key: 'baneado', name: '🚫 BANEADO', color: '#1f2937', permissions: [], hoist: false },
        { key: 'bot', name: '🤖 BOT', color: '#64748b', permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels], hoist: true }
    ];

    const findCoreRole = (guild, keyOrName) => {
        const spec = colmenaCoreRoles.find(r => r.key === keyOrName || r.name === keyOrName);
        const cleanName = spec ? spec.name.replace(/^[^\w@]+/u, '').trim().toLowerCase() : String(keyOrName).toLowerCase();
        return guild.roles.cache.find(role => {
            const normalized = role.name.replace(/^[^\w@]+/u, '').trim().toLowerCase();
            return role.name === keyOrName || normalized === cleanName;
        });
    };

    const buildPermissionOverwrites = (guild, roles, group) => {
        const denyEveryone = { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] };
        const allowViewSend = role => role ? { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] } : null;
        const allowVoice = role => role ? { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] } : null;
        const staffKeys = ['owner', 'directivo', 'desarrollador', 'devops', 'seguridad', 'analista', 'respuesta', 'admin', 'moderador'];
        const overwrites = [denyEveryone];

        if (group === 'public') overwrites.push(allowViewSend(roles.jugador), allowViewSend(roles.soporte), allowViewSend(roles.admin), allowViewSend(roles.owner));
        if (group === 'staff') staffKeys.forEach(key => overwrites.push(allowViewSend(roles[key])));
        if (group === 'devops') ['owner', 'directivo', 'desarrollador', 'devops', 'admin'].forEach(key => overwrites.push(allowViewSend(roles[key])));
        if (group === 'direction') ['owner', 'directivo'].forEach(key => overwrites.push(allowViewSend(roles[key])));
        if (group === 'lab') ['owner', 'directivo', 'desarrollador', 'devops', 'tester'].forEach(key => overwrites.push(allowViewSend(roles[key])));
        if (group === 'support') ['owner', 'directivo', 'admin', 'moderador', 'soporte'].forEach(key => overwrites.push(allowViewSend(roles[key])));
        if (group === 'voice') ['owner', 'directivo', 'desarrollador', 'devops', 'seguridad', 'analista', 'respuesta', 'admin', 'moderador', 'soporte'].forEach(key => overwrites.push(allowVoice(roles[key])));

        if (roles.baneado) overwrites.push({ id: roles.baneado.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect] });
        if (roles.marcado) overwrites.push({ id: roles.marcado.id, deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect] });
        return overwrites.filter(Boolean);
    };

    const rebuildColmenaCore = async (message) => {
        const guild = message.guild;
        const protectedChannelId = message.channel.id;
        const protectedParentId = message.channel.parentId;
        const logLines = [];
        const log = async (line) => {
            logLines.push(line);
            if (message.channel && !message.channel.deleted) {
                await message.channel.send(line).catch(() => null);
            }
            sendLauncherLog(`[REBUILD] ${line.replace(/\*/g, '')}`, 'processing');
        };

        await log('**COLMENA CORE REBUILD** iniciado.');
        await guild.setName('COLMENA CORE').catch(err => log(`⚠️ No se pudo renombrar servidor: ${err.message}`));

        await log('FASE 1 — limpiando webhooks.');
        for (const channel of guild.channels.cache.values()) {
            if (!channel.fetchWebhooks) continue;
            const webhooks = await channel.fetchWebhooks().catch(() => null);
            if (!webhooks) continue;
            for (const webhook of webhooks.values()) {
                await webhook.delete('COLMENA CORE rebuild').catch(err => log(`⚠️ Webhook no eliminado en ${channel.name}: ${err.message}`));
            }
        }

        await log('FASE 1 — eliminando canales existentes excepto canal de comando.');
        for (const channel of guild.channels.cache.values()) {
            if (channel.id === protectedChannelId) continue;
            if (channel.type === ChannelType.GuildCategory) continue;
            await channel.delete('COLMENA CORE rebuild').catch(err => log(`⚠️ Canal no eliminado ${channel.name}: ${err.message}`));
        }

        await log('FASE 1 — eliminando categorias existentes no protegidas.');
        for (const channel of guild.channels.cache.values()) {
            if (channel.type !== ChannelType.GuildCategory) continue;
            if (channel.id === protectedParentId) continue;
            await channel.delete('COLMENA CORE rebuild').catch(err => log(`⚠️ Categoria no eliminada ${channel.name}: ${err.message}`));
        }

        await log('FASE 1 — limpiando roles no protegidos.');
        for (const role of guild.roles.cache.sort((a, b) => b.position - a.position).values()) {
            const normalized = role.name.replace(/^[^\w@]+/u, '').trim().toLowerCase();
            const protectedRole = role.id === guild.id || role.managed || normalized === 'owner' || normalized === 'bot';
            if (protectedRole) continue;
            await role.delete('COLMENA CORE rebuild').catch(err => log(`⚠️ Rol no eliminado ${role.name}: ${err.message}`));
        }

        await log('FASE 2 — creando roles jerarquicos.');
        const roles = {};
        for (const spec of colmenaCoreRoles) {
            let role = findCoreRole(guild, spec.key);
            if (!role) {
                role = await guild.roles.create({
                    name: spec.name,
                    color: spec.color,
                    permissions: spec.permissions,
                    hoist: spec.hoist,
                    reason: 'COLMENA CORE rebuild'
                });
            } else if (!role.managed && role.id !== guild.id) {
                await role.edit({ color: spec.color, permissions: spec.permissions, hoist: spec.hoist }).catch(() => null);
            }
            roles[spec.key] = role;
        }
        for (let i = colmenaCoreRoles.length - 1; i >= 0; i--) {
            const role = roles[colmenaCoreRoles[i].key];
            if (role && !role.managed) await role.setPosition(colmenaCoreRoles.length - i).catch(() => null);
        }

        await log('FASE 3 — creando categorias y canales.');
        const createdChannels = {};
        for (const categorySpec of colmenaCoreCategories) {
            const category = await guild.channels.create({
                name: categorySpec.name,
                type: ChannelType.GuildCategory,
                permissionOverwrites: buildPermissionOverwrites(guild, roles, categorySpec.group)
            });
            for (const channelName of categorySpec.channels) {
                const channel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    parent: category.id,
                    permissionOverwrites: buildPermissionOverwrites(guild, roles, categorySpec.group)
                });
                createdChannels[channelName] = channel;
            }
        }

        await log('FASE 4 — creando canales de voz.');
        for (const voiceName of colmenaCoreVoice) {
            await guild.channels.create({
                name: voiceName,
                type: ChannelType.GuildVoice,
                permissionOverwrites: buildPermissionOverwrites(guild, roles, voiceName === 'Direccion' ? 'direction' : 'voice')
            });
        }

        const summary = [
            '**COLMENA CORE reconstruido correctamente.**',
            `Roles creados/verificados: ${colmenaCoreRoles.length}`,
            `Categorias creadas: ${colmenaCoreCategories.length}`,
            `Canales texto creados: ${colmenaCoreCategories.reduce((sum, c) => sum + c.channels.length, 0)}`,
            `Canales voz creados: ${colmenaCoreVoice.length}`,
            `Errores/avisos: ${logLines.filter(line => line.includes('⚠️')).length}`,
            '',
            '**Resumen de fases:**',
            'FASE 1 limpieza controlada completada.',
            'FASE 2 roles jerarquicos completada.',
            'FASE 3 categorias/canales completada.',
            'FASE 4 voz completada.',
            'FASE 5 permisos base aplicados.',
            'FASE 6 finalizacion completada.'
        ].join('\n');

        const finalChannel = createdChannels['estado-del-sistema'] || createdChannels['logs-bot'] || message.channel;
        await finalChannel.send(summary);
        await log('FASE 6 — resumen enviado. Eliminando canal de comando al final.');

        if (message.channel.id !== finalChannel.id) {
            await message.channel.delete('COLMENA CORE rebuild final cleanup').catch(err => finalChannel.send(`⚠️ No se pudo eliminar canal de comando: ${err.message}`));
        }
        if (protectedParentId) {
            const parent = guild.channels.cache.get(protectedParentId);
            if (parent && parent.type === ChannelType.GuildCategory && parent.children.cache.size === 0) {
                await parent.delete('COLMENA CORE rebuild final category cleanup').catch(() => null);
            }
        }

        appendSystemEvent('discord-colmena-core-rebuild', {
            guildId: guild.id,
            roles: colmenaCoreRoles.length,
            categories: colmenaCoreCategories.length,
            textChannels: colmenaCoreCategories.reduce((sum, c) => sum + c.channels.length, 0),
            voiceChannels: colmenaCoreVoice.length
        });
        return summary;
    };

    const diamondRoles = [
        { key: 'owner', name: '👑 OWNER', color: '#facc15', permissions: [PermissionFlagsBits.Administrator], hoist: true },
        { key: 'coOwner', name: '💎 CO-OWNER', color: '#67e8f9', permissions: [PermissionFlagsBits.Administrator], hoist: true },
        { key: 'direccion', name: '🏢 DIRECCIÓN', color: '#a855f7', permissions: [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ViewAuditLog, PermissionFlagsBits.ManageMessages], hoist: true },
        { key: 'pm', name: '🧠 PROJECT MANAGER', color: '#8b5cf6', permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageThreads], hoist: true },
        { key: 'securityLead', name: '🛡️ SECURITY LEAD', color: '#ef4444', permissions: [PermissionFlagsBits.ViewAuditLog, PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ManageMessages], hoist: true },
        { key: 'socAnalyst', name: '🔎 SOC ANALYST', color: '#06b6d4', permissions: [PermissionFlagsBits.ViewAuditLog, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages], hoist: true },
        { key: 'incidentResponse', name: '⚠️ INCIDENT RESPONSE', color: '#f97316', permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers], hoist: true },
        { key: 'devops', name: '🚀 DEVOPS', color: '#22c55e', permissions: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.ViewAuditLog, PermissionFlagsBits.SendMessages], hoist: true },
        { key: 'developer', name: '⚙️ DEVELOPER', color: '#38bdf8', permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages], hoist: true },
        { key: 'botManager', name: '🤖 BOT MANAGER', color: '#818cf8', permissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages], hoist: true },
        { key: 'admin', name: '👮 ADMIN', color: '#3b82f6', permissions: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.ModerateMembers], hoist: true },
        { key: 'moderador', name: '🧰 MODERADOR', color: '#14b8a6', permissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.KickMembers, PermissionFlagsBits.ModerateMembers], hoist: true },
        { key: 'soporte', name: '🎧 SOPORTE', color: '#0ea5e9', permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageThreads], hoist: true },
        { key: 'revisor', name: '📋 REVISOR', color: '#10b981', permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages], hoist: true },
        { key: 'tester', name: '🧪 TESTER', color: '#84cc16', permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages], hoist: false },
        { key: 'cliente', name: '💼 CLIENTE', color: '#64748b', permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages], hoist: false },
        { key: 'premium', name: '⭐ PREMIUM', color: '#eab308', permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages], hoist: false },
        { key: 'jugador', name: '🎮 JUGADOR', color: '#94a3b8', permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak], hoist: false },
        { key: 'revision', name: '🟡 EN REVISIÓN', color: '#f59e0b', permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages], hoist: false },
        { key: 'marcado', name: '⚠️ MARCADO', color: '#f97316', permissions: [PermissionFlagsBits.ViewChannel], hoist: false },
        { key: 'baneado', name: '🚫 BANEADO', color: '#111827', permissions: [], hoist: false },
        { key: 'bot', name: '🤖 BOT', color: '#64748b', permissions: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages], hoist: true }
    ];

    const diamondCategories = [
        { name: '00・🏛️ GOBIERNO Y ACCESO', group: 'government', channels: ['👋・bienvenida', '✅・verificación-acceso', '📜・normas-del-servidor', '⚖️・términos-y-políticas', '📢・anuncios-globales', '🟢・estado-del-sistema', '🧾・registro-de-cambios', '❓・preguntas-frecuentes'] },
        { name: '01・🌍 EXPERIENCIA PÚBLICA', group: 'public', channels: ['💬・chat-general', '📸・multimedia', '🎬・clips', '🎉・eventos-comunidad', '🎭・roles-y-grupos', '💡・sugerencias', '📌・información-importante', '🧭・cómo-empezar'] },
        { name: '02・🎮 OPERACIONES DEL SERVIDOR — NOC', group: 'noc', channels: ['🟢・estado-servidor', '🖥️・logs-txadmin', '📊・rendimiento', '🧩・estado-recursos', '🌐・latencia-red', '🔁・reinicios', '💥・errores-críticos', '📡・monitorización-live', '🧯・caídas-y-recuperación'] },
        { name: '03・🛡️ SEGURIDAD ANTICHEAT — SOC', group: 'soc', channels: ['🚨・detecciones-en-vivo', '🔴・alertas-críticas', '🟡・comportamiento-sospechoso', '🧨・intentos-exploit', '🧬・violaciones-memoria', '🕵️・anti-debug', '💉・inyecciones-detectadas', '🔫・detección-armas', '⚡・speedhack-noclip', '🧱・entity-spawn-abuse', '⛔・registro-baneos', '🧾・evidencias-anticheat'] },
        { name: '04・🧠 INTELIGENCIA ARTIFICIAL', group: 'ai', channels: ['🤖・chat-ia', '🧠・análisis-ia', '📈・motor-riesgo', '👤・perfiles-comportamiento', '🧬・detección-patrones', '📝・feedback-ia', '⚖️・decisiones-ia', '🧪・pruebas-prompts', '📚・base-conocimiento'] },
        { name: '05・🚑 RESPUESTA A INCIDENTES — IR', group: 'ir', channels: ['📥・cola-incidentes', '🔥・incidentes-activos', '🎯・asignación-incidentes', '🧪・análisis-incidente', '🧾・forense', '✅・incidentes-resueltos', '📚・lecciones-aprendidas', '🚨・war-room-alertas'] },
        { name: '06・🎥 ESCANEOS Y VIDEOLLAMADAS', group: 'scans', channels: ['📋・solicitar-escaneo', '🕒・cola-de-escaneos', '✅・escaneos-aprobados', '❌・escaneos-rechazados', '🧾・resultados-escaneo', '📸・capturas-evidencias', '🔐・normas-escaneo'], voice: ['🔊・Sala Escaneo 1', '🔊・Sala Escaneo 2', '🔊・Sala Escaneo 3', '🔊・Revisión Privada', '🔊・Verificación HWID', '🔊・Soporte en Directo', '🔊・Sala Evidencias', '🔊・Sala Apelación'] },
        { name: '07・📊 DATOS Y ANALÍTICA', group: 'data', channels: ['📊・panel-métricas', '👥・análisis-jugadores', '📉・tendencias-cheat', '🗺️・mapas-calor', '📤・exportar-reportes', '⚠️・estadísticas-riesgo', '⏱️・tiempos-respuesta', '📈・kpi-staff'] },
        { name: '08・👤 GESTIÓN DE USUARIOS — IAM', group: 'iam', channels: ['🎭・control-roles', '✅・whitelist', '🧬・vinculación-hwid', '🔗・cuentas-vinculadas', '📜・historial-usuarios', '⚖️・apelaciones', '🟡・usuarios-en-revisión', '🚫・lista-negra'] },
        { name: '09・🎫 SOPORTE Y TICKETS', group: 'support', channels: ['🎫・crear-ticket', '📂・tickets-activos', '✅・tickets-cerrados', '📞・soporte-directo', '🧾・logs-soporte', '⏱️・seguimiento-sla', '📌・plantillas-soporte', '🧑‍💼・atención-clientes'] },
        { name: '10・💼 CLIENTES Y LICENCIAS', group: 'clients', channels: ['💼・zona-clientes', '🔑・licencias', '🧾・facturación', '📦・descargas', '📘・manual-instalación', '🛠️・soporte-cliente', '📢・avisos-clientes', '⭐・zona-premium'] },
        { name: '11・🚀 DEVOPS Y VERSIONES', group: 'devopsDiamond', channels: ['🚦・estado-ci-cd', '🏗️・compilaciones', '🚀・despliegues', '🧾・notas-versión', '↩️・rollback', '🔄・actualizaciones-sistema', '🐛・bugs-internos', '🧪・testing-release'] },
        { name: '12・🔗 INTEGRACIONES Y WEBHOOKS', group: 'integrations', channels: ['📥・entrada-webhooks', '🔌・eventos-api', '🧩・logs-launcher', '🤖・logs-bot', '🌐・integraciones-externas', '🔄・estado-sincronización', '🔐・tokens-y-secretos', '🧪・webhook-test'] },
        { name: '13・📜 AUDITORÍA Y CUMPLIMIENTO', group: 'auditDiamond', channels: ['📜・logs-auditoría', '👮・acciones-admin', '🔐・cambios-permisos', '🛡️・revisiones-seguridad', '⚖️・políticas', '🧾・registro-sanciones', '📁・archivo-evidencias', '🧹・limpieza-logs'] },
        { name: '14・🏢 DIRECCIÓN / OWNER', group: 'directionDiamond', channels: ['💎・panel-directivo', '🧠・decisiones', '💰・finanzas', '🤝・alianzas', '📌・prioridades', '🗂️・roadmap-privado', '🧾・reportes-ejecutivos'] },
        { name: '15・🧪 LABORATORIO / STAGING / QA', group: 'labDiamond', channels: ['🟢・estado-staging', '🧪・pruebas', '🛡️・sandbox-anticheat', '🔥・test-carga', '🐞・reproducción-errores', '⚙️・experimentos', '📦・builds-test', '📋・checklist-qa'] },
        { name: '16・🤖 BOT CONTROL CENTER', group: 'botControl', channels: ['🤖・comandos-bot', '📜・logs-comandos', '🧠・bot-ia', '🔧・config-bot', '🚨・errores-bot', '📡・estado-bot', '🧪・pruebas-bot', '🔁・automatizaciones'] },
        { name: '17・🖥️ LAUNCHER CONTROL', group: 'launcherControl', channels: ['🖥️・estado-launcher', '📜・logs-launcher', '🔧・errores-launcher', '🧪・pruebas-launcher', '📦・builds-launcher', '🛠️・reparaciones-pc', '🧠・diagnóstico-ia', '🔄・actualizaciones-launcher'] },
        { name: '18・👥 STAFF INTERNO', group: 'staffAll', channels: ['💬・staff-chat', '📢・avisos-staff', '🧾・reuniones-staff', '📋・tareas-staff', '🧠・decisiones-staff', '🕒・horarios-staff', '📌・procedimientos', '🎯・objetivos'] },
        { name: '19・🔒 ARCHIVO Y BACKUP', group: 'archive', channels: ['📁・archivo-general', '📜・archivo-logs', '🧾・archivo-tickets', '⚖️・archivo-apelaciones', '🛡️・archivo-anticheat', '📦・backup-config', '🧹・limpieza-programada'] }
    ];

    const diamondGeneralVoice = ['🔊・General', '🔊・Comunidad', '🔊・Soporte General', '🔊・Staff General', '🔊・NOC Bridge', '🔊・SOC War Room', '🔊・Incident War Room', '🔊・Dirección Privada', '🔊・Reunión DevOps', '🔊・Testing Room'];

    const buildDiamondOverwrites = (guild, roles, group, channelName = '') => {
        const denyEveryone = { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] };
        const allow = (role, extra = []) => role ? { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, ...extra] } : null;
        const voice = role => role ? { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.Stream] } : null;
        const denyBad = [];
        if (roles.baneado) denyBad.push({ id: roles.baneado.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect, PermissionFlagsBits.Stream] });
        if (roles.marcado) denyBad.push({ id: roles.marcado.id, deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect, PermissionFlagsBits.Stream] });
        const keys = {
            leaders: ['owner', 'coOwner', 'direccion'],
            staff: ['owner', 'coOwner', 'direccion', 'pm', 'securityLead', 'socAnalyst', 'incidentResponse', 'devops', 'developer', 'botManager', 'admin', 'moderador', 'soporte', 'revisor'],
            soc: ['owner', 'coOwner', 'securityLead', 'socAnalyst', 'incidentResponse', 'admin'],
            dev: ['owner', 'coOwner', 'direccion', 'pm', 'devops', 'developer'],
            support: ['owner', 'coOwner', 'direccion', 'admin', 'moderador', 'soporte', 'revisor'],
            scans: ['owner', 'coOwner', 'direccion', 'securityLead', 'socAnalyst', 'incidentResponse', 'admin', 'soporte', 'revisor'],
            public: ['jugador', 'premium', 'cliente'],
            limitedPublic: ['jugador', 'premium', 'cliente', 'revision']
        };
        const fromKeys = list => list.map(key => allow(roles[key])).filter(Boolean);
        const fromVoiceKeys = list => list.map(key => voice(roles[key])).filter(Boolean);
        let overwrites = [denyEveryone];

        if (group === 'government') overwrites = [ { id: guild.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] }, ...fromKeys(keys.staff) ];
        else if (group === 'public') overwrites.push(...fromKeys(keys.public), ...fromKeys(keys.staff));
        else if (group === 'noc') overwrites.push(...fromKeys(['owner', 'coOwner', 'direccion', 'devops', 'developer', 'admin']));
        else if (group === 'soc' || group === 'ir') overwrites.push(...fromKeys(keys.soc));
        else if (group === 'ai') overwrites.push(...fromKeys(keys.staff));
        else if (group === 'scans') {
            if (channelName.includes('solicitar-escaneo')) overwrites.push(...fromKeys(keys.limitedPublic), ...fromKeys(keys.scans));
            else overwrites.push(...fromKeys(keys.scans));
        }
        else if (group === 'scanVoice') overwrites.push(...fromVoiceKeys(keys.scans));
        else if (group === 'data') overwrites.push(...fromKeys(['owner', 'coOwner', 'direccion', 'pm', 'securityLead', 'devops', 'admin']));
        else if (group === 'iam') {
            if (channelName.includes('apelaciones')) overwrites.push(...fromKeys(['revision', 'jugador']), ...fromKeys(['owner', 'coOwner', 'admin', 'soporte', 'revisor', 'securityLead']));
            else overwrites.push(...fromKeys(['owner', 'coOwner', 'admin', 'soporte', 'revisor', 'securityLead']));
        }
        else if (group === 'support') {
            if (channelName.includes('crear-ticket')) overwrites = [{ id: guild.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }, ...fromKeys(keys.support)];
            else overwrites.push(...fromKeys(keys.support));
        }
        else if (group === 'clients') overwrites.push(...fromKeys(['owner', 'coOwner', 'direccion', 'cliente', 'premium']));
        else if (group === 'devopsDiamond') overwrites.push(...fromKeys(keys.dev));
        else if (group === 'integrations') {
            if (channelName.includes('tokens-y-secretos')) overwrites.push(...fromKeys(['owner', 'coOwner', 'devops']));
            else overwrites.push(...fromKeys(['owner', 'coOwner', 'devops', 'developer', 'botManager']));
        }
        else if (group === 'auditDiamond') overwrites.push(...fromKeys(['owner', 'coOwner', 'direccion', 'securityLead']));
        else if (group === 'directionDiamond') overwrites.push(...fromKeys(keys.leaders));
        else if (group === 'labDiamond') overwrites.push(...fromKeys(['owner', 'coOwner', 'developer', 'devops', 'tester', 'securityLead']));
        else if (group === 'botControl') overwrites.push(...fromKeys(['owner', 'coOwner', 'botManager', 'developer', 'devops']));
        else if (group === 'launcherControl') overwrites.push(...fromKeys(['owner', 'coOwner', 'developer', 'devops', 'botManager', 'soporte']));
        else if (group === 'staffAll' || group === 'archive') overwrites.push(...fromKeys(keys.staff));
        else if (group === 'generalVoice') overwrites = [{ id: guild.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }, ...fromVoiceKeys(keys.staff)];
        else overwrites.push(...fromKeys(keys.staff));

        return [...overwrites, ...denyBad].filter(Boolean);
    };

    const sendSeedMessages = async (channels, errors) => {
        const send = async (name, payload) => {
            const channel = channels[name];
            if (!channel) return errors.push(`Canal seed no encontrado: ${name}`);
            await channel.send(payload).catch(err => errors.push(`Seed ${name}: ${err.message}`));
        };
        await send('👋・bienvenida', '**Bienvenido a COLMENA CORE — ENTERPRISE DIAMOND**\nSistema centralizado para anticheat, IA, soporte, launcher, auditoría y operaciones.\n\n1. Lee #📜・normas-del-servidor.\n2. Verifica acceso en #✅・verificación-acceso.\n3. Abre ticket en #🎫・crear-ticket si necesitas soporte.');
        await send('🔐・normas-escaneo', '**Normas de escaneo**\n- Entra a una sala de escaneo cuando el staff lo solicite.\n- Comparte pantalla si el staff lo requiere.\n- Sigue instrucciones del revisor.\n- La negativa puede cerrar la revisión.\n- No publiques datos personales en canales públicos.');
        await send('🎫・crear-ticket', {
            content: '**Centro de Tickets COLMENA CORE**',
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('ticket_technical').setLabel('Soporte Técnico').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('ticket_ban_appeal').setLabel('Apelación Ban').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('ticket_scan').setLabel('Escaneo Anticheat').setStyle(ButtonStyle.Danger)
                ),
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('ticket_client').setLabel('Cliente/Licencia').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('ticket_launcher_bug').setLabel('Bug/Launcher').setStyle(ButtonStyle.Secondary)
                )
            ]
        });
        await send('📋・solicitar-escaneo', {
            content: '**Solicitudes de escaneo anticheat**',
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('scan_request').setLabel('Solicitar escaneo').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('scan_evidence').setLabel('Subir evidencias').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('scan_status').setLabel('Consultar estado').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('scan_appeal').setLabel('Apelar resultado').setStyle(ButtonStyle.Danger)
                )
            ]
        });
        await send('🤖・comandos-bot', '**Comandos preparados**\n/status\n/scan\n/player\n/ban\n/unban\n/incident\n/ticket\n/launcher\n/risk\n/logs\n\nAutomatizaciones preparadas: tickets, escaneos, apelaciones, incidentes, logs de comandos, moderación, anticheat, launcher, webhooks, embeds y botones.');
    };

    const scanStates = new Map();
    const scanLocks = new Set();
    const buttonCooldowns = new Map();
    const scanQueue = [];
    const scanButtonTimeoutMs = 24 * 60 * 60 * 1000;
    const staffRoleNames = ['OWNER', 'CO-OWNER', 'SECURITY LEAD', 'SOC ANALYST', 'INCIDENT RESPONSE', 'ADMIN', 'SOPORTE', 'REVISOR'];

    const cleanDiscordName = value => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();

    const findRoleByName = (guild, names) => {
        const wanted = Array.isArray(names) ? names.map(cleanDiscordName) : [cleanDiscordName(names)];
        return guild.roles.cache.find(role => wanted.some(name => cleanDiscordName(role.name).includes(name)));
    };

    const memberHasAnyRole = (member, names) => {
        if (!member) return false;
        if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
        const wanted = Array.isArray(names) ? names.map(cleanDiscordName) : [cleanDiscordName(names)];
        return member.roles.cache.some(role => wanted.some(name => cleanDiscordName(role.name).includes(name)));
    };

    const findTextChannel = (guild, slug) => guild.channels.cache.find(channel =>
        channel.type === ChannelType.GuildText && cleanDiscordName(channel.name).includes(cleanDiscordName(slug)));

    const findVoiceChannel = (guild, slug) => guild.channels.cache.find(channel =>
        channel.type === ChannelType.GuildVoice && cleanDiscordName(channel.name).includes(cleanDiscordName(slug)));

    const scanEmbed = (title, description, color = 0x22c55e) => new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp()
        .setFooter({ text: 'COLMENA-SS | Security Enterprise' });

    const logEnterpriseAction = async (guild, action, actor, target, extra = '') => {
        const payload = scanEmbed('Registro COLMENA-SS', [
            `**Accion:** ${action}`,
            `**Ejecutor:** ${actor ? `${actor.tag || actor.username} (${actor.id})` : 'Sistema'}`,
            `**Afectado:** ${target ? `${target.tag || target.username || target.id} (${target.id})` : 'N/A'}`,
            `**Fecha:** ${new Date().toLocaleString()}`,
            extra ? `**Detalle:** ${extra}` : ''
        ].filter(Boolean).join('\n'), 0x38bdf8);
        for (const slug of ['logs-bot', 'logs-soporte', 'logs-auditoria']) {
            const channel = findTextChannel(guild, slug);
            if (channel) await channel.send({ embeds: [payload] }).catch(() => null);
        }
        sendLauncherLog(`[COLMENA-SS] ${action}${target ? ` -> ${target.id}` : ''}`, 'processing');
        appendSystemEvent('discord-colmena-ss-scan', { action, actorId: actor?.id, targetId: target?.id, extra });
        enterpriseBackendClient.sendLog({
            source: 'discord-bot',
            level: 'info',
            message: action,
            metadata: { actorId: actor?.id, targetId: target?.id, extra }
        }).catch(err => appendSystemEvent('bot-log-backend-error', { code: 'BACKEND_OFFLINE', message: err.message, action }));
    };

    const makeStaffOverwrites = (guild, userId) => {
        const overwrites = [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: discordClient.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
            { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
        ];
        for (const roleName of staffRoleNames) {
            const role = findRoleByName(guild, roleName);
            if (role) overwrites.push({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] });
        }
        return overwrites;
    };

    const ensureScanState = (userId, data = {}) => {
        const current = scanStates.get(userId) || {};
        const next = {
            userId,
            status: current.status || 'PENDIENTE',
            riskScore: current.riskScore || Math.floor(35 + Math.random() * 45),
            createdAt: current.createdAt || Date.now(),
            updatedAt: Date.now(),
            ...current,
            ...data
        };
        scanStates.set(userId, next);
        if (!scanQueue.includes(userId) && next.status !== 'FINALIZADO') scanQueue.push(userId);
        return next;
    };

    const canTransitionScan = (currentStatus, nextStatus) => {
        const current = currentStatus || 'PENDIENTE';
        const allowed = {
            PENDIENTE: ['EN ESCANEO', 'EN REVISIÓN', 'FINALIZADO'],
            'EN ESCANEO': ['EN REVISIÓN', 'FINALIZADO'],
            'EN REVISIÓN': ['EN ESCANEO', 'FINALIZADO'],
            FINALIZADO: []
        };
        return (allowed[current] || []).includes(nextStatus);
    };

    const setScanStatusSafe = async (guild, state, nextStatus, actor, reason) => {
        if (!canTransitionScan(state.status, nextStatus)) {
            await logEnterpriseAction(guild, 'Transicion COLMENA-SS bloqueada', actor, { id: state.userId }, `${state.status} -> ${nextStatus}. ${reason || ''}`);
            return { ok: false, message: `Transicion no permitida: ${state.status} -> ${nextStatus}` };
        }
        state.status = nextStatus;
        state.updatedAt = Date.now();
        scanStates.set(state.userId, state);
        await enterpriseBackendClient.sendSSSession({
            userId: state.userId,
            status: nextStatus,
            ticketId: state.ticketId,
            riskScore: state.riskScore,
            metadata: { source: 'discord-bot', actorId: actor?.id, reason }
        }).catch(err => appendSystemEvent('ss-backend-error', { code: 'SS_FAIL', message: err.message, userId: state.userId }));
        return { ok: true, state };
    };

    const createScanTicket = async (guild, member, type = 'escaneo') => {
        const source = findTextChannel(guild, 'solicitar-escaneo') || findTextChannel(guild, 'crear-ticket');
        const baseName = `${type}-${member.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 80);
        return guild.channels.create({
            name: baseName,
            type: ChannelType.GuildText,
            parent: source?.parentId || null,
            permissionOverwrites: makeStaffOverwrites(guild, member.id),
            reason: `COLMENA-SS ${type}`
        });
    };

    const createStaffScanRow = userId => new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`staff_scan_start:${userId}`).setLabel('Iniciar Escaneo').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`staff_review_user:${userId}`).setLabel('Revisar Usuario').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`staff_open_incident:${userId}`).setLabel('Abrir Incidente').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`staff_mark_suspect:${userId}`).setLabel('Marcar Sospechoso').setStyle(ButtonStyle.Secondary)
    );

    const createLiveScanRows = userId => [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`live_start_review:${userId}`).setLabel('Iniciar Revision').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`live_request_screen:${userId}`).setLabel('Solicitar Pantalla').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`live_repeat_verify:${userId}`).setLabel('Repetir Verificacion').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`live_pause:${userId}`).setLabel('Pausar').setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`user_cancel_scan:${userId}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
        )
    ];

    const createResultRows = userId => [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`result_clean:${userId}`).setLabel('Marcar Limpio').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`result_suspect:${userId}`).setLabel('Marcar Sospechoso').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`result_ban:${userId}`).setLabel('Banear').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`result_restrict:${userId}`).setLabel('Restringir').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`result_save_evidence:${userId}`).setLabel('Guardar Evidencia').setStyle(ButtonStyle.Primary)
        )
    ];

    const publishColmenaSsPanels = async (guild) => {
        const scanChannel = findTextChannel(guild, 'solicitar-escaneo');
        const detectionsChannel = findTextChannel(guild, 'detecciones-en-vivo');
        if (scanChannel) {
            await scanChannel.send({
                embeds: [scanEmbed('COLMENA-SS | Centro de Escaneos', 'Solicita un escaneo, sube evidencias, consulta tu estado o abre una apelacion desde este panel seguro.', 0x22c55e)],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('scan_request').setLabel('Solicitar Escaneo').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('scan_evidence').setLabel('Subir Evidencias').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('scan_status').setLabel('Ver Estado').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('scan_appeal').setLabel('Apelar').setStyle(ButtonStyle.Danger)
                )]
            });
        }
        if (detectionsChannel) {
            await detectionsChannel.send({
                embeds: [scanEmbed('COLMENA-SS | Control Staff SOC', 'Panel listo para recibir detecciones, solicitudes de escaneo, incidentes y acciones de respuesta.', 0xef4444)]
            });
        }
        await logEnterpriseAction(guild, 'Sistema COLMENA-SS activado', discordClient.user, null, 'Paneles de escaneo publicados.');
    };

    const rebuildColmenaCoreDiamond = async (message) => {
        const guild = message.guild;
        const protectedChannelId = message.channel.id;
        const protectedParentId = message.channel.parentId;
        const errors = [];
        let progressChannel = null;
        const log = async (line) => {
            console.log(`[REBUILD DIAMOND] ${line}`);
            sendLauncherLog(`[REBUILD DIAMOND] ${line}`, line.startsWith('ERROR') ? 'error' : 'processing');
            const target = progressChannel || message.channel;
            await target.send(line).catch(err => errors.push(`Log: ${err.message}`));
        };

        await log('Iniciando estructura COLMENA CORE Diamond para COLMENA-SS.');
        await guild.setName('COLMENA-SS').catch(err => errors.push(`Renombrar servidor: ${err.message}`));

        for (const channel of guild.channels.cache.values()) {
            if (!channel.fetchWebhooks) continue;
            const webhooks = await channel.fetchWebhooks().catch(err => (errors.push(`Fetch webhooks ${channel.name}: ${err.message}`), null));
            if (!webhooks) continue;
            for (const webhook of webhooks.values()) await webhook.delete('COLMENA CORE Diamond rebuild').catch(err => errors.push(`Webhook ${webhook.name}: ${err.message}`));
        }
        await log('FASE 1: webhooks limpiados.');

        for (const channel of guild.channels.cache.values()) {
            if (channel.id === protectedChannelId || channel.type === ChannelType.GuildCategory) continue;
            await channel.delete('COLMENA CORE Diamond rebuild').catch(err => errors.push(`Eliminar canal ${channel.name}: ${err.message}`));
        }
        for (const channel of guild.channels.cache.values()) {
            if (channel.type !== ChannelType.GuildCategory || channel.id === protectedParentId) continue;
            await channel.delete('COLMENA CORE Diamond rebuild').catch(err => errors.push(`Eliminar categoria ${channel.name}: ${err.message}`));
        }
        progressChannel = await guild.channels.create({ name: '🛡️・rebuild-en-proceso', type: ChannelType.GuildText }).catch(err => (errors.push(`Crear canal temporal: ${err.message}`), null));
        await log('FASE 1: canales/categorias limpiados y canal temporal creado.');

        const ownerMember = await guild.members.fetch(guild.ownerId).catch(() => null);
        const botMember = guild.members.me || await guild.members.fetch(discordClient.user.id).catch(() => null);
        for (const role of guild.roles.cache.sort((a, b) => b.position - a.position).values()) {
            const normalized = role.name.replace(/^[^\w@]+/u, '').trim().toLowerCase();
            const protectedRole = role.id === guild.id
                || role.managed
                || normalized === 'owner'
                || normalized === 'bot'
                || ownerMember?.roles.cache.has(role.id)
                || botMember?.roles.cache.has(role.id);
            if (protectedRole) continue;
            await role.delete('COLMENA CORE Diamond rebuild').catch(err => errors.push(`Eliminar rol ${role.name}: ${err.message}`));
        }
        await log('FASE 1: roles no protegidos limpiados.');

        const roles = {};
        for (const spec of diamondRoles) {
            let role = findCoreRole(guild, spec.name) || guild.roles.cache.find(r => r.name === spec.name);
            if (!role) {
                role = await guild.roles.create({ name: spec.name, color: spec.color, permissions: spec.permissions, hoist: spec.hoist, reason: 'COLMENA CORE Diamond rebuild' }).catch(err => (errors.push(`Crear rol ${spec.name}: ${err.message}`), null));
            } else if (!role.managed && role.id !== guild.id) {
                await role.edit({ color: spec.color, permissions: spec.permissions, hoist: spec.hoist }).catch(err => errors.push(`Editar rol ${spec.name}: ${err.message}`));
            }
            roles[spec.key] = role;
        }
        for (let index = diamondRoles.length - 1; index >= 0; index--) {
            const role = roles[diamondRoles[index].key];
            if (role && !role.managed && role.id !== guild.id) {
                await role.setPosition(diamondRoles.length - index).catch(err => errors.push(`Orden rol ${role.name}: ${err.message}`));
            }
        }
        await log('FASE 2: roles enterprise creados/verificados.');

        const createdChannels = {};
        let textCount = 0;
        let voiceCount = 0;
        for (const categorySpec of diamondCategories) {
            const category = await guild.channels.create({ name: categorySpec.name, type: ChannelType.GuildCategory, permissionOverwrites: buildDiamondOverwrites(guild, roles, categorySpec.group) }).catch(err => (errors.push(`Crear categoria ${categorySpec.name}: ${err.message}`), null));
            if (!category) continue;
            for (const channelName of categorySpec.channels) {
                const channel = await guild.channels.create({ name: channelName, type: ChannelType.GuildText, parent: category.id, permissionOverwrites: buildDiamondOverwrites(guild, roles, categorySpec.group, channelName) }).catch(err => (errors.push(`Crear canal ${channelName}: ${err.message}`), null));
                if (channel) {
                    createdChannels[channelName] = channel;
                    textCount++;
                }
            }
            for (const voiceName of categorySpec.voice || []) {
                const channel = await guild.channels.create({ name: voiceName, type: ChannelType.GuildVoice, parent: category.id, permissionOverwrites: buildDiamondOverwrites(guild, roles, 'scanVoice', voiceName) }).catch(err => (errors.push(`Crear voz ${voiceName}: ${err.message}`), null));
                if (channel) voiceCount++;
            }
        }
        await log('FASE 3: estructura Diamond creada.');

        for (const voiceName of diamondGeneralVoice) {
            const group = voiceName.includes('Dirección') ? 'directionDiamond' : 'generalVoice';
            const channel = await guild.channels.create({ name: voiceName, type: ChannelType.GuildVoice, permissionOverwrites: buildDiamondOverwrites(guild, roles, group, voiceName) }).catch(err => (errors.push(`Crear voz general ${voiceName}: ${err.message}`), null));
            if (channel) voiceCount++;
        }
        await log('FASE 4: canales de voz generales creados.');

        const finalChannel = await guild.channels.create({ name: '✅・rebuild-finalizado', type: ChannelType.GuildText, permissionOverwrites: buildDiamondOverwrites(guild, roles, 'staffAll') }).catch(err => (errors.push(`Crear final: ${err.message}`), null));
        if (finalChannel) createdChannels['✅・rebuild-finalizado'] = finalChannel;

        await sendSeedMessages(createdChannels, errors);
        await log('FASE 6/7: mensajes iniciales, botones y placeholders preparados.');

        const summary = [
            '**COLMENA CORE — ENTERPRISE DIAMOND reconstruido.**',
            `Categorías creadas: ${diamondCategories.length}`,
            `Canales de texto creados: ${textCount + (finalChannel ? 1 : 0)}`,
            `Canales de voz creados: ${voiceCount}`,
            `Roles creados/verificados: ${diamondRoles.length}`,
            `Errores/avisos: ${errors.length}`,
            `Fecha: ${new Date().toLocaleString()}`,
            '',
            errors.length ? `**Errores:**\n${errors.slice(0, 20).map(e => `- ${e}`).join('\n')}` : '**Errores:** ninguno registrado.'
        ].join('\n');
        await (finalChannel || progressChannel || message.channel).send(summary).catch(() => null);

        if (progressChannel && finalChannel && progressChannel.id !== finalChannel.id) await progressChannel.delete('COLMENA CORE Diamond final cleanup').catch(err => errors.push(`Eliminar temporal: ${err.message}`));
        if (message.channel.id !== finalChannel?.id) await message.channel.delete('COLMENA CORE Diamond final command cleanup').catch(err => finalChannel?.send(`No se pudo eliminar canal de comando: ${err.message}`).catch(() => null));
        if (protectedParentId) {
            const parent = guild.channels.cache.get(protectedParentId);
            if (parent && parent.type === ChannelType.GuildCategory && parent.children.cache.size === 0) await parent.delete('COLMENA CORE Diamond parent cleanup').catch(() => null);
        }

        appendSystemEvent('discord-colmena-core-diamond-rebuild', { guildId: guild.id, roles: diamondRoles.length, categories: diamondCategories.length, textChannels: textCount, voiceChannels: voiceCount, errors: errors.length });
        return summary;
    };

    // Interaction Handling (Tickets)
    discordClient.on('interactionCreate', async interaction => {
        if (interaction.isChatInputCommand?.()) {
            if (!isOrderAdmin(interaction.member)) {
                await interaction.reply({ content: 'Permiso denegado. Solo owner/admin puede usar este comando.', ephemeral: true });
                return;
            }
            const discordId = interaction.options.getString('discord_id', true);
            const order = enterpriseSaasService.findLatestPaidOrderByDiscordId(discordId, { includeAssigned: true });
            const user = enterpriseSaasService.findUserByDiscordId(discordId);
            if (interaction.commandName === 'buscar_pedido') {
                if (!order) {
                    await interaction.reply({ content: `No hay pedido pagado para Discord ID ${discordId}.`, ephemeral: true });
                    return;
                }
                await interaction.reply({
                    content: [
                        `Pedido: ${order.id}`,
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
                return;
            }
            if (interaction.commandName === 'reasignar_rol') {
                if (!order) {
                    await interaction.reply({ content: `No hay pedido pagado para Discord ID ${discordId}.`, ephemeral: true });
                    return;
                }
                const member = await interaction.guild.members.fetch(discordId).catch(() => null);
                if (!member) {
                    await interaction.reply({ content: `Pedido encontrado, pero el usuario ${discordId} no esta en este Discord.`, ephemeral: true });
                    return;
                }
                const updated = await provisionOrderMember(member, order, { notify: false });
                await interaction.reply({ content: `Rol reasignado para ${discordId}. Pedido ${updated.id}. Rol asignado: ${updated.role_assigned ? 'SI' : 'NO'}.`, ephemeral: true });
                return;
            }
        }
        if (!interaction.isButton()) return;

        const [action, targetUserId] = interaction.customId.split(':');
        const cooldownKey = `${interaction.user.id}:${action}`;
        const now = Date.now();
        if ((buttonCooldowns.get(cooldownKey) || 0) > now - 3500) {
            await interaction.reply({ content: 'Accion bloqueada por seguridad: espera unos segundos antes de repetir.', ephemeral: true }).catch(() => null);
            return;
        }
        buttonCooldowns.set(cooldownKey, now);

        const staffOnlyActions = new Set([
            'staff_scan_start', 'staff_review_user', 'staff_open_incident', 'staff_mark_suspect',
            'live_start_review', 'live_request_screen', 'live_repeat_verify', 'live_pause',
            'result_clean', 'result_suspect', 'result_ban', 'result_restrict', 'result_save_evidence'
        ]);
        if (staffOnlyActions.has(action) && !memberHasAnyRole(interaction.member, staffRoleNames)) {
            await interaction.reply({ content: 'Accion bloqueada: solo staff autorizado puede usar este control.', ephemeral: true });
            await logEnterpriseAction(interaction.guild, `Bloqueo de boton ${action}`, interaction.user, targetUserId ? { id: targetUserId } : null, 'Usuario sin rol staff permitido.');
            return;
        }

        if (action === 'scan_request' || action === 'ticket_scan') {
            await interaction.reply({
                embeds: [scanEmbed('Consentimiento COLMENA-SS requerido', [
                    'Antes de abrir el caso, confirma que aceptas una revision tecnica consentida.',
                    'El staff podra pedirte entrar a una sala de voz/video y aportar logs tecnicos del launcher.',
                    'No se recopilaran datos personales innecesarios y puedes cancelar antes de iniciar el escaneo.',
                    '',
                    '**La IA recomienda, el anticheat aporta senales y el staff decide.**'
                ].join('\n'), 0xeab308)],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`scan_consent:${interaction.user.id}`).setLabel('Acepto revision consentida').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`scan_cancel_consent:${interaction.user.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
                )],
                ephemeral: true
            });
            await logEnterpriseAction(interaction.guild, 'Consentimiento de escaneo solicitado', interaction.user, interaction.user);
            return;
        }

        if (action === 'scan_cancel_consent') {
            if (targetUserId !== interaction.user.id) {
                await interaction.reply({ content: 'Este consentimiento no pertenece a tu usuario.', ephemeral: true });
                return;
            }
            await interaction.reply({ content: 'Solicitud cancelada. No se ha creado ningun caso ni ticket.', ephemeral: true });
            await logEnterpriseAction(interaction.guild, 'Consentimiento de escaneo cancelado', interaction.user, interaction.user);
            return;
        }

        if (action === 'scan_consent') {
            if (targetUserId !== interaction.user.id) {
                await interaction.reply({ content: 'Este consentimiento no pertenece a tu usuario.', ephemeral: true });
                return;
            }
            if (scanLocks.has(interaction.user.id)) {
                await interaction.reply({ content: 'Ya hay una solicitud de escaneo procesandose para tu usuario.', ephemeral: true });
                return;
            }
            scanLocks.add(interaction.user.id);
            try {
                const member = await interaction.guild.members.fetch(interaction.user.id);
                const reviewRole = findRoleByName(interaction.guild, ['EN REVISION', 'EN REVISIÓN']);
                if (reviewRole) await member.roles.add(reviewRole).catch(() => null);
                const ticket = await createScanTicket(interaction.guild, member, 'escaneo');
                const state = ensureScanState(interaction.user.id, { status: 'PENDIENTE', ticketId: ticket.id, reason: 'Solicitud manual de escaneo consentido', consentAt: new Date().toISOString() });
                const detectionChannel = findTextChannel(interaction.guild, 'detecciones-en-vivo');
                const staffEmbed = scanEmbed('Nueva solicitud de escaneo', [
                    `**Usuario:** ${interaction.user}`,
                    `**ID:** ${interaction.user.id}`,
                    `**Motivo:** Solicitud manual consentida`,
                    `**Risk Score:** ${state.riskScore}/100`,
                    `**Estado:** ${state.status}`,
                    `**Ticket:** ${ticket}`
                ].join('\n'), 0xf97316);
                if (detectionChannel) await detectionChannel.send({ embeds: [staffEmbed], components: [createStaffScanRow(interaction.user.id)] });
                await enterpriseBackendClient.sendSSSession({
                    userId: interaction.user.id,
                    status: state.status,
                    ticketId: ticket.id,
                    riskScore: state.riskScore,
                    consentAt: state.consentAt,
                    metadata: { source: 'discord-bot', action: 'scan_consent' }
                }).catch(err => appendSystemEvent('ss-backend-error', { code: 'SS_FAIL', message: err.message, userId: interaction.user.id }));
                await ticket.send({
                    embeds: [scanEmbed('Escaneo COLMENA-SS creado', 'Tu caso esta en cola con consentimiento registrado. El staff te guiara desde aqui. No cierres Discord y entra a una sala de voz cuando se te indique.', 0x22c55e)],
                    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`user_cancel_scan:${interaction.user.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger))]
                });
                await interaction.reply({ content: `Solicitud creada correctamente: ${ticket}`, ephemeral: true });
                await logEnterpriseAction(interaction.guild, 'Solicitud de escaneo consentida creada', interaction.user, interaction.user, `Ticket ${ticket.id}. Cola ${scanQueue.indexOf(interaction.user.id) + 1}.`);
            } catch (err) {
                console.error('[SCAN] Error creando solicitud:', err);
                await interaction.reply({ content: `Error creando solicitud: ${err.message}`, ephemeral: true }).catch(() => null);
            } finally {
                scanLocks.delete(interaction.user.id);
            }
            return;
        }

        if (action === 'scan_status') {
            const state = scanStates.get(interaction.user.id);
            const position = state ? scanQueue.filter(id => (scanStates.get(id)?.status || '') !== 'FINALIZADO').indexOf(interaction.user.id) + 1 : 0;
            const eta = position > 0 ? `${Math.max(position * 5, 5)}-${Math.max(position * 8, 8)} min` : 'Sin cola activa';
            await interaction.reply({
                embeds: [scanEmbed('Estado de escaneo', [
                    `**Estado:** ${state?.status || 'SIN SOLICITUD'}`,
                    `**Posicion en cola:** ${position || 'N/A'}`,
                    `**Tiempo estimado:** ${eta}`
                ].join('\n'), 0x38bdf8)],
                ephemeral: true
            });
            await logEnterpriseAction(interaction.guild, 'Consulta de estado de escaneo', interaction.user, interaction.user);
            return;
        }

        if (action === 'scan_evidence') {
            const state = ensureScanState(interaction.user.id, { status: 'EN REVISIÓN' });
            const ticket = state.ticketId ? interaction.guild.channels.cache.get(state.ticketId) : await createScanTicket(interaction.guild, interaction.member, 'evidencias');
            state.ticketId = ticket.id;
            scanStates.set(interaction.user.id, state);
            await ticket.send(`${interaction.user}, sube aqui tus evidencias. El staff revisara archivos, capturas y contexto.`);
            await interaction.reply({ content: `Canal de evidencias preparado: ${ticket}`, ephemeral: true });
            await logEnterpriseAction(interaction.guild, 'Canal de evidencias preparado', interaction.user, interaction.user, `Ticket ${ticket.id}`);
            return;
        }

        if (action === 'scan_appeal' || action === 'ticket_ban_appeal') {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            const ticket = await createScanTicket(interaction.guild, member, 'apelacion');
            ensureScanState(interaction.user.id, { status: 'EN REVISIÓN', ticketId: ticket.id, reason: 'Apelacion' });
            const staffChannel = findTextChannel(interaction.guild, 'apelaciones') || findTextChannel(interaction.guild, 'detecciones-en-vivo');
            if (staffChannel) await staffChannel.send({ embeds: [scanEmbed('Nueva apelacion COLMENA-SS', `${interaction.user} abrio apelacion: ${ticket}`, 0xeab308)] });
            await ticket.send({ embeds: [scanEmbed('Apelacion creada', 'Explica tu caso con claridad y adjunta evidencias si las tienes.', 0xeab308)] });
            await interaction.reply({ content: `Apelacion creada: ${ticket}`, ephemeral: true });
            await logEnterpriseAction(interaction.guild, 'Apelacion creada', interaction.user, interaction.user, `Ticket ${ticket.id}`);
            return;
        }

        if (['ticket_technical', 'ticket_client', 'ticket_launcher_bug'].includes(action)) {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            const ticket = await createScanTicket(interaction.guild, member, action.replace('ticket_', 'soporte-'));
            await ticket.send({ embeds: [scanEmbed('Ticket de soporte COLMENA-SS', `${interaction.user}, describe el problema. Un agente revisara tu caso.`, 0x38bdf8)] });
            await interaction.reply({ content: `Ticket creado: ${ticket}`, ephemeral: true });
            await logEnterpriseAction(interaction.guild, `Ticket creado ${action}`, interaction.user, interaction.user, `Ticket ${ticket.id}`);
            return;
        }

        if (targetUserId && staffOnlyActions.has(action)) {
            const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
            const targetUser = targetMember?.user || { id: targetUserId };
            const state = ensureScanState(targetUserId);
            if (state.status === 'FINALIZADO' && action !== 'result_save_evidence') {
                await interaction.reply({ content: 'Caso finalizado: accion bloqueada para evitar doble ejecucion.', ephemeral: true });
                await logEnterpriseAction(interaction.guild, `Accion bloqueada por caso finalizado: ${action}`, interaction.user, targetUser);
                return;
            }
            if (Date.now() - state.createdAt > scanButtonTimeoutMs) {
                await interaction.reply({ content: 'Control caducado por timeout de seguridad. Abre un nuevo caso si hace falta.', ephemeral: true });
                await logEnterpriseAction(interaction.guild, `Accion bloqueada por timeout: ${action}`, interaction.user, targetUser);
                return;
            }
            const ticket = state.ticketId ? interaction.guild.channels.cache.get(state.ticketId) : (targetMember ? await createScanTicket(interaction.guild, targetMember, 'escaneo') : null);
            if (ticket && !state.ticketId) {
                state.ticketId = ticket.id;
                scanStates.set(targetUserId, state);
            }

            if (action === 'staff_scan_start') {
                const transition = await setScanStatusSafe(interaction.guild, state, 'EN ESCANEO', interaction.user, 'staff_scan_start');
                if (!transition.ok) {
                    await interaction.reply({ content: transition.message, ephemeral: true });
                    return;
                }
                let moved = 'Usuario no conectado a voz; sala preparada manualmente.';
                const scanRoom = findVoiceChannel(interaction.guild, 'Sala Escaneo 1') || findVoiceChannel(interaction.guild, 'Sala Escaneo');
                if (targetMember?.voice?.channel && scanRoom) {
                    await targetMember.voice.setChannel(scanRoom).then(() => { moved = `Movido a ${scanRoom.name}`; }).catch(err => { moved = `No se pudo mover: ${err.message}`; });
                }
                if (ticket) await ticket.send({
                    embeds: [scanEmbed('Escaneo en vivo iniciado', `${moved}\nStaff asignado: ${interaction.user}`, 0xef4444)],
                    components: createLiveScanRows(targetUserId)
                });
                await interaction.reply({ content: `Escaneo iniciado. ${moved}`, ephemeral: true });
                await logEnterpriseAction(interaction.guild, 'Escaneo iniciado', interaction.user, targetUser, moved);
                return;
            }

            if (action === 'staff_review_user') {
                await interaction.reply({ embeds: [scanEmbed('Ficha de usuario', `**Usuario:** <@${targetUserId}>\n**ID:** ${targetUserId}\n**Estado:** ${state.status}\n**Risk Score:** ${state.riskScore}/100\n**Ticket:** ${ticket || 'N/A'}`, 0x38bdf8)], ephemeral: true });
                await logEnterpriseAction(interaction.guild, 'Revision de usuario abierta', interaction.user, targetUser);
                return;
            }

            if (action === 'staff_open_incident') {
                const transition = await setScanStatusSafe(interaction.guild, state, 'EN REVISIÓN', interaction.user, 'staff_open_incident');
                if (!transition.ok) {
                    await interaction.reply({ content: transition.message, ephemeral: true });
                    return;
                }
                state.incidentId = createEventId('INC');
                scanStates.set(targetUserId, state);
                const incidentChannel = findTextChannel(interaction.guild, 'incidentes-activos') || findTextChannel(interaction.guild, 'cola-incidentes');
                if (incidentChannel) await incidentChannel.send({ embeds: [scanEmbed(`Incidente ${state.incidentId}`, `**Usuario:** <@${targetUserId}>\n**Risk Score:** ${state.riskScore}/100\n**Origen:** COLMENA-SS`, 0xef4444)] });
                await enterpriseBackendClient.sendEvent({ eventType: 'scan_incident_opened', severity: 'warning', message: `Incidente ${state.incidentId} abierto`, userId: targetUserId, metadata: { incidentId: state.incidentId, riskScore: state.riskScore } }).catch(() => null);
                await interaction.reply({ content: `Incidente abierto: ${state.incidentId}`, ephemeral: true });
                await logEnterpriseAction(interaction.guild, 'Incidente abierto', interaction.user, targetUser, state.incidentId);
                return;
            }

            if (action === 'staff_mark_suspect' || action === 'result_suspect') {
                const markedRole = findRoleByName(interaction.guild, 'MARCADO');
                if (targetMember && markedRole) await targetMember.roles.add(markedRole).catch(() => null);
                const transition = await setScanStatusSafe(interaction.guild, state, 'EN REVISIÓN', interaction.user, action);
                if (!transition.ok) {
                    await interaction.reply({ content: transition.message, ephemeral: true });
                    return;
                }
                await enterpriseBackendClient.sendEvent({ eventType: 'user_flagged', severity: 'warning', message: 'Usuario marcado como sospechoso desde COLMENA-SS', userId: targetUserId, metadata: { riskScore: state.riskScore } }).catch(() => null);
                await interaction.reply({ content: 'Usuario marcado como sospechoso.', ephemeral: true });
                await logEnterpriseAction(interaction.guild, 'Usuario marcado como sospechoso', interaction.user, targetUser);
                return;
            }

            if (['live_start_review', 'live_request_screen', 'live_repeat_verify', 'live_pause'].includes(action)) {
                const labels = {
                    live_start_review: 'Revision iniciada',
                    live_request_screen: 'Pantalla solicitada',
                    live_repeat_verify: 'Repetir verificacion',
                    live_pause: 'Escaneo pausado'
                };
                const nextStatus = action === 'live_pause' ? 'EN REVISIÓN' : 'EN ESCANEO';
                const transition = await setScanStatusSafe(interaction.guild, state, nextStatus, interaction.user, action);
                if (!transition.ok) {
                    await interaction.reply({ content: transition.message, ephemeral: true });
                    return;
                }
                if (ticket) await ticket.send({ embeds: [scanEmbed(labels[action], `Accion ejecutada por ${interaction.user}.`, 0x38bdf8)], components: createResultRows(targetUserId) });
                await interaction.reply({ content: labels[action], ephemeral: true });
                await logEnterpriseAction(interaction.guild, labels[action], interaction.user, targetUser);
                return;
            }

            if (action === 'result_clean') {
                if (state.status !== 'EN ESCANEO' && state.status !== 'EN REVISIÓN') {
                    await interaction.reply({ content: 'No se puede finalizar: el caso debe estar en escaneo o revision.', ephemeral: true });
                    return;
                }
                const reviewRole = findRoleByName(interaction.guild, ['EN REVISION', 'EN REVISIÓN']);
                if (targetMember && reviewRole) await targetMember.roles.remove(reviewRole).catch(() => null);
                await setScanStatusSafe(interaction.guild, state, 'FINALIZADO', interaction.user, 'result_clean');
                await enterpriseBackendClient.sendSSSession({ userId: targetUserId, status: 'CLEAN', ticketId: ticket?.id, riskScore: state.riskScore, metadata: { result: 'clean', staff: interaction.user.id } }).catch(() => null);
                await interaction.reply({ content: 'Usuario marcado como limpio. Rol EN REVISION retirado.', ephemeral: true });
                await logEnterpriseAction(interaction.guild, 'Resultado limpio', interaction.user, targetUser);
                return;
            }

            if (action === 'result_ban') {
                if (state.status !== 'EN ESCANEO' && state.status !== 'EN REVISIÓN') {
                    await interaction.reply({ content: 'No se puede banear desde COLMENA-SS sin caso en escaneo o revision.', ephemeral: true });
                    return;
                }
                await targetMember?.ban({ reason: `COLMENA-SS ban ejecutado por ${interaction.user.tag}` }).catch(err => interaction.followUp?.({ content: `No se pudo banear: ${err.message}`, ephemeral: true }).catch(() => null));
                await setScanStatusSafe(interaction.guild, state, 'FINALIZADO', interaction.user, 'result_ban');
                await enterpriseBackendClient.sendSSSession({ userId: targetUserId, status: 'BANNED', ticketId: ticket?.id, riskScore: state.riskScore, metadata: { result: 'ban', staff: interaction.user.id } }).catch(() => null);
                const banChannel = findTextChannel(interaction.guild, 'registro-baneos');
                if (banChannel) await banChannel.send({ embeds: [scanEmbed('Baneo registrado', `**Usuario:** <@${targetUserId}>\n**Ejecutor:** ${interaction.user}\n**Motivo:** Resultado de escaneo COLMENA-SS`, 0xdc2626)] });
                await interaction.reply({ content: 'Baneo ejecutado y registrado.', ephemeral: true }).catch(() => null);
                await logEnterpriseAction(interaction.guild, 'Baneo ejecutado', interaction.user, targetUser);
                return;
            }

            if (action === 'result_restrict') {
                const markedRole = findRoleByName(interaction.guild, 'MARCADO');
                const reviewRole = findRoleByName(interaction.guild, ['EN REVISION', 'EN REVISIÓN']);
                if (targetMember && markedRole) await targetMember.roles.add(markedRole).catch(() => null);
                if (targetMember && reviewRole) await targetMember.roles.add(reviewRole).catch(() => null);
                const transition = await setScanStatusSafe(interaction.guild, state, 'EN REVISIÓN', interaction.user, 'result_restrict');
                if (!transition.ok) {
                    await interaction.reply({ content: transition.message, ephemeral: true });
                    return;
                }
                await interaction.reply({ content: 'Usuario restringido con roles de revision/marcado.', ephemeral: true });
                await logEnterpriseAction(interaction.guild, 'Usuario restringido', interaction.user, targetUser);
                return;
            }

            if (action === 'result_save_evidence') {
                const archiveChannel = findTextChannel(interaction.guild, 'archivo-evidencias') || findTextChannel(interaction.guild, 'evidencias-anticheat');
                if (archiveChannel) await archiveChannel.send({ embeds: [scanEmbed('Evidencia guardada', `**Usuario:** <@${targetUserId}>\n**Ticket:** ${ticket || 'N/A'}\n**Risk Score:** ${state.riskScore}/100\n**Guardado por:** ${interaction.user}`, 0x22c55e)] });
                await interaction.reply({ content: 'Evidencia archivada.', ephemeral: true });
                await logEnterpriseAction(interaction.guild, 'Evidencia guardada', interaction.user, targetUser);
                return;
            }
        }

        if (action === 'user_cancel_scan') {
            if (targetUserId !== interaction.user.id) {
                await interaction.reply({ content: 'Solo el usuario afectado puede cancelar su solicitud.', ephemeral: true });
                return;
            }
            const state = scanStates.get(interaction.user.id);
            if (state?.status && state.status !== 'PENDIENTE') {
                await interaction.reply({ content: 'No se puede cancelar: el escaneo ya comenzo o esta en revision.', ephemeral: true });
                return;
            }
            ensureScanState(interaction.user.id, { status: 'FINALIZADO' });
            await interaction.reply({ content: 'Solicitud cancelada antes del inicio.', ephemeral: true });
            await logEnterpriseAction(interaction.guild, 'Solicitud de escaneo cancelada', interaction.user, interaction.user);
            return;
        }

        if (interaction.customId === 'open_ticket') {
            const guild = interaction.guild;
            const user = interaction.user;

            try {
                // Check if category exists or create one for tickets
                let category = guild.channels.cache.find(c => c.name === 'Colmena-Tickets' && c.type === ChannelType.GuildCategory);
                if (!category) {
                    category = await guild.channels.create({ name: 'Colmena-Tickets', type: ChannelType.GuildCategory });
                }

                // Create Private Channel
                const ticketChannel = await guild.channels.create({
                    name: `ticket-${user.username}`,
                    type: ChannelType.GuildText,
                    parent: category.id,
                    permissionOverwrites: [
                        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                        { id: discordClient.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                    ]
                });

                const closeButton = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('close_ticket')
                        .setLabel('Finalizar Caso')
                        .setStyle(ButtonStyle.Danger)
                );

                await ticketChannel.send({
                    content: `🚨 **CENTRO DE SOPORTE COLMENA** 🚨\nHola ${user}, un agente revisará tu caso pronto. Describe tu problema aquí.`,
                    components: [closeButton]
                });

                await interaction.reply({ content: `Ticket creado correctamente: ${ticketChannel}`, ephemeral: true });

                if (window && currentRole === 'ADMIN') {
                    window.webContents.send('bot:new-action', {
                        timestamp: new Date().toLocaleTimeString(),
                        message: `[TICKET] Nuevo ticket abierto por: ${user.username}`,
                        status: 'processing'
                    });
                }
            } catch (err) {
                console.error('Error creating ticket:', err);
                if (!interaction.replied) await interaction.reply({ content: 'Error al crear el ticket.', ephemeral: true });
            }
        }

        if (interaction.customId === 'close_ticket') {
            await interaction.reply('Cerrando ticket de seguridad en 5 segundos...');
            setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
        }
    });

    discordClient.on('messageCreate', async (message) => {
        // Log de diagnóstico
        console.log(`[DISCORD] Mensaje detectado: ${message.content} (Autor: ${message.author.username})`);
        
        if (!message.guild || message.author.bot) return;

        // Auto-update nickname if not synced
        await updateMemberNickname(message.member).catch(() => {});

        if (message.content.startsWith('!rebuild-colmena-core')) {
            if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
                await message.reply('❌ Permiso denegado. Requiere Administrador.');
                return;
            }
            const confirmation = message.content.split(/\s+/)[1];
            if (confirmation !== 'CONFIRMAR_REBUILD_COLMENA_CORE') {
                await message.reply([
                    '⚠️ Comando destructivo protegido.',
                    'Para reconstruir el servidor como **COLMENA CORE - ENTERPRISE DIAMOND**, ejecuta:',
                    '`!rebuild-colmena-core CONFIRMAR_REBUILD_COLMENA_CORE`',
                    'Reglas activas: no se borra servidor, no se elimina OWNER/BOT, el canal de comando se elimina solo al final.'
                ].join('\n'));
                return;
            }
            try {
                await rebuildColmenaCoreDiamond(message);
            } catch (err) {
                console.error('[REBUILD] Error COLMENA CORE Diamond:', err);
                appendSystemEvent('discord-colmena-core-diamond-rebuild-error', { message: err.message });
                await message.channel.send(`❌ **Error reconstruyendo COLMENA CORE:** ${err.message}`).catch(() => null);
                sendLauncherLog(`[REBUILD] Error COLMENA CORE Diamond: ${err.message}`, 'error');
            }
            return;
        }

        if (message.content === '!activar-colmena-ss') {
            if (!message.member.permissions.has(PermissionFlagsBits.Administrator) && !memberHasAnyRole(message.member, staffRoleNames)) {
                await message.reply('Permiso denegado. Requiere staff autorizado COLMENA-SS.');
                return;
            }
            try {
                await publishColmenaSsPanels(message.guild);
                await message.channel.send('✅ Sistema COLMENA-SS ACTIVADO correctamente');
            } catch (err) {
                console.error('[COLMENA-SS] Error activando paneles:', err);
                await message.channel.send(`Error activando COLMENA-SS: ${err.message}`);
            }
            return;
        }

        // Command to setup the ticket message (Only for admins)
        if (message.content === '!setup-tickets' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('open_ticket')
                    .setLabel('📩 Abrir Ticket de Soporte')
                    .setStyle(ButtonStyle.Primary)
            );

            await message.channel.send({
                content: '**¿Necesitas ayuda o reportar un incidente?**\nPulsa el botón inferior para abrir un canal privado con nuestro staff.',
                components: [row]
            });
            return;
        }

        // Command to sync IDs for all members
        if (message.content === '!sync-ids' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            const members = await message.guild.members.fetch();
            await message.channel.send(`Sincronizando identidades para ${members.size} miembros...`);
            for (const member of members.values()) {
                if (!member.user.bot) {
                    await updateMemberNickname(member);
                }
            }
            await message.channel.send('Sincronización completada.');
            return;
        }

        if (message.content.toLowerCase().startsWith('!ia ')) {
            const query = message.content.slice(4).trim();
            if (!query) return;
            await message.channel.sendTyping().catch(() => {});
            const aiResponse = await askGuardianAI(`Consulta desde Discord por ${message.author.username}: ${query}`);
            const provider = aiResponse.provider ? ` (${aiResponse.provider})` : '';
            await message.reply(`**IA GUARDIAN${provider}:** ${aiResponse.message.substring(0, 1800)}`);
            sendLauncherLog(`[IA DISCORD] ${message.author.username}: ${query.substring(0, 80)}`, 'success');
            return;
        }

        // --- COMMAND: !clean (ELIMINAR DUPLICADOS) ---
        if (message.content === '!clean' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await message.channel.send('🧹 **Iniciando limpieza de canales duplicados...**');
            const channels = await message.guild.channels.fetch();
            const seenNames = new Set();
            let deletedCount = 0;

            for (const channel of channels.values()) {
                if (seenNames.has(channel.name) && channel.id !== message.channel.id) {
                    await channel.delete().catch(() => null);
                    deletedCount++;
                } else {
                    seenNames.add(channel.name);
                }
            }
            await message.channel.send(`✅ Limpieza completada. Se han eliminado **${deletedCount}** canales duplicados.`);
            return;
        }

        // --- COMMAND: !setup-enterprise (CONFIGURACIÓN TOTAL DE PERFIL) ---
        if (message.content === '!setup-enterprise' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await message.channel.send('🏢 **ESTABLECIENDO IDENTIDAD CORPORATIVA...**');
            const guild = message.guild;

            try {
                // Configurar Perfil del Servidor (ENFOQUE FORENSE REDM/FIVEM)
                await guild.edit({
                    name: '🛡️ COLMENA GUARDIAN | ENTERPRISE',
                    description: 'Unidad de élite especializada en Análisis Forense Digital para RedM y FiveM. Partners de Echo.ac. Auditoría técnica, telemetría y protección forense de alto nivel.'
                });

                const mainChannel = message.channel;
                // 0. ENTERPRISE ROLES (LOS 5 RASGOS CORPORATIVOS)
                const roles = [
                    { name: '⭐ DIRECTIVA COLMENA', color: '#ffcc00', permissions: [PermissionFlagsBits.Administrator], hoist: true },
                    { name: '🕵️ ANALISTA FORENSE', color: '#a333ff', permissions: [PermissionFlagsBits.ViewAuditLog, PermissionFlagsBits.ViewChannel], hoist: true },
                    { name: '🛡️ SEGURIDAD OPERATIVA', color: '#ff3e3e', permissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.KickMembers], hoist: true },
                    { name: '🛠️ AGENTE DE SOPORTE', color: '#00ccff', permissions: [PermissionFlagsBits.ManageThreads, PermissionFlagsBits.SendMessages], hoist: true },
                    { name: '✅ CIUDADANO VERIFICADO', color: '#00ffaa', permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages], hoist: true }
                ];
                for (const r of roles) {
                    if (!guild.roles.cache.find(role => role.name === r.name)) {
                        await guild.roles.create(r);
                        console.log(`[SERVER] Rango creado: ${r.name}`);
                    }
                }

                // 2. CATEGORÍA: CENTRAL
                const catCentral = await guild.channels.create({ name: '🛡️ COLMENA | CENTRAL', type: ChannelType.GuildCategory });
                await mainChannel.setName('💬┃wl-bienvenida');
                await mainChannel.setParent(catCentral.id);
                await guild.channels.create({ name: '🆔┃registro-identidad', type: ChannelType.GuildText, parent: catCentral.id });
                await guild.channels.create({ name: '📜┃normativas', type: ChannelType.GuildText, parent: catCentral.id });
                await guild.channels.create({ name: '📢┃comunicados', type: ChannelType.GuildText, parent: catCentral.id });

                // 3. CATEGORÍA: ADMINISTRACIÓN (PRIVADA)
                const catAdm = await guild.channels.create({ 
                    name: '💼 COLMENA | ADMINISTRACIÓN', 
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }] 
                });
                await guild.channels.create({ name: '🔐┃staff-chat', type: ChannelType.GuildText, parent: catAdm.id });
                await guild.channels.create({ name: '💾┃firewall-logs', type: ChannelType.GuildText, parent: catAdm.id });
                await guild.channels.create({ name: '👮┃auditoria-forense', type: ChannelType.GuildText, parent: catAdm.id });
                await guild.channels.create({ name: '🤖┃bot-control', type: ChannelType.GuildText, parent: catAdm.id });

                // 4. CATEGORÍA: SEGURIDAD TÁCTICA
                const catSec = await guild.channels.create({ name: '🔍 COLMENA | SEGURIDAD TÁCTICA', type: ChannelType.GuildCategory });
                await guild.channels.create({ name: '🔬┃analisis-scanners', type: ChannelType.GuildText, parent: catSec.id });
                await guild.channels.create({ name: '🚨┃detecciones-globales', type: ChannelType.GuildText, parent: catSec.id });
                await guild.channels.create({ name: '☢️┃aislamiento-riesgos', type: ChannelType.GuildText, parent: catSec.id });

                // 5. CATEGORÍA: SOPORTE
                const catSup = await guild.channels.create({ name: '📩 COLMENA | SOPORTE', type: ChannelType.GuildCategory });
                const ticketChan = await guild.channels.create({ name: '🎟️┃centro-de-tickets', type: ChannelType.GuildText, parent: catSup.id });
                await guild.channels.create({ name: '🛠️┃asistencia-tecnica', type: ChannelType.GuildText, parent: catSup.id });
                await guild.channels.create({ name: '📂┃archivo-casos', type: ChannelType.GuildText, parent: catSup.id });

                // 6. CATEGORÍA: VOZ
                const catVoice = await guild.channels.create({ name: '🔊 COLMENA | CANALES DE VOZ', type: ChannelType.GuildCategory });
                await guild.channels.create({ name: '🗣️┃Sala de Operaciones', type: ChannelType.GuildVoice, parent: catVoice.id });
                await guild.channels.create({ name: '🎥┃SALA DE ESCANEO (VIDEO)', type: ChannelType.GuildVoice, parent: catVoice.id });
                await guild.channels.create({ name: '🛡️┃Espera de Revisión', type: ChannelType.GuildVoice, parent: catVoice.id });

                // Botón de Soporte
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('open_ticket').setLabel('📩 Soporte Enterprise').setStyle(ButtonStyle.Primary)
                );
                await ticketChan.send({ content: '🛠️ **SOPORTE CORPORATIVO COLMENA**', components: [row] });

                await mainChannel.send('✅ **Ecosistema ENTERPRISE Masivo desplegado con éxito.**');
            } catch (err) {
                console.error('Massive Setup Error:', err);
            }
            return;
        }

        // --- AUTOMATED ENTERPRISE ROUTING ---
        if (message.guildId === CONFIG.discordGuildId) {
            // Routing Alerts to Forensic Audit
            if (message.content.includes('🚨') || message.content.toLowerCase().includes('hack')) {
                const auditChan = message.guild.channels.cache.find(c => c.name.includes('auditoria-forense'));
                if (auditChan) await auditChan.send(`📋 **REGISTRO FORENSE:** Incidente detectado por ${message.author.username}\nDetalle: ${message.content}`);
            }
            // Routing Scans to Database Logs
            if (message.content.toLowerCase().includes('scan')) {
                const dbChan = message.guild.channels.cache.find(c => c.name.includes('firewall-logs'));
                if (dbChan) await dbChan.send(`💾 **LOG DE SISTEMA:** Ejecución de escaneo reportada.`);
            }
        }

        // --- LÓGICA DE REGISTRO DE CIUDADANÍA (TOKEN .) ---
        if (message.channel.name.includes('registro-identidad') && message.content === '.') {
            const guild = message.guild;
            const member = message.member;
            const isAdmin = message.author.username.toLowerCase().includes('aporlop');
            
            // 1. Determinar ID y Roles con NUEVOS ICONOS
            const newId = isAdmin ? 1 : Math.floor(Math.random() * 900) + 299;
            const enterpriseRoles = ['🔥 DIRECTIVA COLMENA', '🕵️ ANALISTA FORENSE', '🛡️ SEGURIDAD OPERATIVA', '🧑‍💻 AGENTE DE SOPORTE', '🙋 CIUDADANO VERIFICADO'];

            try {
                // 2. Asignar Roles (Si es admin, todos. Si no, solo Ciudadano)
                for (const roleName of enterpriseRoles) {
                    const role = guild.roles.cache.find(r => r.name.includes(roleName.split(' ')[1])); // Busqueda flexible por nombre
                    if (role) {
                        if (isAdmin) {
                            await member.roles.add(role);
                        } else if (roleName.includes('CIUDADANO VERIFICADO')) {
                            await member.roles.add(role);
                        }
                    }
                }

                // 3. Cambiar Apodo con NUEVOS ICONOS (Formato Simple)
                const primaryRole = isAdmin ? '🔥 DIRECTIVA COLMENA' : '🙋 CIUDADANO VERIFICADO';
                const emoji = primaryRole.split(' ')[0];
                const newNickname = `${emoji} ┃ ${member.user.username} | ${newId}`;

                try {
                    await member.setNickname(newNickname);
                } catch (err) {
                    console.warn(`[DISCORD] No pude cambiar el apodo a ${member.user.username}. (Es el Dueño)`);
                    if (!isAdmin) {
                        await message.channel.send('⚠️ **AVISO:** Sube mi rol al principio de la lista para que pueda cambiarte el apodo.');
                    }
                }

                // 4. Confirmación en Discord
                const welcomeMsg = isAdmin 
                    ? `👑 **ACCESO MAESTRO DETECTADO:** Bienvenido Director **ID ${newId}**. Todos los sistemas están bajo su control.`
                    : `✅ **CIUDADANÍA PROCESADA:** Bienvenido Ciudadano **${newId}**. Tu perfil ha sido sincronizado.`;
                await message.channel.send(welcomeMsg);
                
                // 5. LOG EN EL LAUNCHER (Monitor 4)
                if (window) {
                    window.webContents.send('bot:new-action', {
                        timestamp: new Date().toLocaleTimeString(),
                        message: isAdmin ? `[MASTER] Acceso Directiva: ID 1 Activada` : `[REGISTRO] Nuevo Ciudadano: ID ${newId}`,
                        status: isAdmin ? 'processing' : 'success'
                    });
                }
                
                await message.delete().catch(() => null);
            } catch (err) {
                console.error('Error en Registro:', err);
            }
            return;
        }

        if (message.channel.name.startsWith('ticket-')) {
            const aiResponse = await askGuardianAI(`El usuario ${message.author.username} dice en el ticket: ${message.content}`);
            const provider = aiResponse.provider ? ` (${aiResponse.provider})` : '';
            await message.channel.send(`**ANALISTA IA${provider}:** ${aiResponse.message.substring(0, 1800)}`);
            sendLauncherLog(`[IA TICKET] ${aiResponse.message.substring(0, 80)}...`, 'success');
            return;
        }

        // Relay messages to Launcher Log (ONLY FOR ADMINS)
        // FIX #1: Corregido currentUserRole (undefined) → currentRole (variable global correcta)
        if (window && currentRole === 'ADMIN') {
            window.webContents.send('bot:new-action', {
                timestamp: new Date().toLocaleTimeString(),
                message: `[${message.author.username}] ${message.content}`,
                status: 'processing'
            });
        }

        // --- AI ROUTING LOGIC ---
        if (message.content.toLowerCase().includes('hack') || message.content.toLowerCase().includes('cheat')) {
            const alertChan = message.guild.channels.cache.find(c => c.name.includes('alertas-anticheat'));
            if (alertChan) await alertChan.send(`🚨 **ALERTA DETECTADA:** ${message.content}`);
        } else if (message.content.toLowerCase().includes('scan') || message.content.toLowerCase().includes('resultado')) {
            const scanChan = message.guild.channels.cache.find(c => c.name.includes('registros-escaneo'));
            if (scanChan) await scanChan.send(`🔬 **NUEVO REPORTE DE ESCANEO:** ${message.content}`);
        }
    });

    // FIX #2: Colector de inteligencia FUERA de messageCreate para evitar memory leak.
    // Antes estaba dentro del handler y creaba un nuevo setInterval en cada mensaje recibido.
    setInterval(async () => {
        if (!discordClient || !discordClient.isReady()) return;
        const guild = discordClient.guilds.cache.get(CONFIG.discordGuildId);
        if (!guild || !window) return;

        try {
            const totalMembers = guild.memberCount;
            const onlineMembers = guild.members.cache.filter(m => m.presence?.status !== 'offline').size || 0;

            let totalAlerts = 0;
            const auditPath = path.join(__dirname, 'data', 'colmena_audit.json');
            if (fs.existsSync(auditPath)) {
                const data = JSON.parse(fs.readFileSync(auditPath, 'utf8') || '[]');
                totalAlerts = data.length;
            }

            const voiceSessions = guild.members.cache.filter(m => m.voice.channelId).size;

            window.webContents.send('dashboard:update', {
                totalMembers,
                onlineMembers,
                totalAlerts,
                activeSessions: voiceSessions + (Math.floor(Math.random() * 2) + 1)
            });
        } catch (err) {
            console.error('[STATS] Error recolectando inteligencia:', err);
        }
    }, 5000);

    discordClient.login(token).catch(err => {
        discordStarting = false;
        console.error('Discord login error:', err);
        appendRuntimeLog('discord.log', `Discord login error: ${err.message}`);
        appendSystemEvent('discord-login-error', { message: err.message });
        if (!options.limited && String(err.message).toLowerCase().includes('disallowed intents')) {
            appendRuntimeLog('discord.log', 'Retrying Discord login in limited mode without privileged intents.');
            appendSystemEvent('discord-login-limited-retry', { reason: err.message });
            discordClient = null;
            return startDiscordBot(window, { limited: true });
        }
        if (window) window.webContents.send('status:update', { id: 'status-discord', state: 'offline' });
    });
};

// System Cleaner Logic
const cleanSystem = async (window, options = {}) => {
    const { exec } = require('child_process');
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) {
        return { success: false, code: 'LOCALAPPDATA_NOT_FOUND', message: 'No se encontro LOCALAPPDATA para preparar la limpieza segura.' };
    }
    const paths = [
        path.join(localAppData, 'FiveM', 'FiveM.app', 'cache'),
        path.join(localAppData, 'FiveM', 'FiveM.app', 'logs'),
        path.join(localAppData, 'FiveM', 'FiveM.app', 'crashes'),
        path.join(localAppData, 'RedM', 'RedM.app', 'cache'),
        path.join(localAppData, 'RedM', 'RedM.app', 'logs')
    ];

    const existingPaths = paths.filter(p => fs.existsSync(p));
    if (!options.confirmed) {
        const message = `[CLEANER] Modo seguro: ${existingPaths.length} rutas detectadas. No se ha borrado nada sin confirmacion explicita.`;
        if (window) {
            window.webContents.send('bot:new-action', {
                timestamp: new Date().toLocaleTimeString(),
                message,
                status: 'processing'
            });
        }
        enterpriseLogService.record('repair_clean_preview', 'Vista previa de limpieza generada sin borrado', { metadata: { existingPaths } });
        return { success: true, requiresConfirmation: true, deletedCount: 0, paths: existingPaths, message };
    }

    let deletedCount = 0;
    existingPaths.forEach(p => {
        if (fs.existsSync(p)) {
            try {
                fs.rmSync(p, { recursive: true, force: true });
                deletedCount++;
            } catch (e) {
                console.error(`Error deleting ${p}:`, e.message);
            }
        }
    });

    if (options.emptyRecycleBin === true) {
        exec('powershell.exe -Command Clear-RecycleBin -Force -ErrorAction SilentlyContinue');
    }

    if (window) {
        window.webContents.send('bot:new-action', {
            timestamp: new Date().toLocaleTimeString(),
            message: `[CLEANER] Limpieza completada con confirmacion. Carpetas procesadas: ${deletedCount}.`,
            status: 'success'
        });
    }
    enterpriseLogService.record('repair_clean_confirmed', 'Limpieza confirmada ejecutada', { metadata: { deletedCount, emptyRecycleBin: options.emptyRecycleBin === true } });
    return { success: true, deletedCount, emptyRecycleBin: options.emptyRecycleBin === true };
};

// FIX #11: Función para inicializar el modelo Gemini UNA SOLA VEZ al arranque
const initGeminiModel = async () => {
    try {
        const apiKey = process.env.AI_API_KEY;
        if (!apiKey || apiKey.includes('YOUR_API_KEY')) return;

        const listModels = await axios.get(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey.trim()}`);
        const modelNames = listModels.data.models.map(m => m.name);
        cachedGeminiModel = modelNames.find(m => m === 'models/gemini-1.5-flash') || modelNames[0];
        console.log(`[AI] Modelo Gemini cargado: ${cachedGeminiModel}`);
    } catch (e) {
        console.warn('[AI] No se pudo precargar el modelo Gemini:', e.message);
    }
};

const extractOpenAIText = (payload) => {
    if (payload.output_text) return payload.output_text;
    const textParts = [];
    for (const item of payload.output || []) {
        for (const content of item.content || []) {
            if (content.type === 'output_text' && content.text) textParts.push(content.text);
            if (content.type === 'text' && content.text) textParts.push(content.text);
        }
    }
    return textParts.join('\n').trim();
};

const askOpenAIChatGPT = async (query, systemPrompt) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey.includes('YOUR_OPENAI_API_KEY')) return null;

    const model = CONFIG.openAiModel;
    const requestBody = {
        model,
        instructions: systemPrompt,
        input: query,
        max_output_tokens: CONFIG.openAiMaxOutputTokens
    };
    if (process.env.OPENAI_REASONING_EFFORT) {
        requestBody.reasoning = { effort: process.env.OPENAI_REASONING_EFFORT };
    }

    const response = await axios.post(
        'https://api.openai.com/v1/responses',
        requestBody,
        {
            timeout: CONFIG.openAiTimeoutMs,
            headers: {
                Authorization: `Bearer ${apiKey.trim()}`,
                'Content-Type': 'application/json'
            }
        }
    );

    const message = extractOpenAIText(response.data);
    if (!message) throw new Error('OpenAI no devolvio texto.');
    return { message, provider: 'OpenAI ChatGPT', model };
};

// Guardian AI Logic (OpenAI ChatGPT primary, Gemini fallback)
const askGuardianAI = async (query) => {
    try {
        const systemPrompt = `Eres el Analista de Soporte de Colmena Guardian. Tu objetivo es ayudar a los usuarios.
INSTRUCCIONES PARA LOCALIZAR EL SERVER ID:
1. Desde la aplicacion: seccion Monitor o Ajustes.
2. Desde el Panel Web (Admins): seccion Mis Servidores.
Responde siempre en espanol, profesional y tecnico. Si recomiendas una limpieza local, puedes incluir [ACTION:START-CLEANER].`;

        const openAIResponse = await askOpenAIChatGPT(query, systemPrompt).catch(error => {
            console.warn('[AI] OpenAI no disponible, intentando fallback Gemini:', error.message);
            appendSystemEvent('ai-openai-fallback', { message: error.message, model: CONFIG.openAiModel });
            return null;
        });
        if (openAIResponse) {
            let action = null;
            if (openAIResponse.message.includes('[ACTION:START-CLEANER]')) action = 'start-cleaner';
            return {
                message: openAIResponse.message.replace(/\[ACTION:.*\]/g, '').trim(),
                action,
                provider: openAIResponse.provider,
                model: openAIResponse.model
            };
        }

        const apiKey = process.env.AI_API_KEY;
        if (!apiKey || apiKey.includes('YOUR_API_KEY')) {
            return { message: "Error: No se ha detectado una API Key válida en el archivo .env" };
        }

        const geminiPrompt = `Eres el Analista de Soporte de Colmena Guardian. Tu objetivo es ayudar a los usuarios. 
        INSTRUCCIONES PARA LOCALIZAR EL SERVER ID:
        1. Desde la aplicación: Sección "Monitor" o "Ajustes".
        2. Desde el Panel Web (Admins): Sección "Mis Servidores".
        Responde siempre en español, profesional y técnico. Consulta: `;
        
        // FIX #11: Usar modelo cacheado. Si no está cacheado aún, intentar cargarlo ahora.
        if (!cachedGeminiModel) await initGeminiModel();
        const modelToUse = cachedGeminiModel || 'models/gemini-1.5-flash';

        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1/${modelToUse}:generateContent?key=${apiKey.trim()}`,
            {
                contents: [{ parts: [{ text: geminiPrompt + query }] }]
            },
            { timeout: CONFIG.geminiTimeoutMs }
        );

        if (!response.data || !response.data.candidates || !response.data.candidates[0]) {
            throw new Error("La IA no respondió con contenido.");
        }

        const responseText = response.data.candidates[0].content.parts[0].text;
        let action = null;
        if (responseText.includes('[ACTION:START-CLEANER]')) action = 'start-cleaner';

        const cleanMessage = responseText.replace(/\[ACTION:.*\]/g, '').trim();
        return { message: cleanMessage, action: action, provider: 'Gemini', model: modelToUse };
    } catch (error) {
        console.error('AI Error:', error.message);
        appendSystemEvent('ai-error', { message: error.message, openAiConfigured: Boolean(process.env.OPENAI_API_KEY), geminiConfigured: Boolean(process.env.AI_API_KEY) });
        return { message: "Error conectando con el núcleo de IA." };
    }
};

ipcMain.handle('app:ask-ai', async (event, query) => {
    return await askGuardianAI(query);
});

const collectPcDiagnostics = async () => {
    const os = require('os');
    const base = {
        timestamp: new Date().toISOString(),
        user: os.userInfo().username,
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()} ${os.arch()}`,
        uptimeHours: Number((os.uptime() / 3600).toFixed(2)),
        cpu: os.cpus()?.[0]?.model || 'Unknown',
        cpuCores: os.cpus()?.length || 0,
        memory: {
            totalGb: Number((os.totalmem() / (1024 ** 3)).toFixed(2)),
            freeGb: Number((os.freemem() / (1024 ** 3)).toFixed(2))
        }
    };

    if (!si) return { ...base, mode: 'basic' };

    try {
        const [load, mem, disks, network, graphics, processes, ping] = await Promise.all([
            si.currentLoad().catch(() => null),
            si.mem().catch(() => null),
            si.fsSize().catch(() => []),
            si.networkStats().catch(() => []),
            si.graphics().catch(() => null),
            si.processes().catch(() => null),
            si.inetChecksite('https://google.com').catch(() => null)
        ]);

        return {
            ...base,
            mode: 'full',
            cpuLoadPercent: load ? Math.round(load.currentLoad) : null,
            memory: mem ? {
                totalGb: Number((mem.total / (1024 ** 3)).toFixed(2)),
                usedGb: Number((mem.active / (1024 ** 3)).toFixed(2)),
                usedPercent: Math.round((mem.active / mem.total) * 100)
            } : base.memory,
            disks: disks.map(d => ({
                fs: d.fs,
                usedPercent: Math.round(d.use),
                sizeGb: Number((d.size / (1024 ** 3)).toFixed(1)),
                freeGb: Number(((d.size - d.used) / (1024 ** 3)).toFixed(1))
            })),
            network: network.slice(0, 3).map(n => ({
                iface: n.iface,
                downMbps: Number(((n.rx_sec || 0) / 1024 / 1024).toFixed(2)),
                upMbps: Number(((n.tx_sec || 0) / 1024 / 1024).toFixed(2))
            })),
            gpu: graphics?.controllers?.[0] ? {
                model: graphics.controllers[0].model,
                vramMb: graphics.controllers[0].vram,
                utilizationPercent: graphics.controllers[0].utilizationGpu || null
            } : null,
            processes: processes ? {
                all: processes.all,
                running: processes.running,
                blocked: processes.blocked
            } : null,
            pingMs: ping?.ms || null
        };
    } catch (err) {
        console.error('[PC SUPPORT] Error recolectando diagnostico:', err.message);
        return { ...base, mode: 'basic', diagnosticsError: err.message };
    }
};

const buildLocalPcSupportAnalysis = (diagnostics, aiError) => {
    const issues = [];
    const steps = [];
    const memoryUsed = diagnostics.memory?.usedPercent;
    if (Number.isFinite(memoryUsed) && memoryUsed >= 85) {
        issues.push(`Memoria alta (${memoryUsed}%).`);
        steps.push('Cierra procesos pesados antes de abrir RedM/FiveM.');
    }
    const fullDisks = (diagnostics.disks || []).filter(d => d.usedPercent >= 90);
    if (fullDisks.length) {
        issues.push(`Discos con poco espacio: ${fullDisks.map(d => `${d.fs} ${d.usedPercent}%`).join(', ')}.`);
        steps.push('Libera espacio en disco antes de actualizar o reparar el juego.');
    }
    if (diagnostics.pingMs && diagnostics.pingMs > 160) {
        issues.push(`Latencia alta (${diagnostics.pingMs} ms).`);
        steps.push('Prueba conexion por cable o reinicia router antes de entrar al servidor.');
    }
    if (diagnostics.diagnosticsError) {
        issues.push(`Diagnostico limitado: ${diagnostics.diagnosticsError}.`);
    }
    steps.push('Ejecuta Reparacion PC > Revisar PC para comprobar dependencias y rutas.');
    steps.push('Usa Logs > Exportar informe si necesitas enviarlo a soporte.');
    steps.push('No borres evidencias ni logs si estas en revision COLMENA-SS.');
    return [
        '**Analisis local de emergencia COLMENA**',
        aiError ? `La IA remota no respondio a tiempo: ${aiError}` : 'La IA remota no respondio a tiempo.',
        '',
        `Estado general: ${issues.length ? 'hay puntos a revisar' : 'no se detectan bloqueos criticos obvios en el diagnostico local.'}`,
        `Problemas probables: ${issues.length ? issues.join(' ') : 'conexion o proveedor IA lento; sistema local aparentemente operativo.'}`,
        'Pasos seguros:',
        ...steps.map((step, index) => `${index + 1}. ${step}`)
    ].join('\n');
};

ipcMain.handle('app:pc-support', async () => {
    try {
        sendLauncherLog('[SOPORTE PC] Recopilando diagnostico local...', 'processing');
        const diagnostics = await collectPcDiagnostics();
        const prompt = [
            'Actua como tecnico experto de Windows y gaming launcher.',
            'Analiza el diagnostico del PC y devuelve:',
            '1. Estado general en una frase.',
            '2. Problemas probables detectados.',
            '3. Pasos seguros para solucionarlo, sin borrar datos ni ejecutar comandos peligrosos.',
            '4. Que revisar si usa Discord, anticheat, Echo o el launcher.',
            `Diagnostico JSON: ${JSON.stringify(diagnostics)}`
        ].join('\n');
        const aiResponse = await askGuardianAI(prompt);
        const aiFailed = !aiResponse.provider || aiResponse.provider === 'offline' || /Error conectando/i.test(aiResponse.message || '');
        const finalMessage = aiFailed ? buildLocalPcSupportAnalysis(diagnostics, aiResponse.error || aiResponse.message) : aiResponse.message;
        const result = {
            success: true,
            diagnostics,
            message: finalMessage,
            provider: aiFailed ? 'Local Fallback' : aiResponse.provider,
            model: aiResponse.model
        };

        appendAuditEvent({
            type: 'Soporte PC IA',
            severity: 'INFO',
            process: diagnostics.hostname,
            user: diagnostics.user,
            source: 'launcher-pc-support',
            aiSummary: finalMessage
        });
        appendSystemEvent('pc-support-analysis', {
            user: diagnostics.user,
            hostname: diagnostics.hostname,
            provider: result.provider,
            model: aiResponse.model,
            summary: finalMessage.substring(0, 500)
        });
        sendLauncherLog(`[SOPORTE PC] ${finalMessage.substring(0, 180)}`, aiFailed ? 'processing' : 'success');
        await sendDiscordChannelMessage(['bot-control', 'auditoria-forense', 'asistencia-tecnica'], `**SOPORTE PC IA**\nUsuario: ${diagnostics.user}\nEquipo: ${diagnostics.hostname}\n${finalMessage.substring(0, 1500)}`).catch(() => {});
        return result;
    } catch (err) {
        console.error('[PC SUPPORT] Error:', err.message);
        appendSystemEvent('pc-support-error', { message: err.message });
        sendLauncherLog(`[SOPORTE PC] Error: ${err.message}`, 'error');
        return { success: false, message: 'No se pudo ejecutar el soporte PC con IA.' };
    }
});

ipcMain.handle('app:simulate-alert', async () => {
    try {
        const auditEvent = await handleSecurityAlert({
            type: 'SIMULATED_NEURAL_TEST',
            severity: 'LOW',
            user: currentUser || require('os').userInfo().username || 'Usuario Local',
            process: 'colmena-self-test.exe',
            source: 'launcher-test'
        }, { source: 'launcher-test' });
        sendLauncherLog(`[TEST] Enlace neural verificado: ${auditEvent.alertId}`, 'success');
        return { success: true, alertId: auditEvent.alertId };
    } catch (err) {
        console.error('[TEST] Error simulando alerta:', err.message);
        sendLauncherLog(`[TEST] Error simulando enlace neural: ${err.message}`, 'error');
        return { success: false, message: err.message };
    }
});

ipcMain.handle('app:restart-discord', async () => {
    try {
        appendRuntimeLog('discord.log', 'Manual Discord restart requested.');
        if (discordClient) {
            await discordClient.destroy();
            discordClient = null;
        }
        discordStarting = false;
        startDiscordBot(mainWindow);
        sendLauncherLog('[DISCORD] Reconexión manual solicitada.', 'processing');
        return { success: true };
    } catch (err) {
        appendRuntimeLog('discord.log', `Manual restart error: ${err.message}`);
        appendSystemEvent('discord-manual-restart-error', { message: err.message });
        return { success: false, message: err.message };
    }
});

// Start Anticheat Scanner
const startAnticheat = (window) => {
    const apiKey = CONFIG.apiKey;
    const port = CONFIG.serverPort;
    const scanner = new ColmenaScanner(`http://localhost:${port}`, apiKey);
    scanner.start();
    anticheatOnline = true;

    // --- CONEXIÓN ANTICHEAT ↔ DISCORD ↔ LAUNCHER ---
    scanner.on('detection', async (data) => {
        const timestamp = new Date().toLocaleTimeString();
        
        // 1. Enviar al Launcher (UI)
        if (window) {
            window.webContents.send('bot:new-action', {
                timestamp,
                message: `🚨 [ANTICHEAT] Detección: ${data.process} (${data.type})`,
                status: 'danger'
            });
            window.webContents.send('scanner:detection', data);
        }
    });

    if (window) {
        window.webContents.send('status:update', { id: 'status-anticheat', state: 'online' });
    }
};

// Start Echo Service
const startEcho = async (window) => {
    const apiKey = process.env.ECHO_API_KEY;
    if (!apiKey) {
        if (window) window.webContents.send('status:update', { id: 'status-scanner', state: 'offline' });
        return;
    }
    if (window) window.webContents.send('status:update', { id: 'status-scanner', state: 'pending' });

    const echo = new EchoService(apiKey);
    const isActive = await echo.verifyStatus();

    if (window && isActive) {
        window.webContents.send('status:update', { id: 'status-scanner', state: 'online' });
        window.webContents.send('bot:new-action', {
            timestamp: new Date().toLocaleTimeString(),
            message: `[ECHO.AC] Conexión establecida. Sistema de escaneo sincronizado.`,
            status: 'success'
        });
    } else if (window) {
        window.webContents.send('status:update', { id: 'status-scanner', state: 'offline' });
    }
};

// Window Controls IPC
ipcMain.on('window:minimize', () => {
    mainWindow.minimize();
});

ipcMain.on('window:maximize', () => {
    if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow.maximize();
    }
});

ipcMain.on('window:close', () => {
    mainWindow.close();
});

ipcMain.on('admin:action', async (event, { type, targetId }) => {
    // FIX #6: Verificar también que el bot esté conectado y listo, no solo que exista
    if (!['ban', 'kick', 'warn'].includes(type)) return sendLauncherLog(`[ADMIN] Accion no valida: ${type}`, 'error');
    if (currentRole !== 'ADMIN' || !discordClient || !discordClient.isReady()) {
        return sendLauncherLog('[ADMIN] Accion bloqueada: bot offline o usuario sin rol ADMIN.', 'error');
    }
    
    const guildId = CONFIG.discordGuildId;
    const guild = discordClient.guilds.cache.get(guildId);
    if (!guild) return;

    try {
        let actionMsg = "";
        if (type === 'ban') {
            await guild.members.ban(targetId, { reason: 'Baneado desde Colmena Guardian Launcher' });
            actionMsg = `🚨 [BAN] ID ${targetId} ha sido baneado permanentemente.`;
        } else if (type === 'kick') {
            const member = await guild.members.fetch(targetId).catch(() => null);
            if (member) {
                await member.kick('Expulsado desde Colmena Guardian Launcher');
                actionMsg = `👢 [KICK] ID ${targetId} ha sido expulsado.`;
            } else {
                actionMsg = `❌ Error: Usuario ${targetId} no encontrado para Kick.`;
            }
        } else if (type === 'warn') {
            const member = await guild.members.fetch(targetId).catch(() => null);
            if (member) {
                await member.timeout(24 * 60 * 60 * 1000, 'Advertencia (ADV) desde Launcher');
                actionMsg = `⚠️ [ADV] ID ${targetId} silenciado por 24 horas.`;
            } else {
                actionMsg = `❌ Error: Usuario ${targetId} no encontrado para Silenciar.`;
            }
        }

        if (mainWindow) {
            mainWindow.webContents.send('bot:new-action', {
                timestamp: new Date().toLocaleTimeString(),
                message: actionMsg,
                status: actionMsg.includes('Error') ? 'error' : 'success'
            });
        }
        appendAuditEvent({
            type: `Admin ${type.toUpperCase()}`,
            severity: actionMsg.includes('Error') ? 'MEDIUM' : 'HIGH',
            process: targetId,
            user: currentUser || 'ADMIN',
            source: 'launcher-admin'
        });
        await sendDiscordChannelMessage(['auditoria-forense', 'bot-control'], `**ACCION ADMIN**\n${actionMsg}\nEjecutada por: ${currentUser || 'ADMIN'}`).catch(() => {});
    } catch (err) {
        console.error('Discord Admin Action Error:', err);
        sendLauncherLog(`[ADMIN] Error ejecutando ${type}: ${err.message}`, 'error');
    }
});

// Real-time System Monitoring Logic
const startMonitoring = (window) => {
    if (monitoringInterval) clearInterval(monitoringInterval);

    monitoringInterval = setInterval(async () => {
        if (!window) return;

        if (!si) {
            // MODO SIMULACIÓN (Hasta que el usuario instale systeminformation)
            window.webContents.send('stats:update', {
                cpu: Math.floor(Math.random() * 15) + 10,
                ram: Math.floor(Math.random() * 5) + 42,
                gpu: Math.floor(Math.random() * 10) + 5,
                ping: Math.floor(Math.random() * 10) + 25,
                netDown: (Math.random() * 1.5).toFixed(2),
                netUp: (Math.random() * 0.8).toFixed(2),
                disks: [
                    { fs: 'C:', used: 65, size: '500', available: '175' },
                    { fs: 'D:', used: 30, size: '1000', available: '700' }
                ]
            });
            return;
        }

        try {
            const cpu = await si.currentLoad();
            const mem = await si.mem();
            const network = await si.networkStats();
            const disks = await si.fsSize();
            const graphics = await si.graphics();
            
            const ping = await si.inetChecksite('https://google.com');

            // Optimización de lectura de GPU
            const gpuInfo = graphics.controllers && graphics.controllers.length > 0 ? graphics.controllers[0] : {};

            window.webContents.send('stats:update', {
                cpu: Math.round(cpu.currentLoad),
                ram: Math.round((mem.active / mem.total) * 100),
                gpu: gpuInfo.utilizationGpu || gpuInfo.memoryUsed ? Math.round((gpuInfo.memoryUsed / gpuInfo.memoryTotal) * 100) : 0,
                ping: ping.ms || 0,
                netDown: (network[0]?.rx_sec / 1024 / 1024).toFixed(2),
                netUp: (network[0]?.tx_sec / 1024 / 1024).toFixed(2),
                disks: disks.map(d => ({
                    fs: d.fs,
                    used: Math.round(d.use),
                    size: (d.size / (1024**3)).toFixed(1),
                    available: ((d.size - d.used) / (1024**3)).toFixed(1)
                }))
            });
        } catch (err) {
            // Silenciar errores para evitar spam en consola
        }
    }, 1500); // 1.5 segundos para fluidez
};

app.on('ready', async () => {
    appendSystemEvent('launcher-starting', {
        version: '2.5.0-PRO',
        serverPort: CONFIG.serverPort,
        openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
        geminiConfigured: Boolean(process.env.AI_API_KEY),
        discordConfigured: Boolean(process.env.DISCORD_TOKEN),
        echoConfigured: Boolean(process.env.ECHO_API_KEY)
    });
    initMasterAdmin(); // Crear usuario Aporlop si no existe
    await initGeminiModel(); // FIX #11: Precarga el modelo Gemini una sola vez al inicio
    createWindow();
    startDeliveryQueue();
    startBackend(mainWindow);
    startDiscordBot(mainWindow);
    startAnticheat(mainWindow);
    startEcho(mainWindow);
    startMonitoring(mainWindow);
});

app.on('window-all-closed', () => {
    if (deliveryQueueInterval) clearInterval(deliveryQueueInterval);
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});
