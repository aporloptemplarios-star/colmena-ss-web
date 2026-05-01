# Colmena Web Final - Instalacion

## Rutas

- `/`
- `/colmena-ss`
- `/precios`
- `/registro`
- `/login`
- `/forgot-password`
- `/reset-password?token=...`
- `/panel`
- `/checkout/success`
- `/checkout/cancel`

## Instalar dependencias

```powershell
cd E:\launcher
npm install
```

El `npm` global del equipo puede estar roto. Para arrancar esta build local usa Electron incluido:

```powershell
.\node_modules\.bin\electron.cmd .
```

Para arrancar solo la web/backend de produccion:

```powershell
node server.production.js
```

Antes de publicar en VPS valida la configuracion:

```powershell
npm run check:prod-env
```

Con el servidor arrancado ejecuta la prueba rapida:

```powershell
npm run smoke:prod
```

Endpoints de control:

- `/api/status`: estado general sin exponer secretos.
- `/api/health`: devuelve `ready: true` solo cuando JWT, Stripe y Discord estan listos.

## Configurar `.env`

Copia `.env.example` a `.env` y rellena:

```env
DATABASE_URL=
JWT_SECRET=
COLMENA_JWT_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLIC_KEY=
DISCORD_TOKEN=
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DISCORD_OWNER_ID=
DISCORD_INVITE_CHANNEL_ID=
ROLE_CLIENTE_SCANER_ID=
ROLE_SERVIDOR_VERIFICADO_ID=
ROLE_SIN_VERIFICAR_ID=
APP_URL=http://localhost:3000
COLMENA_PUBLIC_URL=http://127.0.0.1:3000
DISCORD_ENABLE_GUILD_MEMBERS=true
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM="Colmena WorkSuite <no-reply@colmena.com>"
PASSWORD_RESET_EXPIRES_MINUTES=30
```

Activa en Discord Developer Portal:

- Server Members Intent.
- Message Content Intent si quieres comandos por mensaje.

## Crear productos Stripe

Productos recomendados:

- `COLMENA-SS Contrato por Escaner`
  - Pago unico.
  - Metadata plan: `SCANER`.

- `COLMENA-SS Mensual Servidor`
  - Suscripcion mensual.
  - Metadata plan: `MONTHLY_SERVER`.

Webhook:

```text
POST https://tu-dominio.com/api/stripe/webhook
```

Eventos:

- `checkout.session.completed`
- `invoice.payment_succeeded`
- `customer.subscription.deleted`
- `payment_failed`

## Configurar roles Discord

Roles:

- `CLIENTE_SCANER`
- `SERVIDOR_VERIFICADO`
- `SIN_VERIFICAR`

Puedes usar IDs en `.env` o dejar que el bot cree roles por nombre.

## Probar pago test

Sin `STRIPE_SECRET_KEY`, el checkout funciona en modo local simulado:

1. Entra en `http://127.0.0.1:3000/registro`.
2. Registra usuario con Discord ID.
3. Entra en `http://127.0.0.1:3000/colmena-ss`.
4. Contrata `SCANER`.
5. Revisa `http://127.0.0.1:3000/panel`.

Con Stripe test:

1. Configura `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET`.
2. Usa tarjeta test `4242 4242 4242 4242`.
3. Verifica que el webhook marca el pedido como `PAID`.

## Probar asignacion de rol

1. El usuario entra al Discord usando el Discord ID registrado.
2. `guildMemberAdd` busca `users.discord_id`.
3. Busca pedido `PAID` con `orders.user_id`.
4. Asigna:
   - `SCANER` -> `CLIENTE_SCANER`
   - `MONTHLY_SERVER` -> `SERVIDOR_VERIFICADO`
5. El owner recibe DM.
6. El cliente recibe DM.
7. El pedido se marca con `discord_joined=true` y `role_assigned=true`.

## Comandos admin

- `/buscar_pedido discord_id`
- `/reasignar_rol discord_id`

Solo owner/admin.

## Datos locales de prueba

La build local usa JSON en `data/` para pruebas:

- `saas_users.json`
- `orders.json`
- `ss_email_outbox.json`
- `ss_access_logs.json`
- `password_reset_tokens.json`
- `password_reset_email_outbox.json`
- `auth_logs.json`

Para produccion real, sustituir por PostgreSQL usando `database/schema.sql`.

## Recuperacion de contraseña

Web:

1. Entra en `/forgot-password`.
2. Escribe email.
3. El backend responde siempre con mensaje generico.
4. Si el usuario existe, se genera token seguro de 32 bytes, se guarda solo `token_hash` y se prepara email con enlace `/reset-password?token=...`.
5. En `/reset-password`, el usuario introduce nueva contraseña.

Launcher:

1. En la pantalla de login pulsa `¿Has olvidado tu contraseña?`.
2. Introduce email.
3. El launcher llama al mismo backend central `POST /api/auth/forgot-password`.
4. El cambio final se completa desde la web.

Seguridad:

- Token de un solo uso.
- Expira en 30 minutos por defecto.
- Respuesta generica para evitar enumeracion.
- Rate limit por IP/email.
- No se guarda token real ni contraseña plana.
- Se registran eventos en `auth_logs.json`.
