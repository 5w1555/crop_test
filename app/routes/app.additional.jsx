import { useEffect, useMemo } from "react";
import {
  useFetcher,
  useLoaderData,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { cropImage, health } from "../utils/smartCropClient";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const apiHealthy = await health();
  return { apiHealthy };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return { error: "Please upload an image." };
  }

  const method = formData.get("method") || "auto";

  try {
    const response = await cropImage(file, { method });

    const mimeType = response.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await response.arrayBuffer());
    const imageDataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

    return {
      imageDataUrl,
      mimeType,
      method,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to crop image. Check the FastAPI service.",
    };
  }
};

export default function AdditionalPage() {
  const { apiHealthy } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.imageDataUrl) {
      shopify.toast.show("Image cropped successfully");
    }

    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const apiStatusText = useMemo(() => {
    if (apiHealthy) return "Connected";
    return "FastAPI service is unreachable";
  }, [apiHealthy]);

  return (
    <s-page heading="Smart Crop">
      <s-section heading="Crop an image with FastAPI">
        <s-paragraph>
          Upload an image, select a crop method from <code>main.py</code>, and
          preview/download the result.
        </s-paragraph>

        <fetcher.Form method="post" encType="multipart/form-data">
          <s-stack direction="block" gap="base">
            <label htmlFor="file">Image file</label>
            <input id="file" name="file" type="file" accept="image/*" required />

            <label htmlFor="method">Crop method</label>
            <select id="method" name="method" defaultValue="auto">
              <option value="auto">auto</option>
              <option value="head_bust">head_bust</option>
              <option value="frontal">frontal</option>
              <option value="profile">profile</option>
              <option value="chin">chin</option>
              <option value="nose">nose</option>
              <option value="below_lips">below_lips</option>
            </select>

            <s-button type="submit" {...(isLoading ? { loading: true } : {})}>
              Crop image
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="Result">
        <s-paragraph>Status: {apiStatusText}</s-paragraph>

        {fetcher.data?.error && (
          <s-banner tone="critical">{fetcher.data.error}</s-banner>
        )}

        {fetcher.data?.imageDataUrl && (
          <s-stack direction="block" gap="base">
            <img
              src={fetcher.data.imageDataUrl}
              alt="Cropped output"
              style={{ maxWidth: "100%", borderRadius: 8 }}
            />
            <a href={fetcher.data.imageDataUrl} download="cropped.png">
              Download result
            </a>
          </s-stack>
        )}
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
