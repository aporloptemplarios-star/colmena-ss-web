const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

class LicenseService {
    constructor(options = {}) {
        this.rootDir = options.rootDir || process.cwd();
        this.dataDir = options.dataDir || path.join(this.rootDir, 'data');
        this.configDir = options.configDir || path.join(this.rootDir, 'config');
        this.logService = options.logService;
        this.cacheTtlMs = options.cacheTtlMs || 6 * 60 * 60 * 1000;
        this.ensureDirs();
    }

    ensureDirs() {
        if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
        if (!fs.existsSync(this.configDir)) fs.mkdirSync(this.configDir, { recursive: true });
    }

    file(name) {
        return path.join(this.dataDir, name);
    }

    readJson(filePath, fallback) {
        try {
            if (!fs.existsSync(filePath)) return fallback;
            return JSON.parse(fs.readFileSync(filePath, 'utf8') || JSON.stringify(fallback));
        } catch {
            return fallback;
        }
    }

    writeJson(filePath, data) {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    }

    plans() {
        return this.readJson(path.join(this.configDir, 'product.plans.json'), { plans: {} }).plans || {};
    }

    hashLicenseKey(licenseKey) {
        return crypto.createHash('sha256').update(String(licenseKey || '').trim()).digest('hex');
    }

    deviceId() {
        return crypto.createHash('sha256').update(`${os.hostname()}|${os.userInfo().username}|${os.platform()}|COLMENA`).digest('hex');
    }

    defaultLicenses() {
        const now = new Date();
        const future = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
        return [
            { license_key_hash: this.hashLicenseKey('COLMENA-BASIC-DEMO'), plan: 'BASIC', status: 'active', expires_at: future, max_users: 5, max_activations: 1, server_id: 'demo-basic', created_at: now.toISOString(), activations: [] },
            { license_key_hash: this.hashLicenseKey('COLMENA-PREMIUM-DEMO'), plan: 'PREMIUM', status: 'active', expires_at: future, max_users: 25, max_activations: 2, server_id: 'demo-premium', created_at: now.toISOString(), activations: [] },
            { license_key_hash: this.hashLicenseKey('COLMENA-DIAMOND-DEMO'), plan: 'ENTERPRISE_DIAMOND', status: 'active', expires_at: future, max_users: 250, max_activations: 10, server_id: 'demo-diamond', created_at: now.toISOString(), activations: [] }
        ];
    }

    readLicenses() {
        const filePath = this.file('licenses.json');
        let licenses = this.readJson(filePath, null);
        if (!licenses) {
            licenses = this.defaultLicenses();
            this.writeJson(filePath, licenses);
        }
        return licenses;
    }

    writeLicenses(licenses) {
        this.writeJson(this.file('licenses.json'), licenses);
    }

    cachePath() {
        return this.file('license_cache.json');
    }

    readCache() {
        return this.readJson(this.cachePath(), null);
    }

    writeCache(cache) {
        this.writeJson(this.cachePath(), { ...cache, cached_at: new Date().toISOString() });
    }

    sanitizeLicense(license) {
        if (!license) return null;
        const planConfig = this.plans()[license.plan] || {};
        return {
            plan: license.plan,
            planLabel: planConfig.label || license.plan,
            status: license.status,
            expires_at: license.expires_at,
            max_users: license.max_users,
            max_activations: license.max_activations,
            server_id: license.server_id,
            features: planConfig.features || {},
            pricing: {
                priceMonthly: planConfig.priceMonthly || 0,
                pricePerScan: planConfig.pricePerScan || 0,
                pricePerServer: planConfig.pricePerServer || 0
            }
        };
    }

    validateLicenseRecord(license, serverId, deviceId) {
        if (!license) return { valid: false, code: 'LICENSE_NOT_FOUND', message: 'Licencia no encontrada.' };
        if (license.status !== 'active') return { valid: false, code: 'LICENSE_INACTIVE', message: 'Licencia inactiva o bloqueada.' };
        if (license.expires_at && Date.parse(license.expires_at) < Date.now()) return { valid: false, code: 'LICENSE_EXPIRED', message: 'Licencia expirada.' };
        if (license.server_id && serverId && license.server_id !== serverId) return { valid: false, code: 'SERVER_MISMATCH', message: 'La licencia no pertenece a este servidor.' };
        const activations = license.activations || [];
        const alreadyActivated = activations.some(a => a.device_id === deviceId);
        if (!alreadyActivated && activations.length >= (license.max_activations || 1)) return { valid: false, code: 'ACTIVATION_LIMIT', message: 'Limite de activaciones alcanzado.' };
        return { valid: true };
    }

    activate({ licenseKey, serverId, clientName }) {
        const keyHash = this.hashLicenseKey(licenseKey);
        const licenses = this.readLicenses();
        const index = licenses.findIndex(l => l.license_key_hash === keyHash);
        const license = licenses[index];
        const deviceId = this.deviceId();
        const validation = this.validateLicenseRecord(license, serverId, deviceId);
        if (!validation.valid) {
            this.logService?.record('license_activation_failed', validation.message, { severity: 'warning', metadata: { code: validation.code, serverId } });
            return { success: false, ...validation };
        }
        license.activations = license.activations || [];
        if (!license.activations.some(a => a.device_id === deviceId)) {
            license.activations.push({ device_id: deviceId, clientName: clientName || os.hostname(), activated_at: new Date().toISOString() });
        }
        license.last_check_at = new Date().toISOString();
        licenses[index] = license;
        this.writeLicenses(licenses);
        const activated = this.sanitizeLicense(license);
        this.writeCache({ valid: true, license: activated, device_id: deviceId, server_id: serverId || license.server_id });
        this.logService?.record('license_activated', `Licencia activada: ${activated.plan}`, { metadata: { plan: activated.plan, serverId: activated.server_id } });
        return { success: true, valid: true, license: activated };
    }

    status() {
        const cache = this.readCache();
        if (!cache?.valid || !cache.license) return { success: true, valid: false, code: 'LICENSE_REQUIRED', message: 'Licencia requerida.' };
        const age = Date.now() - Date.parse(cache.cached_at || 0);
        if (age > this.cacheTtlMs) return { success: true, valid: false, code: 'LICENSE_RECHECK_REQUIRED', message: 'Revalidacion de licencia requerida.', cached: cache };
        const license = cache.license;
        if (license.expires_at && Date.parse(license.expires_at) < Date.now()) return { success: true, valid: false, code: 'LICENSE_EXPIRED', message: 'Licencia expirada.', license };
        return { success: true, valid: true, license, cached_at: cache.cached_at };
    }

    clear() {
        if (fs.existsSync(this.cachePath())) fs.unlinkSync(this.cachePath());
        return { success: true };
    }

    canUse(feature) {
        const status = this.status();
        return Boolean(status.valid && status.license?.features?.[feature]);
    }
}

module.exports = LicenseService;
