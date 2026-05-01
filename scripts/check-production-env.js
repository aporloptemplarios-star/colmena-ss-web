const envFile = process.env.ENV_FILE || '.env';
require('dotenv').config({ path: envFile, quiet: true });

const REQUIRED_GROUPS = [
    ['APP_URL', 'COLMENA_PUBLIC_URL'],
    ['JWT_SECRET', 'COLMENA_JWT_SECRET', 'COLMENA_HMAC_SECRET'],
    ['STRIPE_SECRET_KEY'],
    ['STRIPE_WEBHOOK_SECRET'],
    ['DISCORD_BOT_TOKEN', 'DISCORD_TOKEN'],
    ['DISCORD_GUILD_ID'],
    ['DISCORD_OWNER_ID'],
    ['DISCORD_INVITE_CHANNEL_ID']
];

const RECOMMENDED = [
    'DATABASE_URL',
    'SMTP_HOST',
    'SMTP_USER',
    'SMTP_PASS',
    'NEXT_PUBLIC_STRIPE_PUBLIC_KEY',
    'ROLE_CLIENTE_SCANER_ID',
    'ROLE_SERVIDOR_VERIFICADO_ID',
    'ROLE_SIN_VERIFICAR_ID'
];

const isPlaceholder = (value) => /CHANGE_ME|PENDIENTE|DOMINIO_FINAL|localhost|127\.0\.0\.1/i.test(String(value || ''));
const valueOf = (name) => String(process.env[name] || '').trim();
const groupLabel = (group) => group.join(' | ');
const groupValue = (group) => group.map(valueOf).find(Boolean) || '';

const missing = REQUIRED_GROUPS.filter(group => !groupValue(group)).map(groupLabel);
const placeholders = REQUIRED_GROUPS.filter(group => groupValue(group) && isPlaceholder(groupValue(group))).map(groupLabel);
const recommendedMissing = RECOMMENDED.filter(name => !valueOf(name));

const report = {
    ok: missing.length === 0 && placeholders.length === 0,
    requiredMissing: missing,
    placeholders,
    recommendedMissing,
    envFile,
    checkedAt: new Date().toISOString()
};

console.log(JSON.stringify(report, null, 2));

if (!report.ok) {
    console.error('\nColmena no esta listo para produccion: faltan variables obligatorias o hay placeholders.');
    process.exit(1);
}

if (recommendedMissing.length) {
    console.warn('\nAviso: faltan variables recomendadas. Puede funcionar, pero no esta cerrado al 100%.');
}

console.log('\nColmena listo para arrancar en produccion.');
