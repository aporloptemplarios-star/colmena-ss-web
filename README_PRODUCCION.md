# COLMENA WorkSuite Produccion

## Componentes

- Launcher Electron.
- Discord Bot `discord.js` v14.
- COLMENA-SS para escaneos consentidos.
- Anticheat Bridge.
- AI Integration OpenAI/Gemini.
- Backend Client con HMAC y cola offline.
- Sistema de logs y reportes.

## Arranque

```powershell
E:\launcher\node_modules\.bin\electron.cmd E:\launcher
```

## Configuracion

1. Copiar `.env.example` a `.env`.
2. Configurar secretos solo en `.env`.
3. Configurar no secretos en `config/colmena.config.json`.
4. Activar intents necesarios del bot en Discord Developer Portal.
5. En Discord usar `!activar-colmena-ss` para publicar paneles.

## Produccion

Estado local verificado:

- Web local: `http://127.0.0.1:3000`.
- `/api/status`: responde.
- `/api/health`: responde `503` hasta configurar credenciales reales.
- Smoke test local: aprobado.
- Paquete para subir: `Colmena_Web_Final.zip`.

Pendientes obligatorios antes de poner online:

- Dominio principal configurado: `https://colmena-ss.es`.
- Alias previstos: `colmena-ss.com`, `colmena-ss.org`, `colmena-ss.store`.
- En Vercel, agregar estos dominios al proyecto:
  - `colmena-ss.es`
  - `www.colmena-ss.es`
  - `colmena-ss.com`
  - `www.colmena-ss.com`
  - `colmena-ss.org`
  - `www.colmena-ss.org`
  - `colmena-ss.store`
  - `www.colmena-ss.store`
- DNS recomendado para dominios en Vercel:
  - Apex/root: `A @ 76.76.21.21`
  - WWW: `CNAME www` al valor exacto que muestre Vercel, normalmente `cname.vercel-dns.com`.
- Configurar VPS Ubuntu.
- Configurar Stripe live y webhook real `https://api.colmena-ss.es/api/stripe/webhook`.
- Configurar Discord bot, guild, owner, canal de invitaciones y roles.
- Configurar SMTP real.
- Copiar `.env.production` como `.env` en el VPS y quitar todos los valores `PENDIENTE`.

Comandos clave en VPS:

```bash
cd /var/www/colmena-web
npm ci --omit=dev
npm run check:prod-env
pm2 start deployment/ecosystem.config.js
pm2 save
npm run smoke:prod
```

Backend/bot en VPS:

```bash
cd /var/www/colmena-web
pm2 logs colmena-web
npm run smoke:api
```

Reglas:

- Usar un servidor Discord de staging antes de reconstruir un servidor real.
- Ejecutar rebuild solo con `CONFIRMAR_REBUILD_COLMENA_CORE`.
- No distribuir `data`, `logs` ni `.env` con el paquete final.
- Mantener evidencias solo con consentimiento y minimo dato necesario.

## Rollback

Backups disponibles en:

```text
E:\launcher\backup_colmena_launcher\
```

Cerrar Electron, copiar el backup elegido sobre `E:\launcher` y volver a iniciar.
