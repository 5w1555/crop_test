const AUTH_ISSUE_MESSAGE =
  "Authentication expired or access is denied. Refresh the app and try again.";
const AUTH_REDIRECT_MESSAGE =
  "Request was redirected to a login page. Verify your app/auth URL configuration and try again.";
const SERVER_ERROR_MESSAGE =
  "The server encountered an error while processing your crop request. Please try again shortly.";
const EDGE_TIMEOUT_MESSAGE =
  "The crop service timed out before returning a result (HTTP 524). Please retry with fewer/smaller images, or try again shortly.";

export async function buildResponseDiagnostics(response) {
  const contentType = response.headers.get("content-type") || "";
  let textSnippet = "";
  try {
    const text = await response.clone().text();
    textSnippet = text.replace(/\s+/g, " ").trim().slice(0, 240);
  } catch {
    textSnippet = "";
  }
  return { status: response.status, redirected: response.redirected, url: response.url, contentType, textSnippet };
}

function isLikelyAuthRedirect(diagnostics) {
  const lowerContentType = String(diagnostics?.contentType || "").toLowerCase();
  const lowerUrl = String(diagnostics?.url || "").toLowerCase();
  const lowerSnippet = String(diagnostics?.textSnippet || "").toLowerCase();
  const isRedirectStatus = [301, 302, 303, 307, 308].includes(diagnostics?.status);
  const hasAuthPathSignal = lowerUrl.includes("/login") || lowerUrl.includes("/auth");
  const hasLoginFormSignal = lowerSnippet.includes("<form") && lowerSnippet.includes("password");
  return (isRedirectStatus || diagnostics?.redirected) && lowerContentType.includes("text/html") && (hasAuthPathSignal || hasLoginFormSignal);
}

function isLikelyAuthDocument(diagnostics) {
  const lowerContentType = String(diagnostics?.contentType || "").toLowerCase();
  const lowerUrl = String(diagnostics?.url || "").toLowerCase();
  const lowerSnippet = String(diagnostics?.textSnippet || "").toLowerCase();
  if (!lowerContentType.includes("text/html")) return false;
  const hasAuthPathSignal = lowerUrl.includes("/login") || lowerUrl.includes("/auth");
  const hasLoginFormSignal = lowerSnippet.includes("<form") && lowerSnippet.includes("password");
  return diagnostics?.status === 401 || diagnostics?.status === 403 || (hasAuthPathSignal && hasLoginFormSignal);
}

function isLikelyEdgeTimeout(diagnostics) {
  if (diagnostics?.status === 524) return true;
  const lowerContentType = String(diagnostics?.contentType || "").toLowerCase();
  const lowerSnippet = String(diagnostics?.textSnippet || "").toLowerCase();
  return lowerContentType.includes("text/html") && lowerSnippet.includes("cloudflare") && lowerSnippet.includes("timeout");
}

export function mapDiagnosticsToErrorMessage(diagnostics, fallback = "Unexpected response from the server. Please retry.") {
  if (!diagnostics) return fallback;
  if (diagnostics.status === 401 || diagnostics.status === 403) return AUTH_ISSUE_MESSAGE;
  if (isLikelyAuthRedirect(diagnostics) || isLikelyAuthDocument(diagnostics)) return AUTH_REDIRECT_MESSAGE;
  if (isLikelyEdgeTimeout(diagnostics)) return EDGE_TIMEOUT_MESSAGE;
  if (diagnostics.status >= 500) return SERVER_ERROR_MESSAGE;
  return `Request failed (${diagnostics.status}). Please retry.`;
}

export async function readJsonPayload(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
