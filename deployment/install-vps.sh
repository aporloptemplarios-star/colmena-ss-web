#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/colmena-web"

sudo apt update
sudo apt install -y curl ca-certificates nginx certbot python3-certbot-nginx unzip git postgresql postgresql-contrib

if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
fi

sudo npm install -g pm2
sudo mkdir -p "$APP_DIR" /var/log/colmena
sudo chown -R "$USER":"$USER" "$APP_DIR" /var/log/colmena

echo "VPS base listo."
echo "Siguiente:"
echo "  cd $APP_DIR"
echo "  git clone https://github.com/aporloptemplarios-star/colmena-ss-web.git ."
echo "  cp deployment/.env.production.example .env"
echo "  nano .env"
echo "  deployment/start-vps.sh"
