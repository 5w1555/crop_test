import { useAppBridge } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { json } from "@remix-run/node";
import { authenticate } from "../../../shopify.server";
import { cropImagesWithOutputs } from "../../../lib/crop/client.server.js";

export const loader = async () => ({});

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  void session;
  void admin;
  const formData = await request.formData();
  const uploadedFiles = formData.getAll("file");

  const outputs = await cropImagesWithOutputs(uploadedFiles, { method: "auto", pipeline: "auto" });

  return json({
    status: "succeeded",
    mediaUpdates: outputs,
  });
};

export default function CropPage() {
  const shopify = useAppBridge();
  const [files, setFiles] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!files.length) return alert("Select at least one image");

    setLoading(true);
    const form = new FormData();
    files.forEach((f) => form.append("file", f));

    const response = await shopify.fetch("/app/crop", { method: "POST", body: form });
    const data = await response.json();

    if (response.ok) {
      setResult(data);
      alert("Crop successful! Preview below.");
    } else {
      alert("Error: " + (data.error || "Try again"));
    }
    setLoading(false);
  }, [files, shopify]);

  return (
    <s-page heading="Smart Crop — Minimal Version">
      <s-stack gap="base">
        <s-card>
          <s-heading>1. Select images</s-heading>
          <input type="file" multiple accept="image/*" onChange={(e) => setFiles(Array.from(e.target.files))} />
        </s-card>

        <s-card>
          <s-heading>2. Click to crop</s-heading>
          <s-button variant="primary" onClick={handleSubmit} disabled={loading}>
            {loading ? "Cropping..." : "Start Crop"}
          </s-button>
        </s-card>

        {result && (
          <s-card>
            <s-heading>3. Result</s-heading>
            <img src={result.mediaUpdates[0]?.croppedBase64 || ""} alt="cropped" style={{ maxWidth: "100%" }} />
            <a href={result.mediaUpdates[0]?.croppedBase64} download>
              Download
            </a>
          </s-card>
        )}
      </s-stack>
    </s-page>
  );
}
