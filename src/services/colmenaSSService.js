class ColmenaSSService {
    constructor(options = {}) {
        this.backendClient = options.backendClient;
        this.logService = options.logService;
        this.state = {
            status: 'CLEAN',
            pendingReview: false,
            instructions: 'Sin revision activa.',
            updatedAt: new Date().toISOString()
        };
    }

    getStatus() {
        return this.state;
    }

    async setStatus(status, metadata = {}) {
        this.state = {
            ...this.state,
            status,
            pendingReview: ['PENDING_SCAN', 'IN_SCAN', 'SUSPICIOUS', 'APPEALED'].includes(status),
            instructions: metadata.instructions || this.state.instructions,
            updatedAt: new Date().toISOString(),
            metadata
        };
        this.logService?.record('colmena_ss_status', `Estado COLMENA-SS: ${status}`, { metadata: this.state });
        await this.backendClient?.sendSSSession(this.state);
        return this.state;
    }

    async prepareLogs(bundleMetadata = {}) {
        await this.setStatus(this.state.status, { ...bundleMetadata, packagePrepared: true });
        return { success: true, filename: `COLMENA_SS_LOG_PACKAGE_${new Date().toISOString().replace(/[:.]/g, '-')}.json`, state: this.state };
    }
}

module.exports = ColmenaSSService;
