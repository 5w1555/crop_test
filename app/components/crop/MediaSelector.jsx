/* eslint-disable react/prop-types */
import { useRef } from "react";

export default function MediaSelector({
  appOrigin,
  shopify,
  selectedUploadFiles,
  selectedShopifyMedia,
  fileError,
  onUploadFilesChange,
  onShopifyMediaChange,
  onError,
  showToast,
  buildEmbeddedRequestQueryString,
}) {
  const inputRef = useRef(null);

  const handleUploadChange = (event) => {
    const files = Array.from(event.currentTarget.files ?? []);
    onError("");
    onShopifyMediaChange([]);
    onUploadFilesChange(files);
  };

  const handlePickShopifyMedia = async () => {
    if (!shopify) {
      onError("Shopify App Bridge is unavailable.");
      return;
    }

    try {
      let pickerResult = [];
      if (typeof shopify.mediaPicker === "function") {
        pickerResult = await shopify.mediaPicker({ allowMultiple: true, type: ["image"] });
      } else if (typeof shopify.resourcePicker === "function") {
        pickerResult = await shopify.resourcePicker({ type: "product", action: "select", multiple: true });
      }

      const pickedItems = Array.isArray(pickerResult)
        ? pickerResult
        : Array.isArray(pickerResult?.selection)
          ? pickerResult.selection
          : [];

      const mediaIds = [];
      const productIds = [];
      pickedItems.forEach((item) => {
        if (item?.id && String(item.id).includes("MediaImage")) mediaIds.push(String(item.id));
        if (item?.id && String(item.id).includes("Product")) productIds.push(String(item.id));
        if (Array.isArray(item?.media)) {
          item.media.forEach((media) => {
            if (media?.id && String(media.id).includes("MediaImage")) mediaIds.push(String(media.id));
          });
        }
      });

      if (!mediaIds.length && !productIds.length) {
        showToast("No images selected.");
        return;
      }

      const idToken = await shopify.idToken();
      const response = await fetch(
        `${appOrigin}/app/additional/media/resolve${buildEmbeddedRequestQueryString(
          typeof window === "undefined" ? "" : window.location.search,
          idToken,
        )}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ mediaIds, productIds }),
        },
      );

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to resolve selected media.");
      }

      onUploadFilesChange([]);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
      onError("");
      onShopifyMediaChange(Array.isArray(payload?.media) ? payload.media : []);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to select Shopify media.");
    }
  };

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack direction="block" gap="small">
        <s-text fontWeight="semibold">1) Select media</s-text>
        <s-stack direction="inline" gap="small">
          <s-button type="button" onClick={handlePickShopifyMedia}>Select from Shopify</s-button>
          <input
            ref={inputRef}
            id="file"
            name="file"
            type="file"
            multiple
            accept="image/*"
            onChange={handleUploadChange}
          />
        </s-stack>
        {selectedUploadFiles.length > 0 && <s-text>{selectedUploadFiles.length} uploaded image(s) selected.</s-text>}
        {selectedShopifyMedia.length > 0 && <s-text>{selectedShopifyMedia.length} Shopify media item(s) selected.</s-text>}
        {fileError && <s-text tone="critical">{fileError}</s-text>}
      </s-stack>
    </s-box>
  );
}
