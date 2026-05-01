const fs = require('fs');
const os = require('os');
const path = require('path');
const dns = require('dns').promises;

class RepairService {
    constructor(options = {}) {
        this.rootDir = options.rootDir || process.cwd();
        this.logService = options.logService;
    }

    async inspect() {
        const checks = [];
        checks.push({ id: 'launcher_root', label: 'Ruta launcher', ok: fs.existsSync(this.rootDir), detail: this.rootDir });
        checks.push({ id: 'package', label: 'package.json', ok: fs.existsSync(path.join(this.rootDir, 'package.json')), detail: 'Configuracion Node/Electron' });
        checks.push({ id: 'electron', label: 'Electron local', ok: fs.existsSync(path.join(this.rootDir, 'node_modules', '.bin', 'electron.cmd')), detail: 'Runtime local' });
        checks.push({ id: 'config', label: 'Config COLMENA', ok: fs.existsSync(path.join(this.rootDir, 'config', 'colmena.config.json')), detail: 'config/colmena.config.json' });
        try {
            await dns.lookup('discord.com');
            checks.push({ id: 'network', label: 'Conexion', ok: true, detail: 'DNS operativo' });
        } catch (err) {
            checks.push({ id: 'network', label: 'Conexion', ok: false, detail: err.message });
        }
        const report = {
            timestamp: new Date().toISOString(),
            hostname: os.hostname(),
            platform: `${os.platform()} ${os.release()}`,
            checks,
            safeActions: ['limpiar_temporales', 'generar_informe', 'reintentar_backend']
        };
        this.logService?.record('repair_inspection', 'Revision segura del PC completada', { metadata: report });
        return report;
    }

    async cleanTempPreview() {
        const temp = os.tmpdir();
        let count = 0;
        try {
            count = fs.readdirSync(temp).slice(0, 200).length;
        } catch {}
        return { success: true, destructive: false, tempPath: temp, estimatedItems: count, message: 'Vista previa generada. La limpieza real requiere confirmacion explicita.' };
    }
}

module.exports = RepairService;
