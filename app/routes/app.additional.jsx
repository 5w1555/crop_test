import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { PLAN_CONFIG, buildPlanView } from "../utils/plan.js";
import {
  commitPlanUsage,
  getShopPlanUsage,
  reservePlanCapacity,
} from "../utils/plan.server.js";
import { cropImages, health } from "../utils/smartCropClient";
import { getBillingState } from "../utils/billing.server";
import { PRO_PLAN } from "../utils/billing";

const CROP_METHODS = [
  {
    value: "auto",
    label: "Auto",
    description:
      "Automatically chooses frontal/profile logic and uses center/content fallback when no face is detected.",
  },
  {
    value: "head_bust",
    label: "Head bust",
    description:
      "Portrait-focused crop intended for head and shoulders framing.",
  },
  {
    value: "frontal",
    label: "Frontal",
    description:
      "Best when the face looks straight at the camera and both eyes are visible.",
  },
  {
    value: "profile",
    label: "Profile",
    description:
      "Optimized for side-profile shots where one side of the face is dominant.",
  },
  {
    value: "chin",
    label: "Chin",
    description: "Crops with an emphasis around the jaw/chin region.",
  },
  {
    value: "nose",
    label: "Nose",
    description: "Centers the crop relative to nose landmarks.",
  },
  {
    value: "below_lips",
    label: "Below lips",
    description:
      "Anchors composition just below the lips for tighter portrait crops.",
  },
];

const PRESET_OPTIONS = [
  {
    value: "auto",
    label: "Auto (recommended)",
    method: "auto",
    description:
      "Best default for mixed catalog uploads. The app decides the crop strategy.",
  },
  {
    value: "portrait",
    label: "Portrait",
    method: "head_bust",
    description: "Head-and-shoulders framing for model and profile imagery.",
  },
  {
    value: "product",
    label: "Product",
    method: "auto",
    description:
      "Balanced product framing with content fallback when no face is present.",
  },
  {
    value: "square",
    label: "Square",
    method: "chin",
    description:
      "Tighter composition preferred for social grids and square presentation.",
  },
];

const ANCHOR_HINT_OPTIONS = [
  "auto",
  "top",
  "center",
  "bottom",
  "left",
  "right",
];
const SUPPORTED_FILTERS = ["sharpen", "detail", "grayscale"];
const PREFERENCE_STORAGE_KEY = "crop.additional.preferences";

function normalizeTargetAspectRatio(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return { value: "", error: null };
  }

  const ratioParts = value.split(":");
  if (ratioParts.length > 2) {
    return {
      value,
      error:
        "Aspect ratio must be a single number (e.g. 1.5) or W:H (e.g. 4:5).",
    };
  }

  const parsedNumbers = ratioParts.map((part) => Number(part.trim()));
  if (parsedNumbers.some((part) => !Number.isFinite(part) || part <= 0)) {
    return {
      value,
      error: "Aspect ratio values must be positive numbers.",
    };
  }

  return { value, error: null };
}

function normalizeMarginValue(rawValue, label) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return { value: "", numericValue: null, error: null };
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return {
      value,
      numericValue: null,
      error: `${label} must be a non-negative number.`,
    };
  }

  return { value, numericValue, error: null };
}

function normalizeAnchorHint(rawValue) {
  const value = String(rawValue || "")
    .trim()
    .toLowerCase();
  if (!value) {
    return { value: "", error: null };
  }

  if (!ANCHOR_HINT_OPTIONS.includes(value)) {
    return {
      value,
      error: `Anchor hint must be one of: ${ANCHOR_HINT_OPTIONS.join(", ")}.`,
    };
  }

  return { value, error: null };
}

function normalizeFilters(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return { value: "", normalizedFilters: [], error: null };
  }

  const normalizedFilters = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const invalidFilters = normalizedFilters.filter(
    (entry) => !SUPPORTED_FILTERS.includes(entry),
  );

  if (invalidFilters.length) {
    return {
      value,
      normalizedFilters: [],
      error: `Unsupported filters: ${invalidFilters.join(", ")}. Allowed: ${SUPPORTED_FILTERS.join(", ")}.`,
    };
  }

  return { value, normalizedFilters, error: null };
}

function buildCropOptionPayload(values) {
  const targetAspectRatio = normalizeTargetAspectRatio(
    values.targetAspectRatio,
  );
  const marginTop = normalizeMarginValue(
    values.marginTop,
    "Top margin/padding",
  );
  const marginRight = normalizeMarginValue(
    values.marginRight,
    "Right margin/padding",
  );
  const marginBottom = normalizeMarginValue(
    values.marginBottom,
    "Bottom margin/padding",
  );
  const marginLeft = normalizeMarginValue(
    values.marginLeft,
    "Left margin/padding",
  );
  const anchorHint = normalizeAnchorHint(values.anchorHint);
  const filters = normalizeFilters(values.filters);

  const errors = [
    targetAspectRatio.error,
    marginTop.error,
    marginRight.error,
    marginBottom.error,
    marginLeft.error,
    anchorHint.error,
    filters.error,
  ].filter(Boolean);

  return {
    errors,
    options: {
      targetAspectRatio: targetAspectRatio.value || undefined,
      marginTop: marginTop.numericValue,
      marginRight: marginRight.numericValue,
      marginBottom: marginBottom.numericValue,
      marginLeft: marginLeft.numericValue,
      anchorHint: anchorHint.value || undefined,
      filters: filters.normalizedFilters.length
        ? filters.normalizedFilters
        : undefined,
    },
  };
}

function validateImageFile(file) {
  if (!(file instanceof File)) {
    return "Please upload an image.";
  }

  if (!file.type.startsWith("image/")) {
    return "Only image files are supported.";
  }

  return null;
}

export const loader = async ({ request }) => {
  const { session, admin, billing } = await authenticate.admin(request);
  const apiHealthy = await health();
  const billingState = await getBillingState({ billing });

  let products = [];
  let productContextWarning = null;

  try {
    const productsResponse = await admin.graphql(
      `#graphql
      query CropReadyProducts {
        products(first: 5, sortKey: UPDATED_AT, reverse: true) {
          nodes {
            id
            title
            handle
            totalInventory
            featuredMedia {
              preview {
                image {
                  url
                  altText
                }
              }
            }
          }
        }
      }`,
    );

    const productsJson = await productsResponse.json();

    if (Array.isArray(productsJson?.errors) && productsJson.errors.length > 0) {
      console.error(
        "Failed to load product context from Shopify Admin GraphQL",
        {
          shop: session.shop,
          requestId: productsResponse.headers.get("x-request-id") || null,
          graphqlErrors: productsJson.errors,
        },
      );

      productContextWarning = "Product context is temporarily unavailable.";
    } else {
      products = productsJson.data?.products?.nodes || [];
    }
  } catch (error) {
    console.error("Failed to load product context from Shopify Admin GraphQL", {
      shop: session.shop,
      requestId: null,
      graphqlErrors: null,
      error: error instanceof Error ? error.message : String(error),
    });

    productContextWarning = "Product context is temporarily unavailable.";
  }

  const planUsage = buildPlanView(
    await getShopPlanUsage(session.shop, {
      hasActiveProPlan: billingState.hasActivePayment,
    }),
  );

  return {
    apiHealthy,
    planUsage,
    hasActiveProPlan: billingState.hasActivePayment,
    products,
    productContextWarning,
  };
};

export const action = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const startedAt = Date.now();

  const formData = await request.formData();
  const files = formData.getAll("file");

  if (!files.length) return { error: "Please upload at least one image." };

  for (const file of files) {
    const fileError = validateImageFile(file);
    if (fileError) {
      return {
        error: `${file instanceof File ? file.name : "File"}: ${fileError}`,
      };
    }
  }

  const method = String(formData.get("method") || "auto");
  const optionPayload = buildCropOptionPayload({
    targetAspectRatio: String(formData.get("target_aspect_ratio") || ""),
    marginTop: String(formData.get("margin_top") || ""),
    marginRight: String(formData.get("margin_right") || ""),
    marginBottom: String(formData.get("margin_bottom") || ""),
    marginLeft: String(formData.get("margin_left") || ""),
    anchorHint: String(formData.get("anchor_hint") || ""),
    filters: String(formData.get("filters") || ""),
  });

  if (optionPayload.errors.length) {
    return { error: optionPayload.errors.join(" ") };
  }

  const billingState = await getBillingState({ billing });
  const planReservation = await reservePlanCapacity({
    shop: session.shop,
    imageCount: files.length,
    method,
    hasActiveProPlan: billingState.hasActivePayment,
  });

  if (!planReservation.ok) {
    return { error: planReservation.error, plan: planReservation.plan };
  }

  try {
    const response = await cropImages(files, {
      method: planReservation.effectiveMethod,
      ...optionPayload.options,
    });
    const elapsedMs = Date.now() - startedAt;

    const metadataFromHeaders = (() => {
      const parseNumeric = (value) => {
        if (value === null || value === undefined || value === "") return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };

      const parseManifestHeader = () => {
        const possibleManifestHeaders = [
          "x-smartcrop-manifest",
          "x-manifest",
          "x-crop-manifest",
        ];

        for (const headerName of possibleManifestHeaders) {
          const rawValue = response.headers.get(headerName);
          if (!rawValue) continue;

          try {
            const parsed = JSON.parse(rawValue);
            if (parsed && typeof parsed === "object") {
              return parsed;
            }
          } catch {
            // ignore malformed manifest headers
          }
        }

        return null;
      };

      const manifest = parseManifestHeader();
      const processedCount =
        parseNumeric(response.headers.get("x-processed-count")) ??
        parseNumeric(manifest?.processed_count) ??
        parseNumeric(manifest?.processedCount) ??
        files.length;
      const failedCount =
        parseNumeric(response.headers.get("x-failed-count")) ??
        parseNumeric(manifest?.failed_count) ??
        parseNumeric(manifest?.failedCount) ??
        Math.max(files.length - processedCount, 0);
      const elapsedFromManifest =
        parseNumeric(response.headers.get("x-elapsed-ms")) ??
        parseNumeric(manifest?.elapsed_ms) ??
        parseNumeric(manifest?.elapsedMs) ??
        null;

      return {
        requestedCount: files.length,
        processedCount,
        failedCount,
        elapsedMs: elapsedFromManifest ?? elapsedMs,
        manifest,
      };
    })();

    const mimeType =
      response.headers.get("content-type") || "application/octet-stream";
    if (!mimeType.includes("application/zip")) {
      const bodyPreview = (await response.text()).slice(0, 500);
      console.error("Smart Crop API returned unexpected content type", {
        mimeType,
        bodyPreview,
      });
      return {
        error: `Expected application/zip response but received ${mimeType}.`,
      };
    }

    await commitPlanUsage({ shop: session.shop, imageCount: files.length });

    const headers = new Headers({
      "content-type": response.headers.get("content-type") || "application/zip",
      "content-disposition":
        response.headers.get("content-disposition") ||
        'attachment; filename="cropped_batch.zip"',
      "cache-control": "no-store",
    });

    const contentEncoding = response.headers.get("content-encoding");
    if (contentEncoding) {
      headers.set("content-encoding", contentEncoding);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      headers.set("content-length", contentLength);
    }

    headers.set(
      "x-crop-summary",
      JSON.stringify({
        ...metadataFromHeaders,
        elapsedSeconds: Number((metadataFromHeaders.elapsedMs / 1000).toFixed(2)),
      }),
    );

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    console.error("Crop action failed", {
      error: error instanceof Error ? error.message : error,
      fileCount: files.length,
      method: planReservation.effectiveMethod,
    });
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to crop image. Check the FastAPI service.",
    };
  }
};

export default function CropImagePage() {
  const {
    apiHealthy,
    planUsage,
    hasActiveProPlan,
    products,
    productContextWarning,
  } = useLoaderData();
  const shopify = useAppBridge();

  const inputRef = useRef(null);
  const previewUrlRef = useRef("");
  const preferencesHydratedRef = useRef(false);
  const [fileError, setFileError] = useState("");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previewFile, setPreviewFile] = useState(null);
  const [selectedPreset, setSelectedPreset] = useState("auto");
  const [advancedMethodOverrideEnabled, setAdvancedMethodOverrideEnabled] =
    useState(false);
  const [advancedMethod, setAdvancedMethod] = useState("auto");
  const [targetAspectRatioInput, setTargetAspectRatioInput] = useState("");
  const [marginTopInput, setMarginTopInput] = useState("");
  const [marginRightInput, setMarginRightInput] = useState("");
  const [marginBottomInput, setMarginBottomInput] = useState("");
  const [marginLeftInput, setMarginLeftInput] = useState("");
  const [anchorHintInput, setAnchorHintInput] = useState("auto");
  const [filtersInput, setFiltersInput] = useState("");
  const [advancedValidationError, setAdvancedValidationError] = useState("");
  const [isDragActive, setIsDragActive] = useState(false);
  const [isSubmittingDownload, setIsSubmittingDownload] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const allowedMethods = CROP_METHODS.filter((method) =>
      planUsage.allowsFaceDetection ? true : method.value === "auto",
    ).map((method) => method.value);

    try {
      const savedPreferences = window.localStorage.getItem(
        PREFERENCE_STORAGE_KEY,
      );

      if (!savedPreferences) {
        return;
      }

      const parsedPreferences = JSON.parse(savedPreferences);
      if (typeof parsedPreferences !== "object" || !parsedPreferences) {
        return;
      }

      if (
        typeof parsedPreferences.selectedPreset === "string" &&
        PRESET_OPTIONS.some((preset) => preset.value === parsedPreferences.selectedPreset)
      ) {
        setSelectedPreset(parsedPreferences.selectedPreset);
      }

      if (
        typeof parsedPreferences.advancedMethodOverrideEnabled === "boolean"
      ) {
        setAdvancedMethodOverrideEnabled(
          parsedPreferences.advancedMethodOverrideEnabled,
        );
      }

      if (
        typeof parsedPreferences.advancedMethod === "string" &&
        allowedMethods.includes(parsedPreferences.advancedMethod)
      ) {
        setAdvancedMethod(parsedPreferences.advancedMethod);
      }
    } catch (error) {
      console.warn("Failed to hydrate crop preferences from local storage", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      preferencesHydratedRef.current = true;
    }
  }, [planUsage.allowsFaceDetection]);

  useEffect(() => {
    const allowedMethods = CROP_METHODS.filter((method) =>
      planUsage.allowsFaceDetection ? true : method.value === "auto",
    ).map((method) => method.value);

    if (!allowedMethods.includes(advancedMethod)) {
      setAdvancedMethod("auto");
    }
  }, [advancedMethod, planUsage.allowsFaceDetection]);

  useEffect(() => {
    if (typeof window === "undefined" || !preferencesHydratedRef.current) {
      return;
    }

    window.localStorage.setItem(
      PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        selectedPreset,
        advancedMethodOverrideEnabled,
        advancedMethod,
      }),
    );
  }, [advancedMethod, advancedMethodOverrideEnabled, selectedPreset]);

  const showToast = useCallback(
    (message, options) => {
      if (typeof window === "undefined") {
        return;
      }

      if (
        !shopify ||
        !shopify.toast ||
        typeof shopify.toast.show !== "function"
      ) {
        return;
      }

      shopify.toast.show(message, options);
    },
    [shopify],
  );

  const apiStatusText = useMemo(() => {
    if (apiHealthy) return "Connected";
    return "FastAPI service is unreachable";
  }, [apiHealthy]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  const syncPreviewFile = (nextFiles) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
    }

    const firstFile = nextFiles[0];
    if (!firstFile) {
      setPreviewFile(null);
      return;
    }

    const previewUrl = URL.createObjectURL(firstFile);
    previewUrlRef.current = previewUrl;
    setPreviewFile({
      name: firstFile.name,
      src: previewUrl,
    });
  };

  const syncSelectedFiles = (nextFiles) => {
    const nextError = nextFiles
      .map((file) => {
        const error = validateImageFile(file);
        return error ? `${file.name}: ${error}` : null;
      })
      .find(Boolean);

    setFileError(nextError || "");
    syncPreviewFile(nextError ? [] : nextFiles);
    setSelectedFiles(
      nextError
        ? []
        : nextFiles.map((file) => ({
            name: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          })),
    );
  };

  const hasValidSelection = selectedFiles.length > 0 && !fileError;
  const selectedPresetConfig =
    PRESET_OPTIONS.find((preset) => preset.value === selectedPreset) ||
    PRESET_OPTIONS[0];
  const selectedMethod = advancedMethodOverrideEnabled
    ? advancedMethod
    : selectedPresetConfig.method;
  const selectedMethodDetails =
    CROP_METHODS.find((method) => method.value === selectedMethod) ||
    CROP_METHODS[0];
  const advancedOptionValidation = useMemo(
    () =>
      buildCropOptionPayload({
        targetAspectRatio: targetAspectRatioInput,
        marginTop: marginTopInput,
        marginRight: marginRightInput,
        marginBottom: marginBottomInput,
        marginLeft: marginLeftInput,
        anchorHint: anchorHintInput,
        filters: filtersInput,
      }),
    [
      anchorHintInput,
      filtersInput,
      marginBottomInput,
      marginLeftInput,
      marginRightInput,
      marginTopInput,
      targetAspectRatioInput,
    ],
  );

  const handleDownloadSubmit = (event) => {
    if (!hasValidSelection) {
      event.preventDefault();
      if (fileError) {
        showToast(fileError, { isError: true });
      }
      return;
    }

    if (advancedOptionValidation.errors.length) {
      event.preventDefault();
      const message = advancedOptionValidation.errors.join(" ");
      setAdvancedValidationError(message);
      showToast(message, { isError: true });
      return;
    }

    setAdvancedValidationError("");
    setIsSubmittingDownload(true);
    showToast("Cropping started. Your ZIP download will begin automatically.");
    setTimeout(() => {
      setIsSubmittingDownload(false);
    }, 6000);
  };

  const getInventoryStatus = useCallback((inventoryCount) => {
    return Number(inventoryCount) > 0 ? "In stock" : "Out of stock";
  }, []);

  return (
    <s-page heading="Crop Images">
      <style>{`
        .responsive-table {
          width: 100%;
          border-collapse: collapse;
        }

        .responsive-table th,
        .responsive-table td {
          padding: 8px;
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
          vertical-align: top;
        }

        .responsive-card-list {
          display: none;
        }

        .responsive-card {
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 8px;
          padding: 12px;
          background: var(--p-color-bg-surface, #fff);
        }

        .responsive-card-primary {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto auto;
          gap: 8px;
          align-items: start;
          margin-bottom: 8px;
        }

        .responsive-card-name {
          overflow-wrap: anywhere;
          font-weight: 600;
        }

        .responsive-card-metadata {
          display: grid;
          gap: 4px;
        }

        .responsive-card-row {
          display: flex;
          justify-content: space-between;
          gap: 8px;
        }

        @media (max-width: 900px) {
          .responsive-table {
            display: none;
          }

          .responsive-card-list {
            display: grid;
            gap: 12px;
          }
        }

        @media (max-width: 480px) {
          .responsive-card-primary {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      `}</style>
      <s-section heading="FastAPI connection">
        <s-banner tone={apiHealthy ? "success" : "critical"}>
          {apiHealthy
            ? "Connected to Smart Crop API"
            : "FastAPI service is unreachable. Set SMARTCROP_API_URL and verify /health."}
        </s-banner>
      </s-section>

      <s-section heading="Plan and usage">
        <s-stack direction="block" gap="small">
          <s-text>
            Current plan: <strong>{planUsage.label}</strong>
          </s-text>
          <s-text>
            Usage this month: {planUsage.imagesProcessed}/
            {planUsage.monthlyImageLimit} images
          </s-text>
          <s-text>Remaining this month: {planUsage.remaining} images</s-text>
          {!planUsage.allowsFaceDetection && (
            <s-banner tone="info">
              Free plan uses content-aware crop only ({" "}
              <code>center_content</code>). Face detection methods are available
              on the {PLAN_CONFIG.pro.label} plan (€
              {PLAN_CONFIG.pro.monthlyPriceEur}/month).
            </s-banner>
          )}
          {!hasActiveProPlan && (
            <s-text>
              To activate {PRO_PLAN}, open{" "}
              <s-link href="/app/billing">Billing</s-link> and approve the
              Shopify app subscription.
            </s-text>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Shopify product context">
        <s-paragraph>
          Latest products from your catalog are shown below so you can quickly
          verify which assets should be exported and cropped.
        </s-paragraph>
        {productContextWarning && (
          <s-banner tone="warning">{productContextWarning}</s-banner>
        )}
        {!products.length && (
          <s-text tone="subdued">No products found yet.</s-text>
        )}
        {products.length > 0 && (
          <>
            <table className="responsive-table">
              <thead>
                <tr>
                  <th align="left">Title</th>
                  <th align="left">Status</th>
                  <th align="left">Handle</th>
                  <th align="right">Inventory</th>
                  <th align="left">Featured image</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>{product.title}</td>
                    <td>{getInventoryStatus(product.totalInventory)}</td>
                    <td>{product.handle}</td>
                    <td align="right">{product.totalInventory ?? 0}</td>
                    <td>
                      {product.featuredMedia?.preview?.image ? (
                        <a
                          href={product.featuredMedia.preview.image.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View image
                        </a>
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="responsive-card-list">
              {products.map((product) => (
                <div key={`${product.id}-card`} className="responsive-card">
                  <div className="responsive-card-primary">
                    <span className="responsive-card-name">
                      {product.title}
                    </span>
                    <span>
                      {(product.totalInventory ?? 0).toString()} in stock
                    </span>
                    <span>{getInventoryStatus(product.totalInventory)}</span>
                  </div>
                  <div className="responsive-card-metadata">
                    <div className="responsive-card-row">
                      <span>Handle</span>
                      <span>{product.handle}</span>
                    </div>
                    <div className="responsive-card-row">
                      <span>Featured image</span>
                      {product.featuredMedia?.preview?.image ? (
                        <a
                          href={product.featuredMedia.preview.image.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View image
                        </a>
                      ) : (
                        <span>—</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </s-section>

      <s-section heading="Layer 1 — Zero friction">
        <s-paragraph>
          Drop images and run Smart Crop. For most stores, the default preset
          handles the batch without extra setup.
        </s-paragraph>

        <form
          method="post"
          encType="multipart/form-data"
          onSubmit={handleDownloadSubmit}
        >
          <s-stack direction="block" gap="base">
            <label htmlFor="file">Image files</label>
            <s-box
              padding="base"
              border="base"
              borderRadius="base"
              background={isDragActive ? "bg-fill-brand" : "bg-fill"}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setIsDragActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragActive(false);

                const nextFiles = Array.from(event.dataTransfer.files ?? []);
                if (!nextFiles.length) return;

                if (inputRef.current) {
                  const dataTransfer = new DataTransfer();
                  nextFiles.forEach((file) => dataTransfer.items.add(file));
                  inputRef.current.files = dataTransfer.files;
                }

                syncSelectedFiles(nextFiles);
              }}
            >
              <s-stack direction="block" gap="small">
                <s-text>Drag and drop one or more images here</s-text>
                <s-text tone="subdued">or use the picker below</s-text>
                <input
                  id="file"
                  name="file"
                  ref={inputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  required
                  onChange={(event) => {
                    const nextFiles = Array.from(
                      event.currentTarget.files ?? [],
                    );
                    syncSelectedFiles(nextFiles);
                  }}
                />
              </s-stack>
            </s-box>
            {fileError && <s-text tone="critical">{fileError}</s-text>}

            <s-box
              padding="base"
              border="base"
              borderRadius="base"
              background="bg-fill-secondary"
            >
              <s-stack direction="block" gap="small">
                <s-text fontWeight="semibold">Layer 2 — Light control</s-text>
                <s-text tone="subdued">
                  Choose a preset in plain language. You can run immediately
                  without touching advanced settings.
                </s-text>
                <label htmlFor="preset">Preset</label>
                <select
                  id="preset"
                  value={selectedPreset}
                  onChange={(event) =>
                    setSelectedPreset(event.currentTarget.value)
                  }
                >
                  {PRESET_OPTIONS.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <s-text tone="subdued">
                  {selectedPresetConfig.description}
                </s-text>
              </s-stack>
            </s-box>

            <input type="hidden" name="method" value={selectedMethod} />

            <details>
              <summary>
                <strong>Layer 3 — Power user (advanced)</strong>
              </summary>
              <s-box
                padding="base"
                border="base"
                borderRadius="base"
                style={{ marginTop: "12px" }}
              >
                <s-stack direction="block" gap="small">
                  <s-text tone="subdued">
                    Fine-tune crop strategy for repeatable workflows. Collapsed
                    by default to keep first-run setup simple.
                  </s-text>
                  <label>
                    <input
                      type="checkbox"
                      checked={advancedMethodOverrideEnabled}
                      onChange={(event) =>
                        setAdvancedMethodOverrideEnabled(
                          event.currentTarget.checked,
                        )
                      }
                    />{" "}
                    Override preset method
                  </label>
                  <label htmlFor="method">Crop method</label>
                  <select
                    id="method"
                    value={advancedMethod}
                    disabled={!advancedMethodOverrideEnabled}
                    onChange={(event) =>
                      setAdvancedMethod(event.currentTarget.value)
                    }
                  >
                    {CROP_METHODS.filter((method) =>
                      planUsage.allowsFaceDetection
                        ? true
                        : method.value === "auto",
                    ).map((method) => (
                      <option key={method.value} value={method.value}>
                        {method.value}
                      </option>
                    ))}
                  </select>

                  <label htmlFor="target_aspect_ratio">
                    Target aspect ratio
                  </label>
                  <input
                    id="target_aspect_ratio"
                    name="target_aspect_ratio"
                    type="text"
                    placeholder="e.g. 4:5 or 1.5"
                    value={targetAspectRatioInput}
                    onChange={(event) =>
                      setTargetAspectRatioInput(event.currentTarget.value)
                    }
                  />

                  <s-text tone="subdued">
                    Margins/padding (non-negative numbers)
                  </s-text>
                  <s-stack direction="inline" gap="small" wrap>
                    <input
                      name="margin_top"
                      aria-label="Top margin or padding"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Top"
                      value={marginTopInput}
                      onChange={(event) =>
                        setMarginTopInput(event.currentTarget.value)
                      }
                    />
                    <input
                      name="margin_right"
                      aria-label="Right margin or padding"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Right"
                      value={marginRightInput}
                      onChange={(event) =>
                        setMarginRightInput(event.currentTarget.value)
                      }
                    />
                    <input
                      name="margin_bottom"
                      aria-label="Bottom margin or padding"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Bottom"
                      value={marginBottomInput}
                      onChange={(event) =>
                        setMarginBottomInput(event.currentTarget.value)
                      }
                    />
                    <input
                      name="margin_left"
                      aria-label="Left margin or padding"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Left"
                      value={marginLeftInput}
                      onChange={(event) =>
                        setMarginLeftInput(event.currentTarget.value)
                      }
                    />
                  </s-stack>

                  <label htmlFor="anchor_hint">Anchor hint</label>
                  <select
                    id="anchor_hint"
                    name="anchor_hint"
                    value={anchorHintInput}
                    onChange={(event) =>
                      setAnchorHintInput(event.currentTarget.value)
                    }
                  >
                    {ANCHOR_HINT_OPTIONS.map((hint) => (
                      <option key={hint} value={hint}>
                        {hint}
                      </option>
                    ))}
                  </select>

                  <label htmlFor="filters">Optional filters</label>
                  <input
                    id="filters"
                    name="filters"
                    type="text"
                    placeholder="comma-separated: sharpen, detail, grayscale"
                    value={filtersInput}
                    onChange={(event) =>
                      setFiltersInput(event.currentTarget.value)
                    }
                  />

                  {advancedValidationError && (
                    <s-text tone="critical">{advancedValidationError}</s-text>
                  )}
                </s-stack>
              </s-box>
            </details>

            <s-box padding="base" border="base" borderRadius="base">
              <s-text fontWeight="semibold">Current crop strategy</s-text>
              {!planUsage.allowsFaceDetection && (
                <s-text tone="subdued">
                  Free plan requests are automatically processed with{" "}
                  <code>center_content</code>.
                </s-text>
              )}
              <s-text>
                <strong>{selectedMethodDetails.label}:</strong>{" "}
                {selectedMethodDetails.description}
              </s-text>
            </s-box>

            <s-button
              type="submit"
              disabled={
                !apiHealthy || !hasValidSelection || isSubmittingDownload
              }
              {...(isSubmittingDownload ? { loading: true } : {})}
            >
              Auto-crop images
            </s-button>

            {isSubmittingDownload && <s-text>Processing and streaming ZIP…</s-text>}
          </s-stack>
        </form>
      </s-section>

      <s-section heading="Selected images">
        {!selectedFiles.length && (
          <s-paragraph>Select one or more images to continue.</s-paragraph>
        )}
        {selectedFiles.length > 0 && (
          <>
            <table className="responsive-table">
              <thead>
                <tr>
                  <th align="left">Name</th>
                  <th align="left">Status</th>
                  <th align="left">MIME type</th>
                  <th align="right">Size (KB)</th>
                </tr>
              </thead>
              <tbody>
                {selectedFiles.map((file) => (
                  <tr key={`${file.name}-${file.sizeBytes}`}>
                    <td>{file.name}</td>
                    <td>Ready</td>
                    <td>{file.mimeType}</td>
                    <td align="right">{(file.sizeBytes / 1024).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="responsive-card-list">
              {selectedFiles.map((file) => (
                <div
                  key={`${file.name}-${file.sizeBytes}-card`}
                  className="responsive-card"
                >
                  <div className="responsive-card-primary">
                    <span className="responsive-card-name">{file.name}</span>
                    <span>{(file.sizeBytes / 1024).toFixed(1)} KB</span>
                    <span>Ready</span>
                  </div>
                  <div className="responsive-card-metadata">
                    <div className="responsive-card-row">
                      <span>MIME type</span>
                      <span>{file.mimeType}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {previewFile && (
          <s-stack direction="block" gap="small">
            <s-text fontWeight="semibold">Preview (first image only)</s-text>
            <s-text tone="subdued">{previewFile.name}</s-text>
            <img
              src={previewFile.src}
              alt={`Preview for ${previewFile.name}`}
              style={{ maxWidth: "320px", height: "auto", borderRadius: "8px" }}
            />
          </s-stack>
        )}
      </s-section>

      <s-section heading="Cropped output">
        <s-paragraph>Status: {apiStatusText}</s-paragraph>

        <s-stack direction="inline" gap="base">
          <s-button
            variant="secondary"
            onClick={() => {
              setSelectedFiles([]);
              syncPreviewFile([]);
              setFileError("");
              setSelectedPreset("auto");
              setAdvancedMethodOverrideEnabled(false);
              setAdvancedMethod("auto");
              setTargetAspectRatioInput("");
              setMarginTopInput("");
              setMarginRightInput("");
              setMarginBottomInput("");
              setMarginLeftInput("");
              setAnchorHintInput("auto");
              setFiltersInput("");
              setAdvancedValidationError("");
              inputRef.current?.form?.reset();
              inputRef.current?.focus();
            }}
          >
            Reset selection
          </s-button>
          <s-text tone="subdued">
            Downloads use a generated link once the FastAPI batch ZIP has been
            fully prepared.
          </s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
