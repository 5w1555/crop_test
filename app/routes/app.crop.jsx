import { data } from "react-router";
import CropControlCenter from "../components/CropControlCenter.jsx";
import { cropImagesWithOutputs } from "../lib/crop/client.server.js";
import { authenticate } from "../shopify.server";
import { isPreviewRequest } from "../lib/shopify-auth.server";

function parseOptionalNumber(value) {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getFilenameFromUrl(imageUrl, contentType) {
  try {
    const pathname = new URL(imageUrl).pathname;
    const name = pathname.split("/").pop();
    if (name) return name;
  } catch {
    // no-op
  }

  if (contentType?.includes("png")) return "shopify-image.png";
  if (contentType?.includes("webp")) return "shopify-image.webp";
  return "shopify-image.jpg";
}

export const loader = async ({ request }) => {
  if (!isPreviewRequest(request)) {
    await authenticate.admin(request);
  }

  return {};
};

export const action = async ({ request }) => {
  if (!isPreviewRequest(request)) {
    await authenticate.admin(request);
  }

  const formData = await request.formData();
  const uploadedFiles = formData.getAll("file").filter((item) => item instanceof Blob);
  const imageUrl = (formData.get("imageUrl") || "").toString().trim();

  const filesToCrop = [...uploadedFiles];

  if (imageUrl) {
    const imageResponse = await fetch(imageUrl);

    if (!imageResponse.ok) {
      return data(
        {
          error: `Failed to fetch image from imageUrl (HTTP ${imageResponse.status})`,
          errorCode: "IMAGE_URL_FETCH_FAILED",
          errorDetails: imageUrl,
        },
        { status: 400 },
      );
    }

    const contentType = imageResponse.headers.get("content-type") || "application/octet-stream";
    const imageBlob = await imageResponse.blob();
    const normalizedBlob = new Blob([imageBlob], { type: contentType });

    filesToCrop.push(
      new File([normalizedBlob], getFilenameFromUrl(imageUrl, contentType), {
        type: contentType,
      }),
    );
  }

  if (!filesToCrop.length) {
    return data(
      {
        error: "No images supplied. Upload a file or provide imageUrl.",
        errorCode: "NO_IMAGES",
      },
      { status: 400 },
    );
  }

  const cropOptions = {
    method: (formData.get("method") || "auto").toString(),
    pipeline: "auto",
    targetAspectRatio: parseOptionalNumber(formData.get("targetAspectRatio")),
    marginTop: parseOptionalNumber(formData.get("marginTop")),
    marginRight: parseOptionalNumber(formData.get("marginRight")),
    marginBottom: parseOptionalNumber(formData.get("marginBottom")),
    marginLeft: parseOptionalNumber(formData.get("marginLeft")),
  };

  try {
    const outputs = await cropImagesWithOutputs(filesToCrop, cropOptions);
    return data({ status: "succeeded", mediaUpdates: outputs });
  } catch (err) {
    return data(
      {
        error: err.message || "Crop failed",
        errorCode: err.code || null,
        errorDetails: err.details || null,
      },
      { status: 500 },
    );
  }
};

export default function CropRoute() {
  return <CropControlCenter />;
}
