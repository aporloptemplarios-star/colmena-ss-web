# Auditoria Colmena WorkSuite

Fecha: 2026-04-30

## A. Que esta bien

- Launcher Electron existente abre con runtime local y no depende del npm global roto.
- Hay separacion basica `main.js`, `preload.js`, `renderer.js`, `index.html`, `index.css`.
- Discord Bot usa `discord.js` v14 y ya incluye reconexion en modo limitado si Discord bloquea intents privilegiados.
- Existe rebuild enterprise `COLMENA CORE Diamond` con roles, categorias, canales, permisos, botones y logs.
- COLMENA-SS ya tiene flujo de botones, tickets privados, roles, staff validation, estados, logs y resultados.
- Existe integracion IA con OpenAI/Gemini fallback.
- Se añadieron servicios modulares en `src/services` para logs, backend, IA, reparacion, anticheat, COLMENA-SS y Discord Sync.
- Backend client firma eventos con HMAC, usa API key, timeout, cola offline y rate limit.
- UI ya tiene paneles nuevos para Jugar, Seguridad, Diagnostico IA, Reparacion PC, COLMENA-SS, Discord Bot, Logs y Soporte.
- Se crearon backups y paquete final sin `.env`.

## B. Que esta mal

- El flujo de solicitud de escaneo creaba ticket directamente sin una aceptacion explicita separada del usuario.
- El limpiador legacy podia borrar caches/logs de FiveM/RedM y vaciar la papelera sin confirmacion adicional.
- El paquete final incluia datos locales y logs de desarrollo dentro de `launcher/data` y `launcher/logs`.
- El backend local Express todavia expone principalmente `/alert`; los endpoints enterprise esperados estan representados en cliente, pero no todos implementados como servidor receptor.
- Hay comandos legacy destructivos o amplios (`!clean`, rebuilds antiguos, setup enterprise antiguo) que requieren uso cuidadoso por admins.
- Persistencia de estados COLMENA-SS del bot es en memoria; tras reinicio se pierde la cola activa.

## C. Que falta

- Backend central real con base de datos, endpoints completos y auditoria persistente.
- Persistencia segura de sesiones COLMENA-SS y evidencias.
- Sistema de consentimiento versionado con texto legal configurable por cliente.
- Reporte final por servidor cliente con envio automatizado.
- Panel staff web/backend para varios servidores cliente.
- Integracion real de anticheat externo si existe binario/servicio dedicado.
- Tests end-to-end contra un servidor Discord de staging.

## D. Que sobra

- Datos locales/logs dentro del paquete de entrega.
- Scripts scratch en release si no son necesarios.
- Comandos legacy de setup que pueden duplicar estructuras si se usan fuera del flujo Diamond.

## E. Que no se debe tocar

- `.env` local con secretos.
- `DISCORD_TOKEN`, claves OpenAI/Gemini/Echo y webhooks.
- `Abrir Colmena Guardian.bat` y arranque por Electron local.
- IDs/canales/roles ya creados en Discord salvo rebuild confirmado.
- Funciones existentes de login, dashboard, soporte PC, IA y telemetria.

## F. Riesgos criticos

- Ejecutar rebuild en servidor equivocado puede borrar canales/roles no protegidos.
- Permisos insuficientes del bot pueden dejar la reconstruccion incompleta.
- Escaneos sin consentimiento explicito pueden crear problemas de privacidad.
- Borrado local sin confirmacion puede eliminar datos utiles de diagnostico.
- Backend sin TLS/HMAC validado en servidor permitiria eventos falsificados.
- IA no debe decidir sanciones; solo recomienda.

## G. Prioridad de trabajo

Critico:
- Consentimiento explicito antes de crear caso COLMENA-SS.
- Bloquear limpieza destructiva sin confirmacion.
- Sanear paquete final para no incluir datos/logs locales.

Alto:
- Persistencia de estados de escaneo.
- Backend real completo con endpoints esperados.
- Reporte final para cliente y archivo de evidencias.

Medio:
- Tests Discord staging.
- Mejoras de UX y estados visuales.
- Plantillas de consentimiento por servidor cliente.

Bajo:
- Limpieza de comandos legacy.
- Refinar empaquetado y scripts de release.
