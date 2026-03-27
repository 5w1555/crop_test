/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";

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
      <h1 style={{ fontSize: "22px", fontWeight: 700, marginBottom: "24px", letterSpacing: "-0.3px" }}>
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
  return <div style={{ display: "flex", flexDirection: "column", gap: tokens.gap[gap] ?? gap }}>{children}</div>;
}

function Inline({ gap = "base", children }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: tokens.gap[gap] ?? gap }}>
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
  return <p style={{ fontSize: "14px", lineHeight: 1.6, margin: 0, color: tokens.colors.text }}>{children}</p>;
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
    <div style={{ ...toneStyle(tone), borderRadius: tokens.radius, padding: "12px 16px", fontSize: "14px" }}>
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
      }}
    >
      {children}
    </button>
  );
}

const EMPTY_MARGINS = { top: "", right: "", bottom: "", left: "" };

async function parseJsonResponseSafely(response) {
  const contentType = response.headers.get("content-type") || "";
  const rawBody = await response.text();

  if (!rawBody) {
    return { payload: null, rawBody: "", isJson: contentType.includes("application/json") };
  }

  if (!contentType.includes("application/json")) {
    return { payload: null, rawBody, isJson: false };
  }

  try {
    return { payload: JSON.parse(rawBody), rawBody, isJson: true };
  } catch {
    return { payload: null, rawBody, isJson: false };
  }
}

function formatUnexpectedResponse(response, rawBody) {
  const contentType = response.headers.get("content-type") || "unknown";
  const snippet = rawBody.replace(/\s+/g, " ").slice(0, 160);
  const responseDescriptor = `${response.status} ${response.statusText}`.trim();
  return `Unexpected non-JSON response from server (${responseDescriptor}, ${contentType})${snippet ? `: ${snippet}` : ""}`;
}

export default function CropControlCenter() {
  const location = useLocation();
  const previewMode = new URLSearchParams(location.search).get("preview") === "1";
  const apiQuery = previewMode ? "?preview=1" : "";
  const cropActionPath = `/api/crop${apiQuery}`;
  const productsPath = `/api/products${apiQuery}`;

  const [sourceType, setSourceType] = useState("upload");
  const [files, setFiles] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [products, setProducts] = useState([]);
  const [selectedImageUrl, setSelectedImageUrl] = useState("");
  const [method, setMethod] = useState("auto");
  const [targetAspectRatio, setTargetAspectRatio] = useState("");
  const [margins, setMargins] = useState(EMPTY_MARGINS);
  const [isCropping, setIsCropping] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  const canCrop = sourceType === "upload" ? files.length > 0 : Boolean(selectedImageUrl);

  const beforeImage = useMemo(() => {
    if (sourceType === "shopify") return selectedImageUrl || null;
    if (!files.length) return null;
    return URL.createObjectURL(files[0]);
  }, [files, selectedImageUrl, sourceType]);

  useEffect(() => {
    if (sourceType !== "upload") return undefined;
    if (!beforeImage) return undefined;

    return () => {
      URL.revokeObjectURL(beforeImage);
    };
  }, [beforeImage, sourceType]);

  const firstAfterImage = result?.mediaUpdates?.[0]?.croppedBase64 || null;

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      setProducts([]);
      return;
    }

    setIsSearching(true);
    setErrorMessage("");

    try {
      const separator = productsPath.includes("?") ? "&" : "?";
      const response = await fetch(`${productsPath}${separator}q=${encodeURIComponent(searchTerm.trim())}`, {
        headers: { Accept: "application/json" },
      });
      const { payload, rawBody, isJson } = await parseJsonResponseSafely(response);

      if (!isJson) {
        throw new Error(formatUnexpectedResponse(response, rawBody));
      }

      if (!response.ok) {
        throw new Error(payload?.errors?.[0]?.message || "Product search failed");
      }

      setProducts(payload.products || []);
      if ((payload.products || []).length === 0) {
        setSelectedImageUrl("");
      }
    } catch (error) {
      setErrorMessage(error.message || "Product search failed");
    } finally {
      setIsSearching(false);
    }
  };

  const handleCrop = async () => {
    setIsCropping(true);
    setErrorMessage("");
    setResult(null);

    const form = new FormData();

    if (sourceType === "upload") {
      files.forEach((file) => form.append("file", file));
    } else if (selectedImageUrl) {
      form.append("imageUrl", selectedImageUrl);
    }

    form.append("method", method);
    if (targetAspectRatio !== "") form.append("targetAspectRatio", targetAspectRatio);
    if (margins.top !== "") form.append("marginTop", margins.top);
    if (margins.right !== "") form.append("marginRight", margins.right);
    if (margins.bottom !== "") form.append("marginBottom", margins.bottom);
    if (margins.left !== "") form.append("marginLeft", margins.left);

    try {
      const response = await fetch(cropActionPath, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: form,
      });
      const { payload, rawBody, isJson } = await parseJsonResponseSafely(response);

      if (!isJson) {
        throw new Error(formatUnexpectedResponse(response, rawBody));
      }

      setResult(payload);

      if (!response.ok || payload.error) {
        setErrorMessage(payload.errorDetails || payload.error || "Crop failed");
      }
    } catch (error) {
      setErrorMessage(error.message || "Crop failed");
    } finally {
      setIsCropping(false);
    }
  };

  return (
    <Page heading="Smart Crop Control Center">
      <Card>
        <Stack gap="small">
          <Heading>Source</Heading>
          <Inline>
            <label style={{ fontSize: "14px" }}>
              <input
                type="radio"
                name="sourceType"
                value="upload"
                checked={sourceType === "upload"}
                onChange={() => setSourceType("upload")}
              />{" "}
              Local upload
            </label>
            <label style={{ fontSize: "14px" }}>
              <input
                type="radio"
                name="sourceType"
                value="shopify"
                checked={sourceType === "shopify"}
                onChange={() => setSourceType("shopify")}
              />{" "}
              Shopify product search
            </label>
          </Inline>

          {sourceType === "upload" ? (
            <input type="file" multiple accept="image/*" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
          ) : (
            <Stack gap="small">
              <Inline>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search products by title"
                  style={{ flex: 1, minWidth: 250, padding: "8px", borderRadius: 8, border: `1px solid ${tokens.colors.border}` }}
                />
                <Button onClick={handleSearch} disabled={isSearching}>{isSearching ? "Searching…" : "Search"}</Button>
              </Inline>
              {products.map((product) => (
                <Stack key={product.id} gap="small">
                  <Paragraph><strong>{product.title}</strong></Paragraph>
                  <Inline>
                    {product.imageUrls.map((imageUrl) => (
                      <button
                        key={imageUrl}
                        onClick={() => setSelectedImageUrl(imageUrl)}
                        style={{
                          border: selectedImageUrl === imageUrl ? `2px solid ${tokens.colors.primary}` : `1px solid ${tokens.colors.border}`,
                          borderRadius: 8,
                          padding: 0,
                          background: "transparent",
                          cursor: "pointer",
                        }}
                      >
                        <img src={imageUrl} alt={product.title} style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 8 }} />
                      </button>
                    ))}
                  </Inline>
                </Stack>
              ))}
            </Stack>
          )}
        </Stack>
      </Card>

      <Card>
        <Stack gap="small">
          <Heading>Crop settings</Heading>
          <Inline>
            <label style={{ fontSize: "14px" }}>
              Method{" "}
              <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ marginLeft: 8 }}>
                <option value="auto">auto</option>
                <option value="manual">manual</option>
              </select>
            </label>
            <label style={{ fontSize: "14px" }}>
              Target aspect ratio{" "}
              <input
                type="number"
                step="0.01"
                value={targetAspectRatio}
                onChange={(e) => setTargetAspectRatio(e.target.value)}
                placeholder="e.g. 1.00"
                style={{ marginLeft: 8, width: 100 }}
              />
            </label>
          </Inline>
          <Grid columns={4}>
            {Object.keys(margins).map((side) => (
              <label key={side} style={{ fontSize: "14px" }}>
                {side}
                <input
                  type="number"
                  step="1"
                  value={margins[side]}
                  onChange={(e) => setMargins((prev) => ({ ...prev, [side]: e.target.value }))}
                  style={{ marginLeft: 8, width: 72 }}
                />
              </label>
            ))}
          </Grid>
          <Inline>
            <Button variant="primary" onClick={handleCrop} disabled={!canCrop || isCropping}>
              {isCropping ? "Cropping…" : "Crop image"}
            </Button>
            {result?.status === "succeeded" ? <Badge tone="success">Crop completed</Badge> : null}
          </Inline>
          {errorMessage ? <Banner tone="critical">{errorMessage}</Banner> : null}
        </Stack>
      </Card>

      <Grid columns={2}>
        <Card>
          <Stack gap="small">
            <Heading>Before</Heading>
            {beforeImage ? (
              <img src={beforeImage} alt="Before crop" style={{ width: "100%", borderRadius: 10 }} />
            ) : (
              <Paragraph>Select a source image to preview.</Paragraph>
            )}
          </Stack>
        </Card>

        <Card>
          <Stack gap="small">
            <Heading>After</Heading>
            {firstAfterImage ? (
              <>
                <img src={firstAfterImage} alt="After crop" style={{ width: "100%", borderRadius: 10 }} />
                <a href={firstAfterImage} download="cropped-image.jpg" style={{ fontSize: "14px" }}>
                  Download cropped image
                </a>
              </>
            ) : (
              <Paragraph>Crop an image to view output.</Paragraph>
            )}
          </Stack>
        </Card>
      </Grid>
    </Page>
  );
}
