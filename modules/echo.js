const axios = require('axios');

class EchoService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.echo.ac/v1'; // URL estándar de la API de Echo
    }

    async getLatestScans() {
        try {
            const response = await axios.get(`${this.baseUrl}/scans`, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` },
                timeout: 5000
            });
            return response.data;
        } catch (e) {
            console.error('[ECHO] Error al obtener escaneos:', e.message);
            return null;
        }
    }

    async getDetections() {
        try {
            const response = await axios.get(`${this.baseUrl}/detections`, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` },
                timeout: 5000
            });
            return response.data;
        } catch (e) {
            console.error('[ECHO] Error al obtener detecciones:', e.message);
            return null;
        }
    }

    async verifyStatus() {
        try {
            const response = await axios.get(`${this.baseUrl}/status`, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` },
                timeout: 3000
            });
            return response.status === 200;
        } catch (e) {
            return false;
        }
    }
}

module.exports = EchoService;
