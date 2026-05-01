const axios = require('axios');

class AuthService {
    constructor(options = {}) {
        this.baseUrl = (options.baseUrl || 'http://127.0.0.1:3000').replace(/\/$/, '');
        this.timeout = options.timeout || 10000;
    }

    async forgotPassword(email) {
        const response = await axios.post(`${this.baseUrl}/api/auth/forgot-password`, { email }, { timeout: this.timeout });
        return response.data;
    }

    async resetPassword(token, newPassword) {
        const response = await axios.post(`${this.baseUrl}/api/auth/reset-password`, { token, newPassword }, { timeout: this.timeout });
        return response.data;
    }
}

module.exports = AuthService;
