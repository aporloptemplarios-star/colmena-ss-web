# Secretos de produccion COLMENA-SS

No pegues secretos en GitHub. Estos valores van solo en:

- Vercel > Project > Settings > Environment Variables
- VPS `/var/www/colmena-web/.env`

## Vercel

```txt
COLMENA_API_BASE=https://api.colmena-ss.es
NEXT_PUBLIC_COLMENA_API_BASE=https://api.colmena-ss.es
```

## VPS obligatorios

```txt
JWT_SECRET=
COLMENA_JWT_SECRET=
COLMENA_HMAC_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DISCORD_OWNER_ID=
DISCORD_INVITE_CHANNEL_ID=
ROLE_CLIENTE_SCANER_ID=
ROLE_SERVIDOR_VERIFICADO_ID=
ROLE_SIN_VERIFICAR_ID=
```

## SMTP

```txt
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM="Colmena WorkSuite <no-reply@colmena-ss.es>"
```

## Como generar secretos fuertes en VPS

```bash
openssl rand -base64 48
```

Usa un valor distinto para:

- `JWT_SECRET`
- `COLMENA_JWT_SECRET`
- `COLMENA_HMAC_SECRET`

## Stripe

Webhook:

```txt
https://api.colmena-ss.es/api/stripe/webhook
```

Eventos:

- `checkout.session.completed`
- `invoice.payment_succeeded`
- `customer.subscription.deleted`
- `payment_failed`

## Discord

Activa en Discord Developer Portal:

- Server Members Intent
- Message Content Intent si se usan comandos por mensaje

El rol del bot debe estar por encima de:

- `CLIENTE_SCANER`
- `SERVIDOR_VERIFICADO`
- `SIN_VERIFICAR`
