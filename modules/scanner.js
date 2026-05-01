const { exec } = require('child_process');
const axios = require('axios');
const EventEmitter = require('events');
const os = require('os');

class ColmenaScanner extends EventEmitter {
    constructor(apiUrl, apiKey) {
        super();
        this.apiUrl = apiUrl;
        this.apiKey = apiKey;
        this.rules = [
            { match: 'cheatengine', label: 'Cheat Engine', severity: 'CRITICAL' },
            { match: 'cheat engine', label: 'Cheat Engine', severity: 'CRITICAL' },
            { match: 'injector', label: 'Generic Injector', severity: 'HIGH' },
            { match: 'xenos', label: 'Xenos Injector', severity: 'HIGH' },
            { match: 'extreme injector', label: 'Extreme Injector', severity: 'HIGH' },
            { match: 'process hacker', label: 'Process Hacker', severity: 'MEDIUM' },
            { match: 'wireshark', label: 'Wireshark', severity: 'MEDIUM' }
        ];
        this.interval = null;
        this.lastDetections = new Map();
        this.cooldownMs = 60 * 1000;
    }

    start() {
        console.log('[ANTICHEAT] Scanner iniciado...');
        this.scan();
        this.interval = setInterval(() => this.scan(), 10000);
    }

    stop() {
        if (this.interval) clearInterval(this.interval);
    }

    parseTasklist(stdout) {
        return stdout
            .split(/\r?\n/)
            .filter(Boolean)
            .map(line => {
                const columns = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
                const clean = columns.map(value => value.replace(/^"|"$/g, '').trim());
                return {
                    imageName: clean[0] || 'Unknown',
                    pid: clean[1] || 'Unknown',
                    sessionName: clean[2] || '',
                    sessionNumber: clean[3] || '',
                    memoryUsage: clean[4] || ''
                };
            });
    }

    findRule(processName) {
        const normalized = processName.toLowerCase();
        return this.rules.find(rule => normalized.includes(rule.match));
    }

    scan() {
        exec('tasklist /fo csv /nh', (err, stdout) => {
            if (err) return;

            const processes = this.parseTasklist(stdout);
            processes.forEach(processInfo => {
                const rule = this.findRule(processInfo.imageName);
                if (!rule) return;

                const detectionKey = `${rule.match}:${processInfo.pid}`;
                const now = Date.now();
                const lastSeen = this.lastDetections.get(detectionKey) || 0;
                if (now - lastSeen < this.cooldownMs) return;
                this.lastDetections.set(detectionKey, now);

                const data = {
                    type: 'Software Prohibido',
                    severity: rule.severity,
                    process: processInfo.imageName,
                    pid: processInfo.pid,
                    match: rule.match,
                    rule: rule.label,
                    memoryUsage: processInfo.memoryUsage,
                    user: process.env.USERNAME || os.userInfo().username || 'Usuario Local',
                    source: 'local-anticheat'
                };
                this.emit('detection', data);
                this.reportDetection(data);
            });
        });
    }

    async reportDetection(detection) {
        try {
            await axios.post(`${this.apiUrl}/alert`, detection, {
                headers: { 'x-api-key': this.apiKey },
                timeout: 8000
            });
            console.log(`[ANTICHEAT] Alerta enviada: ${detection.process} PID ${detection.pid}`);
        } catch (e) {
            console.error('[ANTICHEAT] Error al enviar alerta:', e.message);
        }
    }
}

module.exports = ColmenaScanner;
