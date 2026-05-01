const http = require('http');

const baseUrl = (process.env.SMOKE_BASE_URL || process.env.APP_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

const request = (pathname, options = {}) => new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const req = http.request(url, {
        method: options.method || 'GET',
        headers: {
            'content-type': 'application/json',
            ...(options.headers || {})
        },
        timeout: options.timeout || 6000
    }, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => {
        req.destroy(new Error(`Timeout calling ${url}`));
    });
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
});

(async () => {
    const checks = [
        ['home', '/', 200],
        ['colmena-ss', '/colmena-ss', 200],
        ['planes', '/api/public/colmena-ss-plans', 200],
        ['status', '/api/status', 200]
    ];
    const results = [];
    for (const [name, path, expected] of checks) {
        const res = await request(path);
        results.push({ name, path, status: res.status, ok: res.status === expected });
    }
    console.log(JSON.stringify({ baseUrl, results }, null, 2));
    if (results.some(r => !r.ok)) process.exit(1);
})().catch(err => {
    console.error(err.message);
    process.exit(1);
});
