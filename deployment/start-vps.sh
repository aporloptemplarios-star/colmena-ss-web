#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/colmena-web"
cd "$APP_DIR"

npm ci --omit=dev
npm run check:prod-env
pm2 start deployment/ecosystem.config.js --update-env
pm2 save

sudo cp deployment/nginx-api-colmena.conf /etc/nginx/sites-available/colmena-api
if [ ! -e /etc/nginx/sites-enabled/colmena-api ]; then
  sudo ln -s /etc/nginx/sites-available/colmena-api /etc/nginx/sites-enabled/colmena-api
fi
sudo nginx -t
sudo systemctl reload nginx

echo "Colmena arrancado con PM2. Revisa: pm2 logs colmena-web"
echo "Cuando api.colmena-ss.es apunte al VPS, activa SSL con:"
echo "  sudo certbot --nginx -d api.colmena-ss.es"
