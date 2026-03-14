import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SHOPIFY_APP_TOML_PATH = path.join(REPO_ROOT, "shopify.app.toml");

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

function parseShopifyApplicationUrl() {
  try {
    const file = fs.readFileSync(SHOPIFY_APP_TOML_PATH, "utf8");
    const match = file.match(/^\s*application_url\s*=\s*"([^"]+)"\s*$/m);
    if (!match) {
      return {
        error: `Could not find "application_url" in ${path.basename(SHOPIFY_APP_TOML_PATH)}.`,
      };
    }

    return { value: match[1] };
  } catch (error) {
    return {
      error: `Unable to read ${SHOPIFY_APP_TOML_PATH}: ${error?.message ?? String(error)}.`,
    };
  }
}

function validateShopifyAppUrlAgainstToml({ errors, warnings }) {
  const envUrl = process.env.SHOPIFY_APP_URL;
  if (!hasValue("SHOPIFY_APP_URL")) return;

  const parsedEnvUrl = new URL(envUrl);
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && parsedEnvUrl.protocol !== "https:") {
    errors.push(`SHOPIFY_APP_URL must use HTTPS in production, got "${envUrl}".`);
  }

  const { value: tomlApplicationUrl, error } = parseShopifyApplicationUrl();
  if (error) {
    warnings.push(
      `[env] ${error} Cannot verify that SHOPIFY_APP_URL matches Shopify Partners application_url.`,
    );
    return;
  }

  let parsedTomlUrl;
  try {
    parsedTomlUrl = new URL(tomlApplicationUrl);
  } catch {
    warnings.push(
      `[env] shopify.app.toml application_url is invalid ("${tomlApplicationUrl}"). Cannot verify SHOPIFY_APP_URL origin.`,
    );
    return;
  }

  if (parsedEnvUrl.origin !== parsedTomlUrl.origin) {
    const mismatchMessage =
      `SHOPIFY_APP_URL origin mismatch: env has "${parsedEnvUrl.origin}" but shopify.app.toml application_url has "${parsedTomlUrl.origin}". ` +
      "This mismatch commonly causes immediate session-expired toasts after OAuth.";

    if (isProduction) {
      errors.push(mismatchMessage);
    } else {
      warnings.push(`[env] ${mismatchMessage}`);
    }
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
  validateShopifyAppUrlAgainstToml({ errors, warnings });

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
