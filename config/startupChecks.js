// ==================================================
// StageLink — startup safety checks
// ==================================================
// The riskiest failures here are not bugs in code paths but unsafe
// configurations that run silently: with no M-Pesa credentials the
// payment simulator is active, and the simulator approves every
// payment. That is correct for development and catastrophic in
// production, so production refuses to start in that state unless
// someone explicitly opts in.
const DEMO_PASSWORD_HASH = '$2b$10$cPuc5tAHqSGe2VNl06DcCeW5eRJGdJQl8gdbXtLU2gV3Z9z./ykWe';
const KNOWN_WEAK_SECRETS = /^(change-this|dev-only|secret|password|changeme)/i;

async function runStartupChecks({ pool, isProduction, mpesa }) {
  const problems = [];
  const warnings = [];

  const secret = process.env.SESSION_SECRET || '';
  if (!secret) {
    problems.push('SESSION_SECRET is not set.');
  } else if (secret.length < 32 || KNOWN_WEAK_SECRETS.test(secret)) {
    (isProduction ? problems : warnings).push(
      'SESSION_SECRET is short or a known placeholder — use 32+ random characters (node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))").'
    );
  }

  if (isProduction) {
    if (!mpesa.isConfigured) {
      if (process.env.ALLOW_PAYMENT_SANDBOX === 'true') {
        warnings.push('ALLOW_PAYMENT_SANDBOX=true: the payment SIMULATOR is active in production — every payment will be auto-approved. Never use this with real customers.');
      } else {
        problems.push('No M-Pesa credentials are configured, so the payment simulator (which approves every payment) would run in production. Configure the MPESA_* variables, or set ALLOW_PAYMENT_SANDBOX=true to knowingly run a demo.');
      }
    } else {
      const secretPath = process.env.MPESA_CALLBACK_SECRET || '';
      if (secretPath.length < 24) {
        problems.push('MPESA_CALLBACK_SECRET must be set (24+ random characters) and included in MPESA_CALLBACK_URL, so the payment webhook cannot be called by anyone who guesses its URL.');
      } else if (!(process.env.MPESA_CALLBACK_URL || '').includes(secretPath)) {
        problems.push('MPESA_CALLBACK_URL must contain MPESA_CALLBACK_SECRET (e.g. https://host/mpesa/callback/<secret>).');
      }
      if (!(process.env.MPESA_CALLBACK_URL || '').startsWith('https://')) {
        problems.push('MPESA_CALLBACK_URL must be https://.');
      }
    }

    if (process.env.TRUST_PROXY === undefined) {
      warnings.push('TRUST_PROXY is not set. Behind a TLS-terminating proxy, secure cookies and client-IP rate limiting need TRUST_PROXY=1 (number of proxy hops).');
    }

    try {
      const [[row]] = await pool.query('SELECT COUNT(*) AS count FROM users WHERE password_hash = ?', [DEMO_PASSWORD_HASH]);
      if (row.count > 0 && process.env.ALLOW_DEMO_ACCOUNTS !== 'true') {
        problems.push(`${row.count} account(s) still use the published demo password (including demo admin/operator logins from database.sql). Remove the demo seed data or rotate them with scripts/set-password.js.`);
      } else if (row.count > 0) {
        warnings.push(`ALLOW_DEMO_ACCOUNTS=true: ${row.count} account(s) use the published demo password.`);
      }
    } catch (error) {
      warnings.push(`Could not check for demo accounts: ${error.message}`);
    }
  }

  return { problems, warnings };
}

module.exports = { runStartupChecks, DEMO_PASSWORD_HASH };
