import { authenticate } from "../../../shopify.server";
import { data } from "react-router";
import { cropImagesWithOutputs } from "../../../lib/crop/client.server.js";
import CropControlCenter from "../../../components/CropControlCenter.jsx";

export const loader = async () => ({}); // empty loader (or you can redirect("/app") if you want)

export const action = async ({ request }) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const uploadedFiles = formData.getAll("file");

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
    return data({
      error: err.message || "Crop failed",
      errorCode: err.code || null,
      errorDetails: err.details || null,
    }, { status: 500 });
  }
};

export default function CropRoute() {
  return <CropControlCenter />;
}
