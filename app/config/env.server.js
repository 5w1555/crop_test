// Minimal env file for the cleaned template
const NODE_ENV = process.env.NODE_ENV || "development";
const SHOPIFY_BILLING_TEST_MODE = process.env.SHOPIFY_BILLING_TEST_MODE === "true";

if (NODE_ENV === "production" && SHOPIFY_BILLING_TEST_MODE) {
  throw new Error("Invalid configuration: SHOPIFY_BILLING_TEST_MODE must be false in production.");
}

export const env = {
  NODE_ENV,
  SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY || "",
  SMARTCROP_API_URL:
    process.env.SMARTCROP_API_URL || "https://smart-crop-api-f97p.onrender.com",
  SHOPIFY_BILLING_TEST_MODE,
};

export function getEnv() {
  return env;
}
