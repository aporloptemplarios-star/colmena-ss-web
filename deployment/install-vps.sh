#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/colmena-web"

sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx postgresql postgresql-contrib

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
fi

sudo npm install -g pm2
sudo mkdir -p "$APP_DIR" /var/log/colmena
sudo chown -R "$USER":"$USER" "$APP_DIR" /var/log/colmena

echo "Copia Colmena_Web_Final.zip a $APP_DIR, crea .env desde deployment/.env.production.example y ejecuta deployment/start-vps.sh"
