function normalizeMediaIds(mediaIds = []) {
  return Array.from(
    new Set(
      mediaIds
        .map((mediaId) => String(mediaId || "").trim())
        .filter(Boolean),
    ),
  );
}

const SHOPIFY_MEDIA_QUERY = `#graphql
  query ResolveSelectedMedia($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on MediaImage {
        id
        image {
          url
        }
        product {
          id
          title
        }
      }
    }
  }
`;

export async function resolveSelectedMedia({ admin, mediaIds }) {
  const normalizedMediaIds = normalizeMediaIds(mediaIds);
  if (!normalizedMediaIds.length) {
    return {
      media: [],
      invalidMediaIds: [],
    };
  }

  const response = await admin.graphql(SHOPIFY_MEDIA_QUERY, {
    variables: { ids: normalizedMediaIds },
  });
  const payload = await response.json();
  const nodes = Array.isArray(payload?.data?.nodes) ? payload.data.nodes : [];

  const media = [];
  const invalidMediaIds = [];

  normalizedMediaIds.forEach((mediaId, index) => {
    const node = nodes[index];
    if (
      !node ||
      node.__typename !== "MediaImage" ||
      !node.image?.url ||
      !node.product?.id
    ) {
      invalidMediaIds.push(mediaId);
      return;
    }

    media.push({
      mediaId: node.id,
      sourceUrl: node.image.url,
      productId: node.product.id,
      productTitle: node.product.title || "",
    });
  });

  return {
    media,
    invalidMediaIds,
  };
}

function deriveFilenameFromUrl(url, fallbackIndex) {
  try {
    const pathname = new URL(url).pathname;
    const candidate = pathname.split("/").filter(Boolean).pop();
    if (candidate) {
      return candidate;
    }
  } catch {
    // noop
  }

  return `media-${fallbackIndex + 1}.jpg`;
}

export async function buildFilesFromMediaSources(media = []) {
  const files = [];

  for (const [index, item] of media.entries()) {
    const response = await fetch(item.sourceUrl);
    if (!response.ok) {
      throw new Error(`Unable to download selected media ${item.mediaId}.`);
    }

    const blob = await response.blob();
    const filename = deriveFilenameFromUrl(item.sourceUrl, index);
    files.push(
      new File([blob], filename, {
        type: blob.type || "image/jpeg",
      }),
    );
  }

  return files;
}
