#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/colmena-web"
cd "$APP_DIR"

npm ci --omit=dev
npm run check:prod-env
pm2 start deployment/ecosystem.config.js
pm2 save
pm2 startup

echo "Colmena arrancado con PM2. Revisa: pm2 logs colmena-web"
