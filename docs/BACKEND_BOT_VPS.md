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

## Variables Vercel

En el proyecto Vercel configura:

```txt
COLMENA_API_BASE=https://api.colmena-ss.es
NEXT_PUBLIC_COLMENA_API_BASE=https://api.colmena-ss.es
```

Despues haz redeploy.

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

## Nginx para API

```nginx
server {
    listen 80;
    server_name api.colmena-ss.es;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Activar SSL:

```bash
sudo certbot --nginx -d api.colmena-ss.es
```

## Prueba final

```bash
curl https://api.colmena-ss.es/api/status
curl https://api.colmena-ss.es/api/health
```

Luego probar registro, login, checkout Stripe, webhook, invitacion Discord y asignacion de roles.
