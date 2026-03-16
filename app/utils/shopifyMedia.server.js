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
      ... on Product {
        id
        title
        media(first: 250) {
          nodes {
            __typename
            ... on MediaImage {
              id
              image {
                url
              }
            }
          }
        }
      }
    }
  }
`;

export async function resolveSelectedMedia({ admin, mediaIds, productIds }) {
  const normalizedMediaIds = normalizeMediaIds(mediaIds);
  const normalizedProductIds = normalizeMediaIds(productIds);
  const queryIds = normalizeMediaIds([...normalizedMediaIds, ...normalizedProductIds]);

  if (!queryIds.length) {
    return {
      media: [],
      invalidMediaIds: [],
    };
  }

  const response = await admin.graphql(SHOPIFY_MEDIA_QUERY, {
    variables: { ids: queryIds },
  });
  const payload = await response.json();
  const nodes = Array.isArray(payload?.data?.nodes) ? payload.data.nodes : [];
  const nodesById = new Map();
  queryIds.forEach((id, index) => {
    nodesById.set(id, nodes[index] || null);
  });

  const media = [];
  const invalidMediaIds = [];
  const seenMediaIds = new Set();

  const appendMediaNode = (node, fallbackProduct) => {
    if (
      !node ||
      node.__typename !== "MediaImage" ||
      !node.id ||
      !node.image?.url
    ) {
      return false;
    }

    const resolvedProduct = node.product?.id ? node.product : fallbackProduct;
    if (!resolvedProduct?.id) {
      return false;
    }

    if (seenMediaIds.has(node.id)) {
      return true;
    }

    seenMediaIds.add(node.id);
    media.push({
      mediaId: node.id,
      sourceUrl: node.image.url,
      productId: resolvedProduct.id,
      productTitle: resolvedProduct.title || "",
    });
    return true;
  };

  normalizedProductIds.forEach((productId) => {
    const node = nodesById.get(productId);
    if (node?.__typename !== "Product") {
      return;
    }

    const productMediaNodes = Array.isArray(node?.media?.nodes)
      ? node.media.nodes
      : [];
    productMediaNodes.forEach((mediaNode) => {
      appendMediaNode(mediaNode, { id: node.id, title: node.title || "" });
    });
  });

  normalizedMediaIds.forEach((mediaId) => {
    const node = nodesById.get(mediaId);
    appendMediaNode(node, null);
  });

  normalizedMediaIds.forEach((mediaId) => {
    if (!seenMediaIds.has(mediaId)) invalidMediaIds.push(mediaId);
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
