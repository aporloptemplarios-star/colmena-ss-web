const https = require('https');

const baseUrl = (process.env.COLMENA_API_BASE || process.env.API_BASE_URL || 'https://api.colmena-ss.es').replace(/\/$/, '');

const request = (pathname) => new Promise((resolve, reject) => {
  const url = new URL(pathname, baseUrl);
  const req = https.request(url, { method: 'GET', timeout: 8000 }, (res) => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('timeout', () => req.destroy(new Error(`Timeout calling ${url}`)));
  req.on('error', reject);
  req.end();
});

(async () => {
  const checks = [
    ['status', '/api/status', [200]],
    ['health', '/api/health', [200, 503]],
    ['plans', '/api/public/colmena-ss-plans', [200]]
  ];
  const results = [];
  for (const [name, path, expected] of checks) {
    const res = await request(path);
    results.push({ name, path, status: res.status, ok: expected.includes(res.status) });
  }
  console.log(JSON.stringify({ baseUrl, results }, null, 2));
  if (results.some(r => !r.ok)) process.exit(1);
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
