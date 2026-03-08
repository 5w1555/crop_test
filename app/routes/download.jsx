import { useLoaderData } from "react-router";
import { takePreparedDownload } from "../utils/preparedDownloads.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return Response.json(
      {
        ok: false,
        code: "missing_token",
        error: "Download link is missing. Generate a new ZIP to continue.",
      },
      { status: 400 },
    );
  }

  const preparedDownload = takePreparedDownload(token);

  if (!preparedDownload) {
    return Response.json(
      {
        ok: false,
        code: "expired_or_invalid",
        error: "This download link has expired or is invalid. Regenerate the ZIP from the crop screen.",
      },
      { status: 410 },
    );
  }

  const headers = new Headers({
    "content-type": preparedDownload.mimeType,
    "content-disposition": `attachment; filename="${preparedDownload.filename}"`,
    "cache-control": "no-store",
  });

  if (preparedDownload.contentEncoding) {
    headers.set("content-encoding", preparedDownload.contentEncoding);
  }

  if (Number.isFinite(preparedDownload.contentLength)) {
    headers.set("content-length", String(preparedDownload.contentLength));
  }

  return new Response(preparedDownload.stream, {
    status: 200,
    headers,
  });
};

export default function DownloadRoute() {
  const data = useLoaderData();

  if (!data || data.ok !== false) {
    return null;
  }

  return (
    <main style={{ padding: "2rem", maxWidth: "640px", margin: "0 auto" }}>
      <h1>Download unavailable</h1>
      <p>{data.error}</p>
      <a href="/app/additional">Back to crop tool</a>
    </main>
  );
}
