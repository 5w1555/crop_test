/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLocation } from "react-router";

const tokens = {
  radius: "10px",
  gap: { small: "8px", base: "16px", large: "24px" },
  font: "'Inter', system-ui, sans-serif",
  colors: {
    bg: "#f6f6f7",
    surface: "#ffffff",
    border: "#e3e3e7",
    text: "#1a1a1a",
    muted: "#6b7280",
    primary: "#008060",
    primaryHover: "#006e52",
    info: { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe" },
    success: { bg: "#f0fdf4", text: "#166534", border: "#bbf7d0" },
    warning: { bg: "#fffbeb", text: "#92400e", border: "#fde68a" },
    critical: { bg: "#fef2f2", text: "#991b1b", border: "#fecaca" },
  },
};

const toneStyle = (tone) => ({
  backgroundColor: tokens.colors[tone]?.bg ?? tokens.colors.info.bg,
  color: tokens.colors[tone]?.text ?? tokens.colors.info.text,
  border: `1px solid ${tokens.colors[tone]?.border ?? tokens.colors.info.border}`,
});

function Page({ heading, children }) {
  return (
    <div
      style={{
        fontFamily: tokens.font,
        background: tokens.colors.bg,
        minHeight: "100vh",
        padding: "32px 24px",
        color: tokens.colors.text,
      }}
    >
      <h1
        style={{
          fontSize: "22px",
          fontWeight: 700,
          marginBottom: "24px",
          letterSpacing: "-0.3px",
        }}
      >
        {heading}
      </h1>
      <Stack gap="large">{children}</Stack>
    </div>
  );
}

function Card({ children }) {
  return (
    <div
      style={{
        background: tokens.colors.surface,
        border: `1px solid ${tokens.colors.border}`,
        borderRadius: tokens.radius,
        padding: "20px",
        boxShadow: "0 1px 3px rgba(0,0,0,.06)",
      }}
    >
      {children}
    </div>
  );
}

function Stack({ gap = "base", children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: tokens.gap[gap] ?? gap }}>
      {children}
    </div>
  );
}

function Inline({ gap = "base", children }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: tokens.gap[gap] ?? gap,
      }}
    >
      {children}
    </div>
  );
}

function Grid({ columns = 2, gap = "base", children }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: tokens.gap[gap] ?? gap,
      }}
    >
      {children}
    </div>
  );
}

function Heading({ children }) {
  return <h2 style={{ fontSize: "15px", fontWeight: 600, margin: 0 }}>{children}</h2>;
}

function Paragraph({ children }) {
  return (
    <p style={{ fontSize: "14px", lineHeight: 1.6, margin: 0, color: tokens.colors.text }}>
      {children}
    </p>
  );
}

function Badge({ tone = "info", children }) {
  return (
    <span
      style={{
        ...toneStyle(tone),
        display: "inline-flex",
        alignItems: "center",
        borderRadius: "999px",
        padding: "3px 10px",
        fontSize: "12px",
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

function Banner({ tone = "info", children }) {
  return (
    <div
      style={{
        ...toneStyle(tone),
        borderRadius: tokens.radius,
        padding: "12px 16px",
        fontSize: "14px",
      }}
    >
      {children}
    </div>
  );
}

function Button({ variant = "secondary", onClick, disabled, children }) {
  const isPrimary = variant === "primary";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "8px",
        padding: "8px 16px",
        fontSize: "14px",
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        border: isPrimary ? "none" : `1px solid ${tokens.colors.border}`,
        background: isPrimary ? tokens.colors.primary : tokens.colors.surface,
        color: isPrimary ? "#fff" : tokens.colors.text,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!disabled && isPrimary) e.currentTarget.style.background = tokens.colors.primaryHover;
      }}
      onMouseLeave={(e) => {
        if (!disabled && isPrimary) e.currentTarget.style.background = tokens.colors.primary;
      }}
    >
      {children}
    </button>
  );
}

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

export default function CropControlCenter() {
  const cropFetcher = useFetcher();
  const statusFetcher = useFetcher();
  const location = useLocation();
  const [files, setFiles] = useState([]);
  const [result, setResult] = useState(null);

  const previewQuery = location.search || "";
  const apiStatusPath = `/app/api-status${previewQuery}`;
  const cropActionPath = `/app/crop${previewQuery}`;

  useEffect(() => {
    if (statusFetcher.state === "idle" && !statusFetcher.data) {
      statusFetcher.load(apiStatusPath);
    }
  }, [apiStatusPath, statusFetcher]);

  useEffect(() => {
    if (cropFetcher.data) setResult(cropFetcher.data);
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
    cropFetcher.submit(form, { method: "POST", action: cropActionPath });
  };

  return (
    <Page heading="Smart Crop Control Center">
      <Card>
        <Stack gap="base">
          <Heading>Run image cropping from one place</Heading>
          <Paragraph>
            This page combines onboarding, a live API health probe, upload preparation, and crop
            execution so you can validate the integration before processing files.
          </Paragraph>
          <Inline gap="base">
            <Badge tone={status.tone}>{status.title}</Badge>
            <Button
              variant="secondary"
              onClick={() => statusFetcher.load(apiStatusPath)}
              disabled={isCheckingApi}
            >
              {isCheckingApi ? "Checking…" : "Re-check API"}
            </Button>
          </Inline>
          <Paragraph>{status.description}</Paragraph>
        </Stack>
      </Card>

      <Grid columns={2} gap="base">
        <Card>
          <Stack gap="small">
            <Heading>Connection diagnostics</Heading>
            <Paragraph>
              <strong>Endpoint:</strong> {statusFetcher.data?.apiBase || "Checking…"}
            </Paragraph>
            <Paragraph>
              <strong>HTTP status:</strong> {statusFetcher.data?.status ?? "n/a"}
            </Paragraph>
            <Paragraph>
              <strong>Details:</strong> {statusFetcher.data?.details || "Waiting for probe."}
            </Paragraph>
            {!statusFetcher.data?.ok && statusFetcher.data?.error ? (
              <Banner tone="critical">{statusFetcher.data.error}</Banner>
            ) : null}
          </Stack>
        </Card>

        <Card>
          <Stack gap="small">
            <Heading>What to fix if the probe fails</Heading>
            <Paragraph>
              The browser checks the API through <code>/app/api-status</code>, and crop jobs are
              sent through <code>/app/crop</code>. If the probe fails, the likely cause is that the
              app server cannot reach <code>SMARTCROP_API_URL</code>.
            </Paragraph>
            <Paragraph>
              Update the environment variable to a reachable Smart Crop backend, confirm outbound
              access from the server environment, then re-run the probe from this page.
            </Paragraph>
          </Stack>
        </Card>
      </Grid>

      <Card>
        <Stack gap="base">
          <Heading>Upload queue</Heading>
          <input
            type="file"
            multiple
            accept="image/*"
            style={{ fontSize: "14px" }}
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
          />
          {selectedFileSummary.length ? (
            <Stack gap="small">
              {selectedFileSummary.map((file) => (
                <Paragraph key={`${file.name}-${file.size}`}>
                  <strong>{file.name}</strong> — {file.type} — {file.size}
                </Paragraph>
              ))}
            </Stack>
          ) : (
            <Paragraph>No files selected yet.</Paragraph>
          )}
          <Inline gap="base">
            <Button variant="primary" onClick={handleCrop} disabled={!canCrop || isCropping}>
              {isCropping ? "Cropping…" : "Start crop"}
            </Button>
            {!statusFetcher.data?.ok ? (
              <Badge tone="warning">Fix API access before cropping</Badge>
            ) : null}
          </Inline>
        </Stack>
      </Card>

      <Grid columns={2} gap="base">
        <Card>
          <Stack gap="small">
            <Heading>Crop run status</Heading>
            <Badge tone={cropSummary.tone}>{cropSummary.title}</Badge>
            <Paragraph>{cropSummary.description}</Paragraph>
            {result?.error ? (
              <Banner tone="critical">{result.errorDetails || result.error}</Banner>
            ) : null}
          </Stack>
        </Card>

        <Card>
          <Stack gap="small">
            <Heading>Processing flow</Heading>
            <Paragraph>1. The page probes the API through the app server.</Paragraph>
            <Paragraph>2. You select one or more local images.</Paragraph>
            <Paragraph>
              3. The app posts files to <code>/app/crop</code>.
            </Paragraph>
            <Paragraph>
              4. The route forwards the files to the Smart Crop API and returns the result.
            </Paragraph>
          </Stack>
        </Card>
      </Grid>

      {firstImage ? (
        <Card>
          <Stack gap="base">
            <Heading>Preview</Heading>
            <img
              src={firstImage}
              alt="First cropped output"
              style={{ maxWidth: "100%", borderRadius: "12px" }}
            />
            <a href={firstImage} download="cropped-image.jpg" style={{ fontSize: "14px" }}>
              Download first cropped image
            </a>
          </Stack>
        </Card>
      ) : null}
    </Page>
  );
}
