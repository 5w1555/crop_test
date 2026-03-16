// Minimal env file for the cleaned template
export const env = {
  SMARTCROP_API_URL: process.env.SMARTCROP_API_URL || "https://smart-crop-api-f97p.onrender.com",
};

export function getEnv() {
  return {
    ...env,
    NODE_ENV: process.env.NODE_ENV || "development",
  };
}