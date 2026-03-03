import process from "node:process";

const REQUIRED_ENV_VARS = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SCOPES",
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "SMARTCROP_API_URL",
];

const OPTIONAL_RECOMMENDED_ENV_VARS = [
  "SHOPIFY_BILLING_TEST_MODE",
  "PAID_PLAN_SHOPS",
  "SMARTCROP_API_TOKEN",
];

function hasValue(name) {
  return Boolean(process.env[name] && String(process.env[name]).trim());
}

function validateUrlEnvVar(name, errors) {
  const value = process.env[name];
  if (!value) return;

  try {
    const parsed = new URL(value);
    if (!parsed.protocol.startsWith("http")) {
      errors.push(`${name} must use an http/https URL, got "${value}".`);
    }
  } catch {
    errors.push(`${name} must be a valid URL, got "${value}".`);
  }
}

function validateBooleanEnvVar(name, errors) {
  if (!hasValue(name)) return;
  const normalized = String(process.env[name]).trim().toLowerCase();
  if (!["true", "false", "1", "0", "yes", "no", "on", "off"].includes(normalized)) {
    errors.push(
      `${name} must be a boolean-like value (true/false/1/0/yes/no/on/off), got "${process.env[name]}".`,
    );
  }
}

export function validateServerEnv() {
  const errors = [];
  const warnings = [];

  for (const name of REQUIRED_ENV_VARS) {
    if (!hasValue(name)) {
      errors.push(`${name} is required.`);
    }
  }

  if (hasValue("SCOPES")) {
    const scopes = String(process.env.SCOPES)
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);

    if (scopes.length === 0) {
      errors.push("SCOPES must contain at least one comma-separated scope.");
    }
  }

  validateUrlEnvVar("SHOPIFY_APP_URL", errors);
  validateUrlEnvVar("SMARTCROP_API_URL", errors);
  validateBooleanEnvVar("SHOPIFY_BILLING_TEST_MODE", errors);

  for (const name of OPTIONAL_RECOMMENDED_ENV_VARS) {
    if (!hasValue(name)) {
      warnings.push(`${name} is not set (recommended).`);
    }
  }

  if (warnings.length > 0) {
    console.warn(`[env] Recommended environment variables missing:\n- ${warnings.join("\n- ")}`);
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid server environment configuration:\n- ${errors.join("\n- ")}\n` +
        "Fix environment variables before starting the Node server.",
    );
  }
}

validateServerEnv();
