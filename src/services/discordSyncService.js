class DiscordSyncService {
    constructor(options = {}) {
        this.backendClient = options.backendClient;
        this.logService = options.logService;
        this.link = { discordId: null, roles: [], supportStatus: 'none', scanStatus: 'CLEAN' };
    }

    async linkUser(discordId, metadata = {}) {
        this.link = { ...this.link, discordId, metadata, updatedAt: new Date().toISOString() };
        this.logService?.record('discord_link', `Usuario vinculado: ${discordId}`, { metadata });
        await this.backendClient?.post('/api/discord/sync', this.link);
        return this.link;
    }

    async sendCriticalLog(eventType, message, metadata = {}) {
        this.logService?.record(eventType, message, { severity: 'critical', metadata });
        return this.backendClient?.sendEvent({ eventType, severity: 'critical', message, metadata });
    }

    async openTicket(type = 'support_report', metadata = {}) {
        const payload = { type, metadata, createdAt: new Date().toISOString() };
        await this.backendClient?.sendEvent({ eventType: type, severity: 'warning', message: `Ticket launcher solicitado: ${type}`, metadata: payload });
        this.link.supportStatus = 'requested';
        return { success: true, ticket: payload };
    }

    getStatus() {
        return this.link;
    }
}

module.exports = DiscordSyncService;
