import { json } from "@remix-run/node";
import { authenticate } from "../../../shopify.server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { cropImagesWithOutputs } from "../../../lib/crop/client.server.js";

export const loader = async () => ({});

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const uploadedFiles = formData.getAll("file");

  console.log(`=== ACTION: cropping ${uploadedFiles.length} file(s) ===`);

  try {
    const outputs = await cropImagesWithOutputs(uploadedFiles, { method: "auto", pipeline: "auto" });
    console.log("=== ACTION SUCCESS ===", { count: outputs.length });
    return json({ status: "succeeded", mediaUpdates: outputs });
  } catch (err) {
    console.error("=== ACTION FAILED ===", err);
    return json({ error: err.message || "Crop failed" }, { status: 500 });
  }
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

    try {
      const response = await shopify.fetch("/app/crop", { method: "POST", body: form });
      const data = await response.json();

      if (response.ok) {
        setResult(data);
        alert("✅ Crop successful! Preview below.");
      } else {
        alert("❌ Error: " + (data.error || "Try again"));
      }
    } catch (err) {
      alert("Network error — check console");
      console.error(err);
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
          <s-button variant="primary" onClick={handleSubmit} disabled={loading || !files.length}>
            {loading ? "Cropping..." : "Start Crop"}
          </s-button>
        </s-card>

        {result && (
          <s-card>
            <s-heading>3. Result</s-heading>
            {result.mediaUpdates?.[0]?.croppedBase64 ? (
              <>
                <img 
                  src={result.mediaUpdates[0].croppedBase64} 
                  alt="cropped" 
                  style={{ maxWidth: "100%", borderRadius: "8px" }} 
                />
                <a href={result.mediaUpdates[0].croppedBase64} download="cropped.jpg">
                  Download cropped image
                </a>
              </>
            ) : (
              <p>No cropped image returned — check logs.</p>
            )}
          </s-card>
        )}
      </s-stack>
    </s-page>
  );
}