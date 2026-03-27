import { data } from "react-router";
import CropControlCenter from "../components/CropControlCenter.jsx";
import { cropImagesWithOutputs } from "../lib/crop/client.server.js";
import { authenticate } from "../shopify.server";
import { isPreviewRequest } from "../lib/shopify-auth.server";

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
  const uploadedFiles = formData.getAll("file");
  console.log("file type:", uploadedFiles[0]?.constructor?.name, typeof uploadedFiles[0]);

  console.log(`=== ACTION (/app/crop): cropping ${uploadedFiles.length} file(s) ===`);

  try {
    const outputs = await cropImagesWithOutputs(uploadedFiles, {
      method: "auto",
      pipeline: "auto",
    });

    console.log("=== ACTION SUCCESS ===", { count: outputs.length });
    return data({ status: "succeeded", mediaUpdates: outputs });
  } catch (err) {
    console.error("=== ACTION FAILED ===", err);
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
