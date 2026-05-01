# README_FASE5_SAAS - Comercializacion Colmena WorkSuite

Fecha: 2026-05-01

## Web

La web se sirve desde el backend existente:

```text
http://127.0.0.1:3000/web/index.html
http://127.0.0.1:3000/web/login.html
http://127.0.0.1:3000/web/panel.html
http://127.0.0.1:3000/colmena-ss
```

Incluye:

- Home premium.
- Productos Basic, Premium y Enterprise Diamond.
- Pagina independiente COLMENA-SS.
- Precios.
- Contacto.
- Panel cliente.
- Seccion "Mis servicios COLMENA-SS".

## Backend SaaS

Endpoints publicos:

- `GET /api/public/plans`
- `GET /api/public/colmena-ss-plans`
- `POST /api/colmena-ss/checkout`
- `POST /api/colmena-ss/order-checkout`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/recover`
- `POST /api/auth/reset`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

Endpoints cliente:

- `POST /api/payments/checkout`
- `GET /api/panel/dashboard`
- `GET /api/panel/license`
- `GET /api/panel/scans`
- `GET /api/panel/logs`
- `POST /api/panel/support`

Stripe:

- `POST /api/stripe/webhook`

Eventos soportados:

- `checkout.session.completed`
- `invoice.payment_succeeded`
- `customer.subscription.deleted`
- `payment_failed`

Admin:

- `GET /api/admin/dashboard`

## Stripe

Configurar en `.env`:

```env
COLMENA_PUBLIC_URL=https://tu-dominio.com
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
COLMENA_JWT_SECRET=valor_largo_aleatorio
```

Si `STRIPE_SECRET_KEY` no esta configurado, el checkout funciona en modo simulado para pruebas internas. En WorkSuite genera licencia demo; en COLMENA-SS activa cliente, creditos, invitacion Discord y cola de email local.

## Flujo comercial WorkSuite

1. Cliente se registra.
2. Cliente elige plan.
3. Se crea checkout Stripe.
4. Stripe confirma pago en webhook.
5. Backend genera `license_key`.
6. Cliente activa licencia en launcher.

## Flujo COLMENA-SS independiente

1. Cliente entra en `/colmena-ss`.
2. Selecciona escaneo individual, Starter, Pro o Diamond SS.
3. Introduce servidor, Discord ID, enlace si aplica y email.
4. Stripe confirma el pago.
5. Backend crea cliente, suscripcion, creditos de escaneo y registro de auditoria.
6. Backend solicita al bot Discord una invitacion unica.
7. El bot crea roles si faltan: `CLIENTE_SS_INDIVIDUAL`, `CLIENTE_SS_STARTER`, `CLIENTE_SS_PRO`, `CLIENTE_SS_DIAMOND` y `CLIENTE_SS_EXPIRADO`.
8. Al entrar al Discord, el bot asigna rol segun plan y registra acceso.
9. Si el plan incluye canal privado, se crea canal dedicado de cliente.
10. El panel cliente muestra plan activo, creditos, invitacion y estado.

## Flujo registro web -> compra -> Discord -> rol -> owner

COLMENA-SS exige registro antes de contratar. Si no hay sesion, el checkout queda bloqueado con `401 AUTH_REQUIRED` y la web muestra: `Debes registrarte o iniciar sesion para contratar COLMENA-SS.`

Campos obligatorios de usuario:

- Nombre completo.
- Email.
- Usuario Discord.
- Discord ID.
- Nombre del servidor.
- Enlace del Discord del servidor.
- Contrasena.
- Aceptacion de terminos.
- Aceptacion de COLMENA-SS.

La tabla local de usuarios vive en `data/saas_users.json` y guarda perfil completo con `password_hash`, aceptaciones y fechas.

Contratos principales:

- `SCANER`: pago unico, rol Discord `CLIENTE_SCANER`.
- `MONTHLY_SERVER`: suscripcion mensual, rol Discord `SERVIDOR_VERIFICADO`.

Formulario web:

- Nombre del comprador.
- Email.
- Discord ID del comprador.
- Nombre del servidor.
- Enlace del Discord del servidor.
- Tipo de contrato.
- Notas opcionales.

Cuando Stripe confirma `checkout.session.completed`, el backend marca el pedido en `data/orders.json` con:

- `user_id`
- `plan`
- `payment_status`
- `stripe_session_id`
- `stripe_customer_id`
- `amount`
- `currency`
- `discord_invite_code`
- `discord_joined`
- `role_assigned`
- `owner_notified`
- `created_at`

Despues del pago:

1. Se genera invitacion unica al Discord COLMENA-SS.
2. Se deja email de confirmacion en `data/ss_email_outbox.json`.
3. Al entrar al Discord, `guildMemberAdd` busca usuario por `users.discord_id`, despues pedido `PAID` por `orders.user_id`.
4. El bot asigna `CLIENTE_SCANER` o `SERVIDOR_VERIFICADO`.
5. El bot envia DM al owner con perfil web, pedido, importe y rol.
6. El bot envia DM de bienvenida al cliente.
7. Si no hay pedido pagado, se asigna `SIN_VERIFICAR` si existe y se loggea en `#📜・logs-bot`.

Comandos admin:

- `/buscar_pedido discord_id`
- `/reasignar_rol discord_id`

Para que `guildMemberAdd` funcione, activa en Discord Developer Portal el privileged intent `Server Members Intent` y configura:

```env
DISCORD_ENABLE_GUILD_MEMBERS=true
```

## Datos locales

- `data/saas_users.json`
- `data/saas_payments.json`
- `data/saas_generated_licenses.json`
- `data/saas_support_tickets.json`
- `data/licenses.json`
- `data/ss_customers.json`
- `data/ss_payments.json`
- `data/ss_subscriptions.json`
- `data/ss_discord_invites.json`
- `data/ss_scan_credits.json`
- `data/ss_email_outbox.json`
- `data/ss_access_logs.json`
- `data/orders.json`
- `data/password_reset_tokens.json`
- `data/password_reset_email_outbox.json`
- `data/auth_logs.json`

## Pruebas realizadas

- Planes publicos OK.
- Registro OK.
- Checkout simulado OK.
- Licencia automatica OK.
- Panel cliente OK.
- Pagina `/colmena-ss` OK.
- Planes COLMENA-SS OK.
- Checkout COLMENA-SS simulado OK.
- Checkout order `SCANER` OK.
- Checkout order `MONTHLY_SERVER` OK.
- Checkout COLMENA-SS sin login bloqueado OK.
- Registro con perfil completo OK.
- Pedido vinculado por `user_id` OK.
- Invitacion Discord, creditos y email outbox OK.
- Recuperacion de contraseña web OK.
- Recuperacion de contraseña launcher/API OK.
- Token usado y expirado bloqueados OK.
- Login con nueva contraseña OK.
- `node --check` OK.

## Pendiente para produccion real

- Conectar dominio y TLS.
- Configurar Stripe live.
- Sustituir JSON local por base de datos gestionada.
- Enviar license key por email transaccional.
- Enviar email COLMENA-SS por proveedor transaccional.
- Anadir CRM o webhook Discord para formulario de contacto.
