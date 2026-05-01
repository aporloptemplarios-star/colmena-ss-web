# Cambios Enterprise

- Backup automatico previo en `backup_colmena_launcher`.
- Nuevos servicios en `src/services`.
- Configuracion segura en `config/colmena.config.json`.
- IPC enterprise para backend, IA, reparacion, anticheat, COLMENA-SS, Discord Sync y reportes.
- Nuevas pantallas del launcher: Jugar, Seguridad, Diagnostico IA, Reparacion PC, COLMENA-SS, Discord Bot, Logs y Soporte.
- Cola offline backend con reintento y firma HMAC.
- Exportador de informe tecnico.
- Auditoria WorkSuite en `docs/AUDITORIA_WORKSUITE.md`.
- Consentimiento explicito antes de crear tickets COLMENA-SS.
- Limpieza local legacy convertida a modo seguro sin borrado por defecto.
- Paquete final saneado para no incluir `.env`, `data` ni `logs` locales.

## Archivos modificados

- `main.js`
- `preload.js`
- `renderer.js`
- `index.html`
- `index.css`

## Archivos nuevos

- `config/colmena.config.json`
- `src/services/logService.js`
- `src/services/backendClient.js`
- `src/services/aiAssistantService.js`
- `src/services/repairService.js`
- `src/services/anticheatBridge.js`
- `src/services/colmenaSSService.js`
- `src/services/discordSyncService.js`
- `README_INSTALACION.md`
- `README_PRODUCCION.md`
- `docs/AUDITORIA_WORKSUITE.md`
