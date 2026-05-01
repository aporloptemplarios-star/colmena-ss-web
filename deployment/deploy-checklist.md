# Checklist despliegue online Colmena

## Antes de publicar

- Dominio principal: `colmena-ss.es`.
- Dominios secundarios: `colmena-ss.com`, `colmena-ss.org`, `colmena-ss.store`.
- En Vercel, agregar tambien `www` para cada dominio.
- DNS Vercel:
  - `A @ 76.76.21.21`
  - `CNAME www` al valor exacto que muestre Vercel, normalmente `cname.vercel-dns.com`
- VPS Ubuntu creado.
- DNS A apuntando al VPS.
- `.env.production` local preparado con pendientes controlados.
- En VPS copiar `.env.production` como `.env` y sustituir todos los `PENDIENTE_*`.
- Stripe en modo live configurado.
- Webhook Stripe apuntando al endpoint real del proyecto: `https://colmena-ss.es/api/stripe/webhook`.
- Discord bot invitado al servidor.
- Server Members Intent activado.
- Roles Discord creados o IDs configurados.
- Canal de invitacion configurado.
- SMTP configurado.

## Comandos VPS

```bash
sudo apt update
sudo apt install -y nodejs npm nginx pm2 unzip git certbot python3-certbot-nginx
sudo mkdir -p /var/www/colmena-web /var/log/colmena
cd /var/www/colmena-web
unzip Colmena_Web_Final.zip
npm ci --omit=dev
npm run build
cp .env.production .env
nano .env
npm run check:prod-env
pm2 start deployment/ecosystem.config.js
pm2 save
pm2 startup
sudo cp deployment/nginx-colmena.conf /etc/nginx/sites-available/colmena-web
sudo ln -s /etc/nginx/sites-available/colmena-web /etc/nginx/sites-enabled/colmena-web
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d colmena-ss.es -d www.colmena-ss.es -d colmena-ss.com -d www.colmena-ss.com -d colmena-ss.org -d www.colmena-ss.org -d colmena-ss.store -d www.colmena-ss.store
npm run smoke:prod
```

## Prueba final

- `GET /api/status` debe responder con el estado general.
- `GET /api/health` debe responder `ready: true` cuando Stripe, Discord y JWT esten configurados.
- Stripe debe enviar `checkout.session.completed` al endpoint `/api/stripe/webhook`.
- Abrir `/registro`.
- Crear usuario.
- Comprar `SCANER`.
- Confirmar pago test/live.
- Ver invitacion en `/panel`.
- Entrar al Discord con el Discord ID registrado.
- Confirmar rol `CLIENTE_SCANER`.
- Repetir con `MONTHLY_SERVER`.
