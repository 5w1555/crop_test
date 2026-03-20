import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";

const defaultStatus = {
  tone: "info",
  title: "Checking Smart Crop API",
  description:
    "Running a live probe through the app server so the browser can verify the backend connection.",
};

function getStatusPresentation(data) {
  if (!data) return defaultStatus;

  if (data.ok) {
    return {
      tone: "success",
      title: "API is reachable",
      description: `The Smart Crop API responded${data.status ? ` with HTTP ${data.status}` : ""}.`,
    };
  }

  return {
    tone: "critical",
    title: "API is not reachable from the app",
    description:
      data.error ||
      data.details ||
      "The probe did not complete successfully. Review the diagnostics below.",
  };
}

function getCropSummary(result) {
  if (!result) {
    return {
      tone: "info",
      title: "No crop run yet",
      description: "Upload at least one image and start the crop flow to see output here.",
    };
  }

  if (result.error) {
    return {
      tone: "critical",
      title: "Crop failed",
      description: result.errorDetails || result.error,
    };
  }

  return {
    tone: "success",
    title: "Crop completed",
    description: `Received ${result.mediaUpdates?.length || 0} cropped asset${
      result.mediaUpdates?.length === 1 ? "" : "s"
    } from the API.`,
  };
}

export default function CropPage() {
  const cropFetcher = useFetcher();
  const statusFetcher = useFetcher();
  const [files, setFiles] = useState([]);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (statusFetcher.state === "idle" && !statusFetcher.data) {
      statusFetcher.load("/app/api-status");
    }
  }, [statusFetcher]);

  useEffect(() => {
    if (cropFetcher.data) {
      setResult(cropFetcher.data);
    }
  }, [cropFetcher.data]);

  const selectedFileSummary = useMemo(
    () =>
      files.map((file) => ({
        name: file.name,
        size: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
        type: file.type || "unknown",
      })),
    [files],
  );

  const status = getStatusPresentation(statusFetcher.data);
  const cropSummary = getCropSummary(result);
  const isCropping = cropFetcher.state !== "idle";
  const isCheckingApi = statusFetcher.state !== "idle";
  const canCrop = files.length > 0 && statusFetcher.data?.ok;
  const firstImage = result?.mediaUpdates?.[0]?.croppedBase64;

  const handleCrop = () => {
    const form = new FormData();
    files.forEach((file) => form.append("file", file));
    cropFetcher.submit(form, { method: "POST", action: "/app/crop" });
  };

  return (
    <s-page heading="Smart Crop Control Center">
      <s-stack gap="large">
        <s-card>
          <s-stack gap="base">
            <s-heading>Run image cropping from one place</s-heading>
            <s-paragraph>
              This main page now combines onboarding, a live API health probe, upload preparation,
              and crop execution so you can validate the integration before processing files.
            </s-paragraph>
            <s-inline gap="base">
              <s-badge tone={status.tone}>{status.title}</s-badge>
              <s-button
                variant="secondary"
                onClick={() => statusFetcher.load("/app/api-status")}
                disabled={isCheckingApi}
              >
                {isCheckingApi ? "Checking..." : "Re-check API"}
              </s-button>
            </s-inline>
            <s-paragraph>{status.description}</s-paragraph>
          </s-stack>
        </s-card>

        <s-grid columns="2" gap="base">
          <s-card>
            <s-stack gap="small">
              <s-heading>Connection diagnostics</s-heading>
              <s-paragraph>
                <strong>Endpoint:</strong> {statusFetcher.data?.apiBase || "Checking..."}
              </s-paragraph>
              <s-paragraph>
                <strong>HTTP status:</strong> {statusFetcher.data?.status ?? "n/a"}
              </s-paragraph>
              <s-paragraph>
                <strong>Details:</strong> {statusFetcher.data?.details || "Waiting for probe."}
              </s-paragraph>
              {!statusFetcher.data?.ok && statusFetcher.data?.error ? (
                <s-banner tone="critical">{statusFetcher.data.error}</s-banner>
              ) : null}
            </s-stack>
          </s-card>

          <s-card>
            <s-stack gap="small">
              <s-heading>What to fix if the probe fails</s-heading>
              <s-paragraph>
                The browser checks the API through <code>/app/api-status</code>, and crop jobs are sent
                through <code>/app/crop</code>. If the probe fails, the likely cause is that the app
                server cannot reach <code>SMARTCROP_API_URL</code>.
              </s-paragraph>
              <s-paragraph>
                Update the environment variable to a reachable Smart Crop backend, confirm outbound
                access from the server environment, then re-run the probe from this page.
              </s-paragraph>
            </s-stack>
          </s-card>
        </s-grid>

        <s-card>
          <s-stack gap="base">
            <s-heading>Upload queue</s-heading>
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={(event) => setFiles(Array.from(event.target.files || []))}
            />
            {selectedFileSummary.length ? (
              <s-stack gap="small">
                {selectedFileSummary.map((file) => (
                  <s-paragraph key={`${file.name}-${file.size}`}>
                    <strong>{file.name}</strong> — {file.type} — {file.size}
                  </s-paragraph>
                ))}
              </s-stack>
            ) : (
              <s-paragraph>No files selected yet.</s-paragraph>
            )}
            <s-inline gap="base">
              <s-button variant="primary" onClick={handleCrop} disabled={!canCrop || isCropping}>
                {isCropping ? "Cropping..." : "Start crop"}
              </s-button>
              {!statusFetcher.data?.ok ? (
                <s-badge tone="warning">Fix API access before cropping</s-badge>
              ) : null}
            </s-inline>
          </s-stack>
        </s-card>

        <s-grid columns="2" gap="base">
          <s-card>
            <s-stack gap="small">
              <s-heading>Crop run status</s-heading>
              <s-badge tone={cropSummary.tone}>{cropSummary.title}</s-badge>
              <s-paragraph>{cropSummary.description}</s-paragraph>
              {result?.error ? (
                <s-banner tone="critical">{result.errorDetails || result.error}</s-banner>
              ) : null}
            </s-stack>
          </s-card>

          <s-card>
            <s-stack gap="small">
              <s-heading>Processing flow</s-heading>
              <s-paragraph>1. The page probes the API through the app server.</s-paragraph>
              <s-paragraph>2. You select one or more local images.</s-paragraph>
              <s-paragraph>3. The app posts files to <code>/app/crop</code>.</s-paragraph>
              <s-paragraph>4. The route forwards the files to the Smart Crop API and returns the result.</s-paragraph>
            </s-stack>
          </s-card>
        </s-grid>

        {firstImage ? (
          <s-card>
            <s-stack gap="base">
              <s-heading>Preview</s-heading>
              <img
                src={firstImage}
                alt="First cropped output"
                style={{ maxWidth: "100%", borderRadius: "12px" }}
              />
              <a href={firstImage} download="cropped-image.jpg">
                Download first cropped image
              </a>
            </s-stack>
          </s-card>
        ) : null}
      </s-stack>
    </s-page>
  );
}
