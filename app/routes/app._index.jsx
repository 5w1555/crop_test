import { useFetcher } from "react-router";   // ← THIS is the correct v7 import
import { useState, useCallback, useEffect } from "react";

export default function CropPage() {
  const fetcher = useFetcher();
  const [files, setFiles] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!files.length) return alert("Select at least one image");

    setLoading(true);
    const form = new FormData();
    files.forEach((f) => form.append("file", f));

    fetcher.submit(form, { method: "POST", action: "/app/crop" });
  }, [files, fetcher]);

  // Handle response when it arrives (safe way)
  useEffect(() => {
    if (fetcher.data) {
      const data = fetcher.data;
      setResult(data);
      setLoading(false);

      if (data.error) {
        alert("❌ Error: " + (data.error || "Try again"));
      } else {
        alert("✅ Crop successful! Preview below.");
      }
    }
  }, [fetcher.data]);

  return (
    <s-page heading="Smart Crop — Minimal Version">
      <s-stack gap="base">
        <s-card>
          <s-heading>1. Select images</s-heading>
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={(e) => setFiles(Array.from(e.target.files))}
          />
        </s-card>

        <s-card>
          <s-heading>2. Click to crop</s-heading>
          <s-button
            variant="primary"
            onClick={handleSubmit}
            disabled={loading || !files.length || fetcher.state === "submitting"}
          >
            {loading || fetcher.state === "submitting" ? "Cropping..." : "Start Crop"}
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
                <a
                  href={result.mediaUpdates[0].croppedBase64}
                  download="cropped.jpg"
                >
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