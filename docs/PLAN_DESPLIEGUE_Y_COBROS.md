# Plan definitivo de despliegue y cobros

## 1. Objetivo

Poner online Colmena WorkSuite + COLMENA-SS para que clientes reales puedan:

1. Entrar en la web.
2. Registrarse.
3. Contratar `SCANER` o `MONTHLY_SERVER`.
4. Pagar con Stripe.
5. Recibir invitacion Discord.
6. Entrar al Discord.
7. Recibir rol automatico.
8. Activar operacion de soporte/escaneo.

## 2. Donde se cobra el dinero

El dinero se cobra en la cuenta Stripe del propietario de Colmena.

Flujo:

1. Cliente paga en la web.
2. Stripe procesa tarjeta/metodo de pago.
3. Stripe registra el pago o suscripcion.
4. Stripe transfiere el saldo disponible a la cuenta bancaria configurada.

En Stripe se ve:

- Pagos.
- Clientes.
- Suscripciones.
- Facturas.
- Reembolsos.
- Payouts/transferencias al banco.

## 3. Productos Stripe

### COLMENA-SS Escaner Individual

- Codigo interno: `SCANER`
- Tipo: pago unico
- Stripe Checkout mode: `payment`
- Rol Discord: `CLIENTE_SCANER`
- Activacion: al recibir `checkout.session.completed`

### COLMENA-SS Mensual Servidor

- Codigo interno: `MONTHLY_SERVER`
- Tipo: suscripcion mensual
- Stripe Checkout mode: `subscription`
- Rol Discord: `SERVIDOR_VERIFICADO`
- Activacion: al recibir `checkout.session.completed`
- Renovacion: `invoice.payment_succeeded`
- Fallo de pago: `invoice.payment_failed`
- Cancelacion: `customer.subscription.deleted`

## 4. Webhook Stripe

Endpoint:

```text
https://colmenaworksuite.com/api/stripe/webhook
```

Eventos:

- `checkout.session.completed`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `customer.subscription.deleted`

El backend valida `STRIPE_WEBHOOK_SECRET`.

## 5. Servidor recomendado

VPS Ubuntu 22.04/24.04:

- 1-2 vCPU.
- 2 GB RAM minimo.
- 20 GB SSD minimo.
- Node.js 22.
- Nginx.
- PM2.
- PostgreSQL si se migra de JSON a DB real.

## 6. Dominio y DNS

Crear registros:

```text
A     colmenaworksuite.com      IP_DEL_VPS
A     www                       IP_DEL_VPS
```

Despues activar HTTPS con Let's Encrypt.

## 7. Variables de produccion

Usar:

```text
deployment/.env.production.example
```

Cambiar:

- `APP_URL`
- `JWT_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `DISCORD_BOT_TOKEN`
- `DISCORD_GUILD_ID`
- `DISCORD_OWNER_ID`
- `SMTP_*`

## 8. Proceso de despliegue

1. Crear VPS.
2. Apuntar dominio.
3. Copiar proyecto a `/var/www/colmena`.
4. Crear `.env`.
5. Ejecutar:

```bash
bash deployment/install-vps.sh
bash deployment/start-vps.sh
```

6. Configurar Nginx.
7. Activar SSL.
8. Configurar webhook Stripe.
9. Probar compra test.
10. Cambiar Stripe a live.

## 9. Prueba de cierre

- Registro web OK.
- Login OK.
- Checkout `SCANER` OK.
- Checkout `MONTHLY_SERVER` OK.
- Webhook marca `PAID`.
- Panel muestra invitacion.
- Bot asigna rol.
- Owner recibe DM.
- Cliente recibe DM.
- Logs guardados.

## 10. Cuando llegue la primera compra

1. Revisar Stripe: pago recibido.
2. Revisar panel: pedido `PAID`.
3. Revisar Discord: usuario con rol correcto.
4. Contactar al cliente por su canal/ticket.
5. Ejecutar el servicio contratado.
6. Guardar reporte/evidencias.
