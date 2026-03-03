import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { PLAN_CONFIG, buildPlanView } from "../utils/plan.js";
import { commitPlanUsage, getShopPlanUsage, reservePlanCapacity } from "../utils/plan.server.js";
import { cropImages, health } from "../utils/smartCropClient";
import { getBillingState } from "../utils/billing.server";
import { PRO_PLAN } from "../utils/billing";
import { prepareDownloadFromResponse, takePreparedDownload } from "../utils/preparedDownloads.server";

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
    description: "Anchors composition just below the lips for tighter portrait crops.",
  },
];

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
  const url = new URL(request.url);
  const downloadToken = url.searchParams.get("download");

  if (downloadToken) {
    const preparedDownload = takePreparedDownload(downloadToken);

    if (!preparedDownload) {
      return new Response("Download link is invalid or expired.", { status: 410 });
    }

    const response = new Response(preparedDownload.stream, {
      status: 200,
      headers: {
        "content-type": preparedDownload.mimeType,
        "content-disposition": `attachment; filename="${preparedDownload.filename}"`,
      },
    });

    response.headers.set("cache-control", "no-store");

    return response;
  }

  const { session, admin, billing } = await authenticate.admin(request);
  const apiHealthy = await health();
  const billingState = await getBillingState({ billing });

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
  const products = productsJson.data?.products?.nodes || [];

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
  };
};

export const action = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);

  const formData = await request.formData();
  const files = formData.getAll("file");

  if (!files.length) return { error: "Please upload at least one image." };

  for (const file of files) {
    const fileError = validateImageFile(file);
    if (fileError) {
      return { error: `${file instanceof File ? file.name : "File"}: ${fileError}` };
    }
  }

  const method = String(formData.get("method") || "auto");
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
    const response = await cropImages(files, { method: planReservation.effectiveMethod });
    const mimeType = response.headers.get("content-type") || "application/octet-stream";
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

    const prepared = await prepareDownloadFromResponse(response);
    return Response.json({
      ok: true,
      filename: prepared.filename,
      downloadUrl: `/app/additional?download=${prepared.token}`,
      expiresInSeconds: prepared.expiresInSeconds,
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
  const { apiHealthy, planUsage, hasActiveProPlan, products } = useLoaderData();
  const cropFetcher = useFetcher();
  const shopify = useAppBridge();

  const inputRef = useRef(null);
  const previewUrlRef = useRef("");
  const [fileError, setFileError] = useState("");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previewFile, setPreviewFile] = useState(null);
  const [selectedMethod, setSelectedMethod] = useState("auto");
  const [isDragActive, setIsDragActive] = useState(false);
  const [isSubmittingDownload, setIsSubmittingDownload] = useState(false);
  const [downloadLink, setDownloadLink] = useState("");

  useEffect(() => {
    if (cropFetcher.state !== "idle") {
      setIsSubmittingDownload(true);
      return;
    }

    setIsSubmittingDownload(false);

    if (!cropFetcher.data) {
      return;
    }

    if (!cropFetcher.data.ok || !cropFetcher.data.downloadUrl) {
      shopify.toast.show(cropFetcher.data.error || "Unable to prepare download link.", {
        isError: true,
      });
      return;
    }

    setDownloadLink(cropFetcher.data.downloadUrl);
    shopify.toast.show(
      `Download is ready${cropFetcher.data.filename ? `: ${cropFetcher.data.filename}` : ""}`,
    );
  }, [cropFetcher.data, cropFetcher.state, shopify.toast]);

  const apiStatusText = useMemo(() => {
    if (apiHealthy) return "Connected";
    return "FastAPI service is unreachable";
  }, [apiHealthy]);

  const loadingText = useMemo(() => {
    if (!isSubmittingDownload) return "";

    if (isSubmittingDownload) {
      return "Uploading…";
    }
  }, [isSubmittingDownload]);

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

  const handleDownloadSubmit = async (event) => {
    event.preventDefault();

    if (!hasValidSelection) {
      if (fileError) {
        shopify.toast.show(fileError, { isError: true });
      }
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);

    setDownloadLink("");
    shopify.toast.show("Cropping started. Preparing direct download link...");

    cropFetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  };

  return (
    <s-page heading="Crop Images">
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
            Usage this month: {planUsage.imagesProcessed}/{planUsage.monthlyImageLimit} images
          </s-text>
          <s-text>
            Remaining this month: {planUsage.remaining} images
          </s-text>
          {!planUsage.allowsFaceDetection && (
            <s-banner tone="info">
              Free plan uses content-aware crop only ({" "}
              <code>center_content</code>). Face detection methods are available on the {PLAN_CONFIG.pro.label} plan (€{PLAN_CONFIG.pro.monthlyPriceEur}/month).
            </s-banner>
          )}
          {!hasActiveProPlan && (
            <s-text>
              To activate {PRO_PLAN}, open <s-link href="/app/billing">Billing</s-link> and approve the Shopify app subscription.
            </s-text>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Shopify product context">
        <s-paragraph>
          Latest products from your catalog are shown below so you can quickly verify which assets should be exported and cropped.
        </s-paragraph>
        {!products.length && <s-text tone="subdued">No products found yet.</s-text>}
        {products.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Title</th>
                <th align="left">Handle</th>
                <th align="right">Inventory</th>
                <th align="left">Featured image</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>{product.title}</td>
                  <td>{product.handle}</td>
                  <td align="right">{product.totalInventory ?? 0}</td>
                  <td>
                    {product.featuredMedia?.preview?.image ? (
                      <a href={product.featuredMedia.preview.image.url} target="_blank" rel="noreferrer">
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
        )}
      </s-section>

      <s-section heading="1) Upload and configure">
        <s-paragraph>
          Upload one or more images, choose one of the crop methods implemented by
          <code> fastapi_service/main.py </code>, and run Smart Crop.
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
                    const nextFiles = Array.from(event.currentTarget.files ?? []);
                    syncSelectedFiles(nextFiles);
                  }}
                />
              </s-stack>
            </s-box>
            {fileError && <s-text tone="critical">{fileError}</s-text>}

            <label htmlFor="method">Crop method</label>
            <select
              id="method"
              name="method"
              value={selectedMethod}
              onChange={(event) => setSelectedMethod(event.currentTarget.value)}
            >
              {CROP_METHODS.filter((method) =>
                planUsage.allowsFaceDetection ? true : method.value === "auto",
              ).map((method) => (
                <option key={method.value} value={method.value}>
                  {method.value}
                </option>
              ))}
            </select>

            <s-box padding="base" border="base" borderRadius="base">
              <s-text fontWeight="semibold">Method details</s-text>
              {!planUsage.allowsFaceDetection && (
                <s-text tone="subdued">
                  Free plan requests are automatically processed with <code>center_content</code>.
                </s-text>
              )}
              <s-stack direction="block" gap="small">
                {CROP_METHODS.map((method) => (
                  <s-text
                    key={method.value}
                    tone={selectedMethod === method.value ? "success" : "subdued"}
                  >
                    <strong>{method.label}:</strong> {method.description}
                  </s-text>
                ))}
              </s-stack>
            </s-box>

            <s-button
              type="submit"
              disabled={!apiHealthy || !hasValidSelection || isSubmittingDownload}
              {...(isSubmittingDownload ? { loading: true } : {})}
            >
              Crop images
            </s-button>

            {loadingText && <s-text>{loadingText}</s-text>}
          </s-stack>
        </form>

        {downloadLink && (
          <s-banner tone="success">
            Your ZIP is ready. Click to download the complete processed batch.
            <a href={downloadLink} style={{ marginLeft: "8px" }} download>
              Download now
            </a>
          </s-banner>
        )}
      </s-section>

      <s-section heading="2) Selected images">
        {!selectedFiles.length && <s-paragraph>Select one or more images to continue.</s-paragraph>}
        {selectedFiles.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Name</th>
                <th align="left">MIME type</th>
                <th align="right">Size (KB)</th>
              </tr>
            </thead>
            <tbody>
              {selectedFiles.map((file) => (
                <tr key={`${file.name}-${file.sizeBytes}`}>
                  <td>{file.name}</td>
                  <td>{file.mimeType}</td>
                  <td align="right">{(file.sizeBytes / 1024).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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

      <s-section heading="3) Cropped output">
        <s-paragraph>Status: {apiStatusText}</s-paragraph>

        <s-stack direction="inline" gap="base">
          <s-button
            variant="secondary"
            onClick={() => {
              setSelectedFiles([]);
              syncPreviewFile([]);
              setFileError("");
              setSelectedMethod("auto");
              inputRef.current?.form?.reset();
              inputRef.current?.focus();
            }}
          >
            Reset selection
          </s-button>
          <s-text tone="subdued">Downloads use a generated link once the FastAPI batch ZIP has been fully prepared.</s-text>
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
