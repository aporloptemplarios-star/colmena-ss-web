# Backend y Bot COLMENA-SS en VPS

La web puede vivir en Vercel. El backend, Stripe webhook y bot Discord deben vivir en un proceso Node persistente, recomendado en un VPS Ubuntu con PM2.

## Arquitectura

- Frontend Vercel: `https://colmena-ss.es`
- Backend/API: `https://api.colmena-ss.es`
- Bot Discord: mismo proceso `server.production.js`
- Stripe webhook: `https://api.colmena-ss.es/api/stripe/webhook`

## DNS recomendado

En el dominio:

```txt
A      api      IP_DEL_VPS
```

El dominio principal `colmena-ss.es` sigue apuntando a Vercel.

No cambies los registros de la web:

```txt
A      @      216.198.79.1
CNAME  www    valor-vercel-dns
```

## Variables Vercel

En el proyecto Vercel configura:

```txt
COLMENA_API_BASE=https://api.colmena-ss.es
NEXT_PUBLIC_COLMENA_API_BASE=https://api.colmena-ss.es
```

Despues haz redeploy.

Mientras `COLMENA_API_BASE` no exista, la landing sigue funcionando con planes estaticos, pero registro, login, panel y checkout necesitan la API real.

## Variables VPS

En `/var/www/colmena-web/.env`:

```txt
NODE_ENV=production
APP_URL=https://api.colmena-ss.es
COLMENA_PUBLIC_URL=https://api.colmena-ss.es
CORS_ORIGINS=https://colmena-ss.es,https://www.colmena-ss.es,https://colmena-ss-web.vercel.app
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
DISCORD_OWNER_ID=...
DISCORD_INVITE_CHANNEL_ID=...
ROLE_CLIENTE_SCANER_ID=...
ROLE_SERVIDOR_VERIFICADO_ID=...
ROLE_SIN_VERIFICAR_ID=...
SMTP_HOST=...
SMTP_USER=...
SMTP_PASS=...
```

## Arranque VPS

```bash
cd /var/www/colmena-web
npm ci --omit=dev
npm run check:prod-env
pm2 start deployment/ecosystem.config.js
pm2 save
```

Comandos completos para un VPS nuevo:

```bash
sudo apt update
sudo apt install -y nodejs npm nginx unzip git certbot python3-certbot-nginx
sudo npm install -g pm2
sudo mkdir -p /var/www/colmena-web /var/log/colmena
sudo chown -R $USER:$USER /var/www/colmena-web /var/log/colmena
cd /var/www/colmena-web
git clone https://github.com/aporloptemplarios-star/colmena-ss-web.git .
npm ci --omit=dev
cp deployment/.env.production.example .env
nano .env
npm run check:prod-env
pm2 start deployment/ecosystem.config.js
pm2 save
```

## Nginx para API

```bash
sudo cp deployment/nginx-api-colmena.conf /etc/nginx/sites-available/colmena-api
sudo ln -s /etc/nginx/sites-available/colmena-api /etc/nginx/sites-enabled/colmena-api
sudo nginx -t
sudo systemctl reload nginx
```

Activar SSL:

```bash
sudo certbot --nginx -d api.colmena-ss.es
```

## Prueba final

```bash
curl https://api.colmena-ss.es/api/status
curl https://api.colmena-ss.es/api/health
npm run smoke:api
```

Luego probar registro, login, checkout Stripe, webhook, invitacion Discord y asignacion de roles.

## Stripe

Webhook final:

```txt
https://api.colmena-ss.es/api/stripe/webhook
```

Eventos:

- `checkout.session.completed`
- `invoice.payment_succeeded`
- `customer.subscription.deleted`
- `payment_failed`

## Discord

Requisitos del bot:

- Server Members Intent activo.
- Permiso para gestionar roles.
- Rol del bot por encima de `CLIENTE_SCANER`, `SERVIDOR_VERIFICADO` y `SIN_VERIFICAR`.
- Permiso para crear invitaciones en el canal configurado.
- `DISCORD_OWNER_ID` correcto para recibir DM.
