# README_FASE3_HARDENING - Colmena WorkSuite

Fecha: 2026-05-01

## Backup

Backup previo Fase 3:

```text
E:\launcher\backup_full_colmena\20260501_001529_p12a29e3
```

## Hardening implementado

### Backend

- API key obligatoria.
- HMAC obligatorio en requests mutables.
- Timestamp obligatorio.
- Proteccion anti-replay por firma reutilizada.
- Ventana maxima de timestamp: 5 minutos.
- Rate limit por IP.
- Rate limit por usuario.
- Auditoria de requests aceptadas, rechazadas, replay, firma invalida y rate limit en `data/backend_audit.json`.
- Validacion estricta de JSON con limite de 256 KB.

### Launcher

- Versionado:
  - launcher: `2.5.0-PRO`
  - backend: `1.1.0-HARDENED`
  - bot: `1.1.0-HARDENED`
- Validacion de integridad SHA-256 de archivos criticos.
- Soporte opcional para `config/integrity-manifest.json`.
- Endpoint/IPC de version check.
- `.env.example` actualizado con variables de version y update URL.

### Discord Bot

- Reconexion automatica con enfriamiento ante error o shard disconnect.
- Cooldowns de botones existentes preservados.
- Validacion de rol staff en acciones staff.
- Logs de acciones staff enviados a backend.

### COLMENA-SS

- Transiciones de estado controladas:
  - `PENDIENTE -> EN ESCANEO`
  - `PENDIENTE -> EN REVISION`
  - `EN ESCANEO -> EN REVISION`
  - `EN ESCANEO/EN REVISION -> FINALIZADO`
- Se bloquean saltos invalidos y acciones sobre casos finalizados.
- Cancelacion de usuario solo antes de iniciar.
- Resultados staff registrados en backend.

### Anticheat

- Heartbeat y eventos firmados hacia backend.
- Simulacion segura desde launcher.
- Flags y riskScore centralizados.

## Pruebas realizadas

- `node --check main.js`
- `node --check renderer.js`
- `node --check preload.js`
- `node --check src/services/*.js`
- Evento firmado aceptado.
- Evento sin firma rechazado con `MISSING_SIGNATURE`.
- Replay de firma rechazado con `REPLAY_SIGNATURE`.
- `/api/status` responde con version `1.1.0-HARDENED`.
- Anticheat event OK.
- SS session OK.
- Log centralizado OK.

## Rollback

Cerrar launcher, restaurar backup:

```text
E:\launcher\backup_full_colmena\20260501_001529_p12a29e3
```
