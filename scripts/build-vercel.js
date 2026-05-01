const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'web');
const target = path.join(root, 'public');

if (!fs.existsSync(source)) {
  console.error('No se encontro el directorio web para compilar.');
  process.exit(1);
}

require('child_process').execFileSync(process.execPath, ['--check', path.join(source, 'app.js')], {
  stdio: 'inherit'
});

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.cpSync(source, target, { recursive: true });

// The existing HTML is compatible with the local Electron/server path `/web/*`.
// Keep that path available on Vercel too while also serving clean root pages.
fs.mkdirSync(path.join(target, 'web'), { recursive: true });
fs.cpSync(source, path.join(target, 'web'), { recursive: true });

console.log('Build Vercel listo: web copiado a public y public/web.');
