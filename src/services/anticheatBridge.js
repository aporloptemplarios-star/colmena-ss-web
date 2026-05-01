class AnticheatBridge {
    constructor(options = {}) {
        this.backendClient = options.backendClient;
        this.logService = options.logService;
        this.status = 'OFFLINE';
        this.riskScore = 0;
        this.lastHeartbeat = null;
    }

    async getStatus() {
        return {
            status: this.status,
            riskScore: this.riskScore,
            lastHeartbeat: this.lastHeartbeat,
            canStartGame: ['ACTIVE'].includes(this.status),
            blockReason: this.status === 'ACTIVE' ? null : 'ANTICHEAT_NOT_RUNNING'
        };
    }

    async start() {
        this.status = 'ACTIVE';
        this.lastHeartbeat = new Date().toISOString();
        this.logService?.record('anticheat_status', 'Anticheat bridge activo', { metadata: { status: this.status } });
        await this.backendClient?.post('/api/anticheat/status', await this.getStatus());
        return this.getStatus();
    }

    async heartbeat(metadata = {}) {
        this.lastHeartbeat = new Date().toISOString();
        const payload = { ...(await this.getStatus()), metadata };
        await this.backendClient?.sendHeartbeat(payload);
        return payload;
    }

    async guardGameStart() {
        const status = await this.getStatus();
        if (!status.canStartGame) {
            this.logService?.record('GAME_START_BLOCKED', 'Inicio bloqueado por anticheat no valido', { severity: 'critical', metadata: status });
            await this.backendClient?.sendEvent({ eventType: 'game_start_blocked', severity: 'critical', message: status.blockReason, metadata: status });
        }
        return status;
    }
}

module.exports = AnticheatBridge;
