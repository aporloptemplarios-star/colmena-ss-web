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

console.log('Build Vercel listo: web copiado a public.');
