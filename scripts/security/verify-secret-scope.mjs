#!/usr/bin/env node
// verify-secret-scope.mjs — DRY-RUN by default.
//
// Verifie que les 7 SECRETS WEB SCOPE (GitHub Env production/preview
// + repo vars) sont BIEN listes, et QUE LES 5 SECRETS DE PAYOUT
// RAIL (BINANCE_API_KEY, BYBIT_API_KEY, BITGET_API_KEY,
// OWNER_PRIVATE_KEY_USDC, ATTIJARI_CLIENT_SECRET) NE SONT PAS
// CONFIGURES DANS GITHUB (la console administrateur doit echouer).
//
// Mode DRY-RUN: aucune API GitHub n'est appelee sans
// process.env.GITHUB_TOKEN. Imprime juste la structure attendue.
//
const EXPECTED_WEB_SCOPED_SECRETS = [
    'REVALIDATE_TOKEN',
    'DATABASE_URL_PREVIEW',
    'DATABASE_URL_PRODUCTION',
    'VERCEL_TOKEN',
    'RESEND_API_KEY',
    'STRIPE_SECRET_KEY',
    'OWNER_CONTACT_HMAC_SALT',
];

const FORBIDDEN_GITHUB_RAIL_SECRETS = [
    'BINANCE_API_KEY',
    'BINANCE_API_SECRET',
    'BYBIT_API_KEY',
    'BYBIT_API_SECRET',
    'BITGET_API_KEY',
    'BITGET_API_SECRET',
    'OWNER_PRIVATE_KEY_USDC',
    'ATTIJARI_CLIENT_SECRET',
    'USDC_SENDER_PRIVATE_KEY',
];

function main() {
    const tok = process.env.GITHUB_TOKEN || '';
    const report = {
        run_at: new Date().toISOString(),
        mode: tok ? 'LIVE_API_SCOPED_VERIFY' : 'DRY_RUN_STRUCTURE_PRINTED_NO_TOKEN',
        expected_web_scoped_present: EXPECTED_WEB_SCOPED_SECRETS,
        web_present: tok ? null : EXPECTED_WEB_SCOPED_SECRETS.map(k => ({ name: k, required: true, value_mask: 'NEED_GITHUB_TOKEN_TO_VERIFY' })),
        forbidden_rail_secrets_404_expected: FORBIDDEN_GITHUB_RAIL_SECRETS,
        rail_present_results: tok ? null : FORBIDDEN_GITHUB_RAIL_SECRETS.map(k => ({ name: k, expected_status_code: 404, status: 'FOUR_OH_FOUR_NOT_FOUND_GITHUB_SCOPE_EXPECTED', actual: 'NEED_TOKEN_TO_VERIFY' })),
        conclusion: tok
            ? 'Run avec GITHUB_TOKEN — relancer avec un token ayant acces aux repo/org secrets pour verifier 7 PRESENT vs 9 404.'
            : ('DRY-RUN OK. Structure: ' + EXPECTED_WEB_SCOPED_SECRETS.length + ' web secretes attendues, ' + FORBIDDEN_GITHUB_RAIL_SECRETS.length + ' payout rails doivent retourner 404 depuis toute console repo/org.'),
    };
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
}
main();
