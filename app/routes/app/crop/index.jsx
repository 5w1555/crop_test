import { authenticate } from "../../../shopify.server";
import { json } from "react-router";  // ← correct import for your 2026 template
import { cropImagesWithOutputs } from "../../../lib/crop/client.server.js";

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
    return json({ status: "succeeded", mediaUpdates: outputs });
  } catch (err) {
    console.error("=== ACTION FAILED ===", err);
    return json({ error: err.message || "Crop failed" }, { status: 500 });
  }
};

export default function CropRoute() {
  return null; // this route is ONLY for the action — never shows UI
}