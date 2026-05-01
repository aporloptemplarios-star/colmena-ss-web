class AiAssistantService {
    constructor(options = {}) {
        this.askAI = options.askAI;
        this.backendClient = options.backendClient;
        this.logService = options.logService;
    }

    async analyze(type, payload = {}) {
        const prompt = [
            'Actua como analizador tecnico COLMENA-SS para launcher gaming enterprise.',
            'Devuelve un JSON con severity, summary, probableCause, recommendedFix, safeSteps y shouldNotifyStaff.',
            `Tipo: ${type}`,
            `Datos: ${JSON.stringify(payload).slice(0, 12000)}`
        ].join('\n');
        try {
            const response = this.askAI ? await this.askAI(prompt) : null;
            const text = response?.message || response || '';
            const parsed = this.extractJson(text) || {
                severity: text.toLowerCase().includes('crit') ? 'critical' : 'medium',
                summary: text.slice(0, 500) || 'Analisis local generado sin proveedor IA remoto.',
                probableCause: 'Revisar logs adjuntos y conectividad.',
                recommendedFix: 'Aplicar pasos seguros y reenviar informe si persiste.',
                safeSteps: ['Reiniciar launcher', 'Comprobar conexion', 'Ejecutar diagnostico', 'Enviar reporte a soporte'],
                shouldNotifyStaff: text.toLowerCase().includes('critical')
            };
            this.logService?.record('ai_analysis', parsed.summary, { severity: parsed.severity, metadata: { type } });
            if (parsed.shouldNotifyStaff) {
                await this.backendClient?.sendEvent({
                    eventType: 'ai_diagnosis_critical',
                    severity: 'critical',
                    message: parsed.summary,
                    metadata: { type, parsed }
                });
            }
            return { success: true, analysis: parsed };
        } catch (err) {
            this.logService?.record('IA_ANALYSIS_FAILED', err.message, { severity: 'critical', metadata: { type } });
            return { success: false, code: 'IA_ANALYSIS_FAILED', message: err.message };
        }
    }

    extractJson(text) {
        try {
            const match = String(text).match(/\{[\s\S]*\}/);
            return match ? JSON.parse(match[0]) : null;
        } catch {
            return null;
        }
    }
}

module.exports = AiAssistantService;
