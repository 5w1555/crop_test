const PREVIEW_FLAG = "preview";

export function isPreviewRequest(request) {
  const url = new URL(request.url);
  const explicitPreview = url.searchParams.get(PREVIEW_FLAG) === "1";

  if (explicitPreview) {
    return true;
  }

  const hasShopContext = Boolean(
    url.searchParams.get("shop") || url.searchParams.get("host") || url.searchParams.get("embedded"),
  );

  return process.env.NODE_ENV !== "production" && !hasShopContext;
}
