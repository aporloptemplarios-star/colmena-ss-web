const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

class BackendClient {
    constructor(options = {}) {
        this.backendUrl = (options.backendUrl || '').replace(/\/$/, '');
        this.apiKey = options.apiKey || '';
        this.hmacSecret = options.hmacSecret || this.apiKey || 'local-development';
        this.queuePath = options.queuePath || path.join(options.dataDir || process.cwd(), 'backend_offline_queue.json');
        this.timeoutMs = options.timeoutMs || 6000;
        this.rateLimitMs = options.rateLimitMs || 700;
        this.lastSentAt = 0;
        this.enabled = Boolean(this.backendUrl);
        this.ensureQueueDir();
    }

    ensureQueueDir() {
        const dir = path.dirname(this.queuePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    readQueue() {
        try {
            if (!fs.existsSync(this.queuePath)) return [];
            return JSON.parse(fs.readFileSync(this.queuePath, 'utf8') || '[]');
        } catch {
            return [];
        }
    }

    writeQueue(queue) {
        this.ensureQueueDir();
        fs.writeFileSync(this.queuePath, JSON.stringify(queue.slice(-500), null, 2), 'utf8');
    }

    sign(payload, timestamp) {
        return crypto.createHmac('sha256', this.hmacSecret).update(`${timestamp}.${JSON.stringify(payload)}`).digest('hex');
    }

    headers(payload) {
        const timestamp = new Date().toISOString();
        return {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'x-colmena-timestamp': timestamp,
            'x-colmena-signature': this.sign(payload, timestamp)
        };
    }

    async throttle() {
        const elapsed = Date.now() - this.lastSentAt;
        if (elapsed < this.rateLimitMs) await new Promise(resolve => setTimeout(resolve, this.rateLimitMs - elapsed));
        this.lastSentAt = Date.now();
    }

    normalizeEvent(event) {
        return {
            source: 'launcher',
            eventType: event.eventType || 'launcher_event',
            userId: event.userId || 'local',
            hwid: event.hwid || 'unknown',
            severity: event.severity || 'info',
            message: event.message || '',
            metadata: event.metadata || {},
            timestamp: event.timestamp || new Date().toISOString()
        };
    }

    async post(endpoint, payload, queueOnFail = true) {
        if (!this.enabled) {
            if (queueOnFail) this.enqueue(endpoint, payload, 'BACKEND_UNCONFIGURED');
            return { success: false, code: 'BACKEND_UNCONFIGURED', queued: queueOnFail };
        }
        try {
            await this.throttle();
            const res = await axios.post(`${this.backendUrl}${endpoint}`, payload, {
                timeout: this.timeoutMs,
                headers: this.headers(payload)
            });
            return { success: true, status: res.status, data: res.data };
        } catch (err) {
            if (queueOnFail) this.enqueue(endpoint, payload, err.message);
            return { success: false, code: 'BACKEND_UNREACHABLE', queued: queueOnFail, message: err.message };
        }
    }

    enqueue(endpoint, payload, reason) {
        const queue = this.readQueue();
        queue.push({ endpoint, payload, reason, attempts: 0, createdAt: new Date().toISOString() });
        this.writeQueue(queue);
    }

    async sendEvent(event) {
        return this.post('/api/events', this.normalizeEvent(event));
    }

    async sendLog(log) {
        return this.post('/api/logs', {
            source: log.source || 'launcher',
            level: log.level || log.severity || 'info',
            message: log.message || '',
            metadata: log.metadata || {},
            timestamp: log.timestamp || new Date().toISOString()
        });
    }

    async sendLauncherLogs(payload) {
        return this.post('/api/launcher/logs', payload);
    }

    async sendHeartbeat(payload = {}) {
        return this.post('/api/launcher/heartbeat', {
            source: 'launcher',
            status: payload.status || 'online',
            metadata: payload.metadata || payload,
            timestamp: new Date().toISOString()
        });
    }

    async sendSSSession(session) {
        return this.post('/api/ss/session', {
            ...session,
            timestamp: session.timestamp || new Date().toISOString()
        });
    }

    async sendAnticheatEvent(event) {
        return this.post('/api/anticheat/event', {
            source: 'anticheat',
            type: event.type || 'anticheat_event',
            severity: event.severity || 'warning',
            riskScore: Number.isFinite(event.riskScore) ? event.riskScore : 0,
            flags: event.flags || [],
            metadata: event.metadata || {},
            timestamp: event.timestamp || new Date().toISOString()
        });
    }

    async flushQueue() {
        const queue = this.readQueue();
        const remaining = [];
        for (const item of queue) {
            const result = await this.post(item.endpoint, item.payload, false);
            if (!result.success) remaining.push({ ...item, attempts: (item.attempts || 0) + 1, lastError: result.message || result.code });
        }
        this.writeQueue(remaining);
        return { success: true, pending: remaining.length, processed: queue.length - remaining.length };
    }
}

module.exports = BackendClient;
