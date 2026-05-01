# COLMENA Launcher Enterprise

## Ejecucion

Usar Electron local para evitar depender del npm global:

```powershell
E:\launcher\node_modules\.bin\electron.cmd E:\launcher
```

Tambien puede usarse `Abrir Colmena Guardian.bat`.

## Configuracion

Editar `config/colmena.config.json` para valores no secretos:

- `backendUrl`: URL base del backend central.
- `discordGuildId`: ID del servidor Discord.
- `enableAI`, `enableAnticheatBridge`, `enableColmenaSS`: flags funcionales.
- `logLevel`: nivel de logs.

Secretos en `.env`, nunca en codigo:

```env
COLMENA_API_KEY=...
COLMENA_HMAC_SECRET=...
COLMENA_BACKEND_URL=https://tu-backend
DISCORD_TOKEN=...
DISCORD_GUILD_ID=...
OPENAI_API_KEY=...
```

## Backend

Endpoints integrados:

- `POST /api/events`
- `POST /api/launcher/logs`
- `POST /api/launcher/heartbeat`
- `POST /api/anticheat/status`
- `POST /api/ai/analyze`
- `POST /api/discord/sync`
- `POST /api/ss/session`
- `GET /api/user/status`
- `GET /api/system/status`

El launcher firma eventos con HMAC usando `COLMENA_HMAC_SECRET` o la API key.

## Discord

Comandos principales:

```text
!rebuild-colmena-core CONFIRMAR_REBUILD_COLMENA_CORE
!activar-colmena-ss
```

El launcher envia eventos hacia backend para que el bot pueda publicarlos en canales enterprise.

## COLMENA-SS

Estados soportados:

- `CLEAN`
- `PENDING_SCAN`
- `IN_SCAN`
- `SUSPICIOUS`
- `BANNED`
- `APPEALED`

El usuario puede preparar logs y abrir apelacion, pero no puede marcarse limpio, cerrar escaneos ni borrar evidencias.

## Informes

Desde la pantalla `LOGS`, usar `EXPORTAR INFORME`. El formato generado es:

```text
COLMENA_REPORT_YYYYMMDDHHMM.zip
```

## Rollback

Antes de la integracion se creo backup automatico en:

```text
E:\launcher\backup_colmena_launcher\
```

Para volver atras, cerrar el launcher, copiar el contenido del backup elegido encima de `E:\launcher` y arrancar Electron local.
