import { takePreparedDownload } from "../utils/preparedDownloads.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response("Missing download token.", { status: 400 });
  }

  const preparedDownload = takePreparedDownload(token);

  if (!preparedDownload) {
    return new Response("Download link is invalid or expired.", { status: 410 });
  }

  const response = new Response(preparedDownload.stream, {
    status: 200,
    headers: {
      "content-type": preparedDownload.mimeType,
      "content-disposition": `attachment; filename="${preparedDownload.filename}"`,
      "cache-control": "no-store",
    },
  });

  return response;
};

