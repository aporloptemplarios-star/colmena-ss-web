document.addEventListener('DOMContentLoaded', () => {
    console.log('[LAUNCHER] Sistema operativo cargado.');

    // --- 1. ELEMENTOS CORE ---
    const loginCard = document.getElementById('login-overlay');
    const licenseOverlay = document.getElementById('license-overlay');
    const mainApp = document.getElementById('app');
    const loginBtn = document.getElementById('btn-login');
    const registerBtn = document.getElementById('btn-register'); // FIX #9
    const closeLogin = document.getElementById('win-close-login');
    const userInput = document.getElementById('login-user');
    const passInput = document.getElementById('login-pass');
    const forgotBtn = document.getElementById('btn-forgot-password');
    const forgotModal = document.getElementById('forgot-modal');
    const forgotClose = document.getElementById('forgot-close');
    const forgotSend = document.getElementById('forgot-send');
    const forgotOpenWeb = document.getElementById('forgot-open-web');
    const forgotEmail = document.getElementById('forgot-email');
    const forgotStatus = document.getElementById('forgot-status');
    let currentLicense = null;

    // --- LOGS (declarado primero para estar disponible en el login) ---
    const botLog = document.getElementById('bot-log');
    const addLogEntry = (msg, status = 'default') => {
        if (!botLog) return;
        const safeStatus = ['default', 'success', 'processing', 'error', 'danger'].includes(status) ? status : 'default';
        const entry = document.createElement('div');
        entry.className = `log-entry ${safeStatus}`;
        const time = document.createElement('span');
        time.className = 'log-time';
        time.textContent = `[${new Date().toLocaleTimeString()}]`;
        const message = document.createElement('span');
        message.className = 'log-msg';
        message.textContent = ` ${msg}`;
        entry.append(time, message);
        botLog.prepend(entry);
        botLog.scrollTop = 0;
    };

    const showLicenseOverlay = (message) => {
        if (loginCard) loginCard.style.display = 'none';
        if (mainApp) mainApp.style.display = 'none';
        if (licenseOverlay) licenseOverlay.style.display = 'flex';
        const statusEl = document.getElementById('license-status');
        if (statusEl && message) statusEl.textContent = message;
    };

    const unlockApplication = (license) => {
        currentLicense = license;
        if (licenseOverlay) licenseOverlay.style.display = 'none';
        if (loginCard) loginCard.style.display = 'none';
        if (mainApp) mainApp.style.display = 'flex';
        applyPlanGates(license);
        addLogEntry(`Licencia activa: ${license.planLabel || license.plan}.`, 'success');
    };

    const applyPlanGates = (license) => {
        const features = license?.features || {};
        const gates = [
            { ids: ['nav-ai-diagnostics'], feature: 'aiBasic' },
            { ids: ['nav-colmena-ss'], feature: 'colmenaSS' },
            { ids: ['nav-security'], feature: 'anticheat' },
            { ids: ['nav-monitoring'], feature: 'dashboard' },
            { ids: ['nav-logs'], feature: 'advancedLogs' },
            { ids: ['btn-export-report'], feature: 'exportReports' },
            { ids: ['btn-anticheat-simulate'], feature: 'anticheatAdvanced' },
            { ids: ['btn-full-diagnostics'], feature: 'aiAdvanced' }
        ];
        gates.forEach(gate => {
            gate.ids.forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                const allowed = Boolean(features[gate.feature]);
                el.classList.toggle('feature-locked', !allowed);
                el.title = allowed ? '' : `Funcion no incluida en plan ${license?.plan || 'sin licencia'}`;
                if (!allowed && el.classList.contains('nav-item') && !el.querySelector('.feature-lock-badge')) {
                    const badge = document.createElement('small');
                    badge.className = 'feature-lock-badge';
                    badge.textContent = 'LOCK';
                    el.appendChild(badge);
                }
            });
        });
    };

    const validateLicenseGate = async () => {
        try {
            const status = await window.electron.licenseStatus();
            if (status.valid && status.license) {
                unlockApplication(status.license);
                return true;
            }
            showLicenseOverlay(status.message || 'Licencia requerida.');
            return false;
        } catch (err) {
            showLicenseOverlay('No se pudo validar la licencia.');
            return false;
        }
    };

    // --- 2. SISTEMA DE LOGIN ---
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const user = userInput.value.trim();
            const pass = passInput.value.trim();
            
            try {
                const response = await window.electron.loginUser(user, pass);
                if (response.success) {
                    addLogEntry(`Sistema desbloqueado. Bienvenido, ${user}.`, 'success');
                    await validateLicenseGate();
                } else {
                    const statusEl = document.getElementById('login-status');
                    if (statusEl) statusEl.innerText = response.message;
                }
            } catch (err) {
                console.error('Login error:', err);
                const statusEl = document.getElementById('login-status');
                if (statusEl) statusEl.innerText = 'Error de conexión con el núcleo.';
            }
        });
    }

    // FIX #9: Handler para el botón de registro (antes no existía, el botón no hacía nada)
    if (registerBtn) {
        registerBtn.addEventListener('click', async () => {
            const user = userInput.value.trim();
            const pass = passInput.value.trim();
            const statusEl = document.getElementById('login-status');

            if (!user || !pass) {
                if (statusEl) statusEl.innerText = 'Introduce un usuario y contraseña para registrar.';
                return;
            }

            try {
                const response = await window.electron.registerUser(user, pass);
                if (statusEl) statusEl.innerText = response.message;
            } catch (err) {
                console.error('Register error:', err);
                if (statusEl) statusEl.innerText = 'Error al registrar usuario.';
            }
        });
    }

    if (closeLogin) {
        closeLogin.addEventListener('click', () => {
            window.electron.closeWindow();
        });
    }

    const recoveryMessage = 'Si el email existe, recibirás instrucciones para recuperar tu contraseña.';
    forgotBtn?.addEventListener('click', () => {
        if (forgotModal) forgotModal.style.display = 'flex';
        if (forgotStatus) forgotStatus.innerText = 'El cambio final se completa desde el enlace seguro de la web.';
        if (forgotEmail && userInput?.value?.includes('@')) forgotEmail.value = userInput.value.trim();
    });
    forgotClose?.addEventListener('click', () => {
        if (forgotModal) forgotModal.style.display = 'none';
    });
    forgotOpenWeb?.addEventListener('click', () => {
        window.electron.openExternal('http://127.0.0.1:3000/forgot-password');
    });
    forgotSend?.addEventListener('click', async () => {
        const email = forgotEmail?.value?.trim();
        if (!email) {
            if (forgotStatus) forgotStatus.innerText = 'Introduce tu email.';
            return;
        }
        if (forgotSend) forgotSend.disabled = true;
        if (forgotStatus) forgotStatus.innerText = 'Enviando solicitud...';
        try {
            const response = await window.electron.forgotPassword(email);
            if (forgotStatus) forgotStatus.innerText = response.message || recoveryMessage;
            addLogEntry('[AUTH] Solicitud de recuperación enviada.', 'success');
        } catch {
            if (forgotStatus) forgotStatus.innerText = recoveryMessage;
        } finally {
            if (forgotSend) forgotSend.disabled = false;
        }
    });

    document.getElementById('btn-license-activate')?.addEventListener('click', async () => {
        const licenseKey = document.getElementById('license-key')?.value.trim();
        const serverId = document.getElementById('license-server-id')?.value.trim();
        const clientName = document.getElementById('license-client-name')?.value.trim();
        const statusEl = document.getElementById('license-status');
        if (!licenseKey) {
            if (statusEl) statusEl.textContent = 'Introduce una license key.';
            return;
        }
        if (statusEl) statusEl.textContent = 'Validando licencia...';
        try {
            const result = await window.electron.activateLicense({ licenseKey, serverId, clientName });
            if (result.success && result.license) {
                if (statusEl) statusEl.textContent = `Licencia activada: ${result.license.planLabel || result.license.plan}`;
                unlockApplication(result.license);
            } else if (statusEl) {
                statusEl.textContent = result.message || result.code || 'Licencia rechazada.';
            }
        } catch (err) {
            if (statusEl) statusEl.textContent = 'Error validando licencia.';
        }
    });

    document.getElementById('btn-license-refresh')?.addEventListener('click', validateLicenseGate);

    // --- 3. GESTIÓN DE LOGS (PANEL 4) - ya declarado arriba ---

    const loadServerInfo = async () => {
        try {
            const info = await window.electron.getServerInfo();
            const serverEl = document.getElementById('info-server-id');
            if (serverEl) serverEl.textContent = info.serverId;
            addLogEntry(`IA activa: ${info.aiProvider} / ${info.aiModel}`, info.aiProvider === 'Sin IA' ? 'error' : 'success');
        } catch (err) {
            addLogEntry('No se pudo cargar la informacion del servidor.', 'error');
        }
    };

    const loadDetections = async () => {
        const tbody = document.getElementById('detections-body');
        if (!tbody) return;
        try {
            const detections = await window.electron.getDetections();
            tbody.replaceChildren();
            if (!detections.length) {
                const row = document.createElement('tr');
                const cell = document.createElement('td');
                cell.colSpan = 5;
                cell.textContent = 'Sin detecciones recientes.';
                row.appendChild(cell);
                tbody.appendChild(row);
                return;
            }

            detections.slice(0, 10).forEach(detection => {
                const row = document.createElement('tr');
                ['timestamp', 'severity', 'alertId', 'eventType', 'process'].forEach(key => {
                    const cell = document.createElement('td');
                    if (key === 'process' && (detection.pid || detection.rule)) {
                        cell.textContent = `${detection.process || '-'}${detection.pid ? ` | PID ${detection.pid}` : ''}${detection.rule ? ` | ${detection.rule}` : ''}`;
                    } else {
                        cell.textContent = detection[key] || '-';
                    }
                    row.appendChild(cell);
                });
                tbody.appendChild(row);
            });
        } catch (err) {
            addLogEntry('No se pudo cargar la auditoria local.', 'error');
        }
    };

    const renderHealth = (health) => {
        const grid = document.getElementById('health-grid');
        const latest = document.getElementById('health-latest-event');
        if (!grid) return;

        grid.replaceChildren();
        health.services.forEach(service => {
            const item = document.createElement('div');
            item.className = `health-card ${service.status}`;
            const name = document.createElement('div');
            name.className = 'health-name';
            name.textContent = service.name;
            const status = document.createElement('div');
            status.className = 'health-status';
            status.textContent = service.status.toUpperCase();
            const detail = document.createElement('div');
            detail.className = 'health-detail';
            detail.textContent = service.detail || '-';
            item.append(name, status, detail);
            grid.appendChild(item);
        });

        if (latest) {
            const event = health.latestAudit;
            const systemEvent = health.latestSystemEvent;
            const auditLine = event
                ? `AUDIT ${event.timestamp} | ${event.alertId} | ${event.eventType} | ${event.process} | ${event.source || '-'}`
                : 'AUDIT Sin datos.';
            const systemLine = systemEvent
                ? `SISTEMA ${systemEvent.timestamp} | ${systemEvent.type}`
                : 'SISTEMA Sin datos.';
            latest.textContent = `${auditLine}\n${systemLine}`;
        }
    };

    const loadHealth = async () => {
        try {
            const health = await window.electron.getHealth();
            renderHealth(health);
        } catch (err) {
            addLogEntry('No se pudo cargar la salud del sistema.', 'error');
        }
    };

    loadServerInfo();
    loadDetections();
    loadHealth();
    setInterval(loadDetections, 15000);
    setInterval(loadHealth, 15000);

    // --- 4. COMANDOS IA (PANEL 3) ---
    const chatInput = document.getElementById('chat-input');
    const pcSupportBtn = document.getElementById('btn-pc-support');
    if (chatInput) {
        chatInput.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                const query = chatInput.value.trim();
                if (!query) return;
                
                chatInput.value = '';
                addLogEntry(`ORDEN: ${query}`, 'processing');
                
                try {
                    const response = await window.electron.askAI(query);
                    const provider = response.provider ? ` (${response.provider})` : '';
                    addLogEntry(`IA GUARDIAN${provider}: ${response.message}`, 'success');
                    if (response.action === 'start-cleaner') {
                        const preview = await window.electron.runCleaner({ confirmed: false });
                        addLogEntry(preview.message || 'Limpieza segura preparada. Requiere confirmacion manual.', 'processing');
                    }
                } catch (err) {
                    addLogEntry(`Error en el núcleo de IA.`, 'error');
                }
            }
        });
    }

    if (pcSupportBtn) {
        pcSupportBtn.addEventListener('click', async () => {
            pcSupportBtn.disabled = true;
            addLogEntry('SOPORTE PC: analizando estado del equipo con IA...', 'processing');
            try {
                const response = await window.electron.runPcSupport();
                if (!response.success) {
                    addLogEntry(`SOPORTE PC: ${response.message}`, 'error');
                    return;
                }
                const provider = response.provider ? ` (${response.provider})` : '';
                addLogEntry(`SOPORTE PC${provider}: ${response.message}`, 'success');
            } catch (err) {
                addLogEntry('SOPORTE PC: error al conectar con el nucleo IA.', 'error');
            } finally {
                pcSupportBtn.disabled = false;
            }
        });
    }

    // --- 5. SISTEMA DE PESTAÑAS ---
    const navHome = document.getElementById('nav-home');
    const navPlay = document.getElementById('nav-play');
    const navSecurity = document.getElementById('nav-security');
    const navMonitoring = document.getElementById('nav-monitoring');
    const navAiDiagnostics = document.getElementById('nav-ai-diagnostics');
    const navRepair = document.getElementById('nav-repair');
    const navColmenaSS = document.getElementById('nav-colmena-ss');
    const navDiscordBot = document.getElementById('nav-discord-bot');
    const navLogs = document.getElementById('nav-logs');
    const navSettings = document.getElementById('nav-settings');
    const navSupport = document.getElementById('nav-support');
    const viewHome = document.getElementById('view-home');
    const viewPlay = document.getElementById('view-play');
    const viewSecurity = document.getElementById('view-security');
    const viewMonitoring = document.getElementById('view-monitoring');
    const viewAiDiagnostics = document.getElementById('view-ai-diagnostics');
    const viewRepair = document.getElementById('view-repair');
    const viewColmenaSS = document.getElementById('view-colmena-ss');
    const viewDiscordBot = document.getElementById('view-discord-bot');
    const viewLogs = document.getElementById('view-logs');
    const viewSettings = document.getElementById('view-settings');
    const viewSupport = document.getElementById('view-support');
    const enterpriseViews = [viewHome, viewPlay, viewSecurity, viewMonitoring, viewAiDiagnostics, viewRepair, viewColmenaSS, viewDiscordBot, viewLogs, viewSettings, viewSupport].filter(Boolean);
    const enterpriseNavs = [navHome, navPlay, navSecurity, navMonitoring, navAiDiagnostics, navRepair, navColmenaSS, navDiscordBot, navLogs, navSettings, navSupport].filter(Boolean);

    const switchView = (targetView, activeNav) => {
        if (!targetView || !activeNav) return;
        enterpriseViews.forEach(v => v.classList.remove('active'));
        enterpriseNavs.forEach(n => n.classList.remove('active'));
        targetView.classList.add('active');
        activeNav.classList.add('active');
    };

    if (navHome) navHome.addEventListener('click', () => switchView(viewHome, navHome));
    if (navPlay) navPlay.addEventListener('click', () => { switchView(viewPlay, navPlay); loadEnterpriseStatus(); });
    if (navSecurity) navSecurity.addEventListener('click', () => { switchView(viewSecurity, navSecurity); loadEnterpriseStatus(); });
    if (navMonitoring) navMonitoring.addEventListener('click', () => switchView(viewMonitoring, navMonitoring));
    if (navAiDiagnostics) navAiDiagnostics.addEventListener('click', () => switchView(viewAiDiagnostics, navAiDiagnostics));
    if (navRepair) navRepair.addEventListener('click', () => switchView(viewRepair, navRepair));
    if (navColmenaSS) navColmenaSS.addEventListener('click', () => { switchView(viewColmenaSS, navColmenaSS); loadEnterpriseStatus(); });
    if (navDiscordBot) navDiscordBot.addEventListener('click', () => switchView(viewDiscordBot, navDiscordBot));
    if (navLogs) navLogs.addEventListener('click', () => { switchView(viewLogs, navLogs); loadEnterpriseLogs(); });
    if (navSettings) navSettings.addEventListener('click', () => {
        switchView(viewSettings, navSettings);
        loadHealth();
    });
    if (navSupport) navSupport.addEventListener('click', () => switchView(viewSupport, navSupport));

    // --- 6. TELEMETRÍA Y EVENTOS ---
    if (window.electron && window.electron.on) {
        // FIX #7: Listener para status:update — antes nunca existía y los indicadores de estado nunca cambiaban
        window.electron.on('status:update', ({ id, state }) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.remove('online', 'offline', 'warning', 'pending');
            el.classList.add(['online', 'offline', 'warning', 'pending'].includes(state) ? state : 'offline');
        });

        window.electron.on('bot:new-action', (data) => {
            addLogEntry(data.message, data.status);
        });
        
        window.electron.on('scanner:detection', (data) => {
            addLogEntry(`DETECCION CRITICA: ${data.process} (Tipo: ${data.type})`, 'danger');
            loadDetections();
            loadHealth();
        });

        window.electron.on('stats:update', (data) => {
            const setFullGauge = (id, valId, value) => {
                const circle = document.getElementById(id);
                const text = document.getElementById(valId);
                if (circle && text) {
                    const offset = 282.7 - (282.7 * value) / 100;
                    circle.style.strokeDashoffset = offset;
                    text.innerText = `${value}%`;
                }
            };
            setFullGauge('f-gauge-cpu', 'f-val-cpu', data.cpu);
            setFullGauge('f-gauge-gpu', 'f-val-gpu', data.gpu);
            setFullGauge('f-gauge-ram', 'f-val-ram', data.ram);

            if (document.getElementById('f-val-ping')) document.getElementById('f-val-ping').innerText = `${data.ping} ms`;
            if (document.getElementById('f-val-down')) document.getElementById('f-val-down').innerText = `${data.netDown} MB/s`;
            if (document.getElementById('f-val-up')) document.getElementById('f-val-up').innerText = `${data.netUp} MB/s`;

            // FIX #10: Render dinámico de discos (antes nunca se renderizaban, el panel estaba siempre vacío)
            const diskList = document.getElementById('f-disk-list');
            if (diskList && data.disks && data.disks.length > 0) {
                diskList.innerHTML = data.disks.map(d => `
                    <div class="disk-row">
                        <div class="disk-label">${d.fs}</div>
                        <div class="disk-bar-wrap">
                            <div class="disk-bar-fill" style="width:${d.used}%"></div>
                        </div>
                        <div class="disk-info">${d.used}% — ${d.available} GB libres / ${d.size} GB</div>
                    </div>
                `).join('');
            }
        });

        window.electron.on('dashboard:update', (stats) => {
            const usersEl = document.getElementById('stat-total-users');
            const onlineEl = document.getElementById('stat-online-users');
            const alertsEl = document.getElementById('stat-total-alerts');
            const sessionsEl = document.getElementById('stat-active-sessions');

            if (usersEl) usersEl.innerText = stats.totalMembers;
            if (onlineEl) onlineEl.innerText = stats.onlineMembers;
            if (alertsEl) alertsEl.innerText = stats.totalAlerts;
            if (sessionsEl) sessionsEl.innerText = stats.activeSessions;
        });
    }

    const adminTargetInput = document.getElementById('admin-target-id');
    const refreshHealthBtn = document.getElementById('btn-refresh-health');
    const restartDiscordBtn = document.getElementById('btn-restart-discord');
    const retryQueueBtn = document.getElementById('btn-retry-queue');
    const fullDiagnosticsBtn = document.getElementById('btn-full-diagnostics');
    const simulateAlertBtn = document.getElementById('btn-simulate-alert');
    document.querySelector('.adm-btn.ban')?.addEventListener('click', () => runAdminAction('ban'));
    document.querySelector('.adm-btn.kick')?.addEventListener('click', () => runAdminAction('kick'));
    document.querySelector('.adm-btn.warn')?.addEventListener('click', () => runAdminAction('warn'));

    function runAdminAction(type) {
        const targetId = adminTargetInput?.value.trim();
        if (!targetId || !/^\d{15,20}$/.test(targetId)) {
            addLogEntry('Introduce una ID de Discord valida antes de ejecutar la accion.', 'error');
            return;
        }
        window.electron.adminAction(type, targetId);
        addLogEntry(`Accion admin enviada: ${type.toUpperCase()} -> ${targetId}`, 'processing');
    }

    refreshHealthBtn?.addEventListener('click', () => {
        loadHealth();
        addLogEntry('Salud del sistema refrescada.', 'success');
    });

    restartDiscordBtn?.addEventListener('click', async () => {
        restartDiscordBtn.disabled = true;
        addLogEntry('DISCORD: solicitando reconexion del bot...', 'processing');
        try {
            const result = await window.electron.restartDiscord();
            addLogEntry(result.success ? 'DISCORD: reconexion solicitada.' : `DISCORD: ${result.message}`, result.success ? 'success' : 'error');
            setTimeout(loadHealth, 2500);
        } catch (err) {
            addLogEntry('DISCORD: error solicitando reconexion.', 'error');
        } finally {
            restartDiscordBtn.disabled = false;
        }
    });

    retryQueueBtn?.addEventListener('click', async () => {
        retryQueueBtn.disabled = true;
        addLogEntry('QUEUE: reintentando entregas pendientes...', 'processing');
        try {
            const result = await window.electron.retryQueue();
            if (result.success) {
                addLogEntry(`QUEUE: reintento completado. Pendientes: ${result.pending}`, result.pending ? 'processing' : 'success');
                loadHealth();
            } else {
                addLogEntry(`QUEUE: error (${result.message}).`, 'error');
            }
        } catch (err) {
            addLogEntry('QUEUE: error ejecutando reintento manual.', 'error');
        } finally {
            retryQueueBtn.disabled = false;
        }
    });

    fullDiagnosticsBtn?.addEventListener('click', async () => {
        fullDiagnosticsBtn.disabled = true;
        addLogEntry('DIAGNOSTICO: generando informe enterprise...', 'processing');
        try {
            const result = await window.electron.fullDiagnostics();
            if (result.success) {
                addLogEntry(`DIAGNOSTICO: informe generado en ${result.reportPath}`, 'success');
                loadHealth();
            } else {
                addLogEntry(`DIAGNOSTICO: error (${result.message}).`, 'error');
            }
        } catch (err) {
            addLogEntry('DIAGNOSTICO: error generando informe.', 'error');
        } finally {
            fullDiagnosticsBtn.disabled = false;
        }
    });

    simulateAlertBtn?.addEventListener('click', async () => {
        simulateAlertBtn.disabled = true;
        addLogEntry('TEST: simulando alerta neural segura...', 'processing');
        try {
            const result = await window.electron.simulateAlert();
            if (result.success) {
                addLogEntry(`TEST: enlace neural OK (${result.alertId}).`, 'success');
                loadDetections();
                loadHealth();
            } else {
                addLogEntry(`TEST: fallo en simulacion (${result.message}).`, 'error');
            }
        } catch (err) {
            addLogEntry('TEST: error ejecutando simulacion neural.', 'error');
        } finally {
            simulateAlertBtn.disabled = false;
        }
    });

    function setJsonOutput(id, data) {
        const el = document.getElementById(id);
        if (el) el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    }

    function requireFeature(feature, label) {
        if (currentLicense?.features?.[feature]) return true;
        addLogEntry(`${label || 'Funcion'} bloqueada por plan ${currentLicense?.plan || 'sin licencia'}.`, 'error');
        return false;
    }

    async function loadEnterpriseStatus() {
        if (!window.electron?.enterpriseStatus) return;
        try {
            const status = await window.electron.enterpriseStatus();
            const grid = document.getElementById('security-status-grid');
            if (grid) {
                const cards = [
                    ['Backend', status.backend?.configured ? 'CONFIGURADO' : 'OFFLINE', status.backend?.queue ? 'warning' : 'ok'],
                    ['Discord Sync', status.discord?.discordId || 'LOCAL', 'ok'],
                    ['Anticheat', status.anticheat?.status || 'OFFLINE', status.anticheat?.canStartGame ? 'ok' : 'danger'],
                    ['IA', status.ai?.provider || 'offline', status.ai?.provider === 'offline' ? 'danger' : 'ok'],
                    ['Risk Score', status.anticheat?.riskScore ?? 0, 'ok'],
                    ['COLMENA-SS', status.colmenaSS?.status || 'CLEAN', status.colmenaSS?.pendingReview ? 'warning' : 'ok']
                ];
                grid.innerHTML = cards.map(([label, value, tone]) => `<div class="enterprise-card ${tone}"><span>${label}</span><strong>${value}</strong></div>`).join('');
            }
            const playState = document.getElementById('play-anticheat-state');
            const playBlock = document.getElementById('play-block-reason');
            if (playState) playState.textContent = status.anticheat?.status || '--';
            if (playBlock) playBlock.textContent = status.anticheat?.blockReason || 'OK';
            const ssState = document.getElementById('ss-state');
            const ssReview = document.getElementById('ss-review');
            const ssInstructions = document.getElementById('ss-instructions');
            if (ssState) ssState.textContent = status.colmenaSS?.status || '--';
            if (ssReview) ssReview.textContent = status.colmenaSS?.pendingReview ? 'SI' : 'NO';
            if (ssInstructions) ssInstructions.textContent = status.colmenaSS?.instructions || 'Sin instrucciones activas.';
            renderEnterpriseLogs(status.logs || []);
        } catch (err) {
            addLogEntry('ENTERPRISE: error cargando estado.', 'error');
        }
    }

    function renderEnterpriseLogs(logs) {
        const list = document.getElementById('enterprise-log-list');
        if (!list) return;
        list.innerHTML = (logs || []).map(log => `<div class="log-entry ${log.severity === 'critical' ? 'danger' : log.severity}">[${new Date(log.timestamp).toLocaleTimeString()}] ${log.eventType}: ${log.message}</div>`).join('') || '<div class="log-entry">Sin logs enterprise.</div>';
    }

    async function loadEnterpriseLogs() {
        const status = await window.electron.enterpriseStatus();
        renderEnterpriseLogs(status.logs || []);
    }

    document.getElementById('btn-security-refresh')?.addEventListener('click', loadEnterpriseStatus);
    document.getElementById('btn-security-report')?.addEventListener('click', async () => {
        if (!requireFeature('advancedLogs', 'Reporte de seguridad')) return;
        const result = await window.electron.enterpriseSendEvent({ eventType: 'support_report', severity: 'warning', message: 'Reporte manual enviado desde panel de seguridad', metadata: { source: 'security-panel' } });
        addLogEntry(result.success ? 'Reporte enviado al backend.' : 'Backend no disponible: reporte en cola offline.', result.success ? 'success' : 'processing');
        loadEnterpriseStatus();
    });
    document.getElementById('btn-anticheat-heartbeat')?.addEventListener('click', async () => {
        if (!requireFeature('anticheat', 'Anticheat heartbeat')) return;
        setJsonOutput('play-output', await window.electron.enterpriseAnticheatHeartbeat());
        loadEnterpriseStatus();
    });
    document.getElementById('btn-anticheat-start')?.addEventListener('click', async () => {
        if (!requireFeature('anticheat', 'Anticheat')) return;
        setJsonOutput('play-output', await window.electron.enterpriseAnticheatStart());
        loadEnterpriseStatus();
    });
    document.getElementById('btn-guard-game')?.addEventListener('click', async () => {
        setJsonOutput('play-output', await window.electron.enterpriseGuardGameStart());
        loadEnterpriseStatus();
    });
    document.getElementById('btn-anticheat-simulate')?.addEventListener('click', async () => {
        if (!requireFeature('anticheatAdvanced', 'Simulacion anticheat')) return;
        const result = await window.electron.enterpriseAnticheatSimulateEvent();
        addLogEntry(result.success ? 'ANTICHEAT: flag simulado enviado al backend.' : 'ANTICHEAT: backend no disponible, evento en cola.', result.success ? 'success' : 'processing');
        loadEnterpriseStatus();
    });

    document.querySelectorAll('.ai-action').forEach(btn => btn.addEventListener('click', async () => {
        const type = btn.dataset.aiType || 'launcher';
        if (!requireFeature(type === 'pc' ? 'aiBasic' : 'aiAdvanced', 'Diagnostico IA')) return;
        setJsonOutput('ai-diagnostics-output', 'Analizando...');
        const result = await window.electron.enterpriseAnalyze(type, { requestedAt: new Date().toISOString() });
        setJsonOutput('ai-diagnostics-output', result);
        loadEnterpriseStatus();
    }));
    document.getElementById('btn-ai-send-support')?.addEventListener('click', async () => {
        setJsonOutput('ai-diagnostics-output', await window.electron.enterpriseDiscordTicket('ai_diagnosis_critical'));
    });

    document.getElementById('btn-repair-inspect')?.addEventListener('click', async () => {
        setJsonOutput('repair-output', await window.electron.enterpriseRepairInspect());
    });
    document.getElementById('btn-repair-preview-clean')?.addEventListener('click', async () => {
        setJsonOutput('repair-output', await window.electron.enterpriseRepairPreviewClean());
    });

    document.getElementById('btn-ss-prepare-logs')?.addEventListener('click', async () => {
        if (!requireFeature('colmenaSS', 'COLMENA-SS')) return;
        setJsonOutput('ss-instructions', await window.electron.enterpriseSSPrepareLogs());
        loadEnterpriseStatus();
    });
    document.getElementById('btn-ss-appeal')?.addEventListener('click', async () => {
        if (!requireFeature('colmenaSS', 'Apelacion COLMENA-SS')) return;
        setJsonOutput('ss-instructions', await window.electron.enterpriseDiscordTicket('scan_appeal'));
    });
    document.getElementById('btn-ss-rules')?.addEventListener('click', () => {
        setJsonOutput('ss-instructions', 'Normas COLMENA-SS:\\n1. Entra a la sala indicada por staff.\\n2. Comparte pantalla si se solicita.\\n3. No publiques datos personales.\\n4. No cierres el launcher durante la revision.\\n5. El usuario no puede cerrar ni borrar evidencias.');
    });

    document.getElementById('btn-discord-reconnect-2')?.addEventListener('click', async () => {
        setJsonOutput('discord-output', await window.electron.restartDiscord());
    });
    document.getElementById('btn-discord-test-event')?.addEventListener('click', async () => {
        setJsonOutput('discord-output', await window.electron.enterpriseSendEvent({ eventType: 'launcher_error', severity: 'warning', message: 'Evento de prueba Discord/Backend desde launcher', metadata: { target: 'discord-bot' } }));
    });
    document.getElementById('btn-logs-refresh')?.addEventListener('click', loadEnterpriseLogs);
    document.getElementById('btn-export-report')?.addEventListener('click', async () => {
        if (!requireFeature('exportReports', 'Exportacion de informe')) return;
        const result = await window.electron.enterpriseExportReport();
        addLogEntry(result.success ? `Informe exportado: ${result.reportPath}` : 'Error exportando informe.', result.success ? 'success' : 'error');
        loadEnterpriseLogs();
    });
    document.getElementById('btn-logs-support')?.addEventListener('click', async () => {
        await window.electron.enterpriseDiscordTicket('support_report');
        addLogEntry('Reporte de logs enviado a soporte/backend.', 'success');
    });
    document.getElementById('btn-support-ticket')?.addEventListener('click', async () => {
        setJsonOutput('support-output', await window.electron.enterpriseDiscordTicket('support_report'));
    });
    document.getElementById('btn-support-pc-2')?.addEventListener('click', async () => {
        setJsonOutput('support-output', await window.electron.runPcSupport());
    });

    // --- 7. CONTROL DE VENTANA ---
    document.getElementById('win-min')?.addEventListener('click', () => window.electron.minimizeWindow());
    document.getElementById('win-max')?.addEventListener('click', () => window.electron.maximizeWindow());
    document.getElementById('win-close')?.addEventListener('click', () => window.electron.closeWindow());
    document.getElementById('win-close-login')?.addEventListener('click', () => window.electron.closeWindow());
});
