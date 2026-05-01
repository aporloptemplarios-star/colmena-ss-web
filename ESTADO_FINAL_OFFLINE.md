ESTADO FINAL OFFLINE - Colmena Guardian

Resumen del proyecto
--------------------
Colmena Guardian es un anticheat privado para RedM (VORP Core). Esta versión 1.0.0-offline agrupa todo lo necesario para pruebas locales y staging sin depender de RedM ni de oxmysql.

Módulos terminados
- Detecciones core (honeypots, patterns, anti_bypass, ghost_traps)
- Flags y gestor de acciones (con TestMode protection)
- Alerts (agrupado, cooldowns, persistencia fallback)
- Audit & Review Cases (persistencia DB o fallback JSON)
- Staff commands y registro de acciones
- Dashboard prototipo (backend + frontend)
- Tests offline y mocks (mock_database, mock_dashboard, test_full_flow)

Validaciones realizadas
- Flujo detection -> flags -> alerts -> audit -> cases integrado y probado con 	ests/test_full_flow.lua.
- Protecciones: TestMode evita kicks/bans reales; llamadas destructivas envueltas en checks/pcall.
- Persistencia: en ausencia de oxmysql se guarda en data/colmena_audit.json y mocks permiten tests.

Limitaciones (sin servidor RedM)
- Funciones específicas de runtime (DropPlayer, GetPlayers, RegisterNetEvent) no pueden ejecutarse; el código las detecta y evita ejecuciones destructivas.
- No hay verificación de esquema MySQL real (ejecutar SQL en staging).

Riesgos pendientes
- Falsos positivos por thresholds mal ajustados.
- Integración con webhooks y servicios externos no probada en producción.
- Necesidad de persistencia centralizada (Redis) para stores como locks/prepareStore.

Checklist antes de producción
1. Desplegar en staging con oxmysql y aplicar SQL de sql/.
2. Generar secretos y configurar dashboard/.env (JWT_SECRET, ADMIN user hash) fuera del repo.
3. Validar 24–48h de logs y casos manualmente antes de activar sanciones automáticas.
4. Configurar backups y retención para tablas de audit/alerts.

Confirmación
------------
No hay bans ni kicks activos por defecto. TestMode = true en shared/config.lua protege contra acciones destructivas.
