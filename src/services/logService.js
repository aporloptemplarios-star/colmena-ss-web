const fs = require('fs');
const path = require('path');

class LogService {
    constructor(options = {}) {
        this.rootDir = options.rootDir || process.cwd();
        this.logDir = options.logDir || path.join(this.rootDir, 'logs');
        this.dataDir = options.dataDir || path.join(this.rootDir, 'data');
        this.maxEntries = options.maxEntries || 500;
        this.ensureDirs();
    }

    ensureDirs() {
        if (!fs.existsSync(this.logDir)) fs.mkdirSync(this.logDir, { recursive: true });
        if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    }

    jsonPath() {
        return path.join(this.dataDir, 'launcher_logs.json');
    }

    readEntries() {
        try {
            if (!fs.existsSync(this.jsonPath())) return [];
            return JSON.parse(fs.readFileSync(this.jsonPath(), 'utf8') || '[]');
        } catch {
            return [];
        }
    }

    writeEntries(entries) {
        fs.writeFileSync(this.jsonPath(), JSON.stringify(entries.slice(0, this.maxEntries), null, 2), 'utf8');
    }

    record(eventType, message, options = {}) {
        this.ensureDirs();
        const entry = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            source: 'launcher',
            eventType,
            severity: options.severity || 'info',
            message,
            metadata: options.metadata || {},
            timestamp: new Date().toISOString()
        };
        const entries = [entry, ...this.readEntries()];
        this.writeEntries(entries);
        const line = `[${entry.timestamp}] [${entry.severity.toUpperCase()}] [${eventType}] ${message}\n`;
        fs.appendFileSync(path.join(this.logDir, 'launcher-enterprise.log'), line, 'utf8');
        return entry;
    }

    getLogs(limit = 120) {
        return this.readEntries().slice(0, limit);
    }
}

module.exports = LogService;
