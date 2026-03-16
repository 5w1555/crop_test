// app/lib/shopifyMedia.server.js

function normalizeMediaIds(mediaIds = []) {
  return Array.from(
    new Set(
      mediaIds
        .map((mediaId) => String(mediaId || "").trim())
        .filter(Boolean),
    ),
  );
}

async function safeGraphQL(admin, query, variables = {}) {
  const response = await admin.graphql(query, { variables });

  if (!response.ok) {
    const text = await response.text();
    console.error("Shopify GraphQL HTTP error:", response.status, text.substring(0, 300));
    throw new Error(`GraphQL HTTP error ${response.status}`);
  }

  const payload = await response.json();

  if (payload.errors?.length) {
    console.error("GraphQL errors:", payload.errors);
    throw new Error(payload.errors[0].message);
  }

  return payload.data;
}

const SHOPIFY_PRODUCT_QUERY = `#graphql
  query ResolveProducts($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on Product {
        id
        title
        media(first: 250) {
          nodes {
            __typename
            ... on MediaImage {
              id
              image { url }
            }
          }
        }
      }
    }
  }
`;

const SHOPIFY_MEDIA_QUERY = `#graphql
  query ResolveMedia($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on MediaImage {
        id
        image { url }
        # product field was removed by Shopify in 2025+
      }
    }
  }
`;

export async function resolveSelectedMedia({ admin, mediaIds = [], productIds = [] }) {
  const normalizedMediaIds = normalizeMediaIds(mediaIds);
  const normalizedProductIds = normalizeMediaIds(productIds);

  if (!normalizedMediaIds.length && !normalizedProductIds.length) {
    return { media: [], invalidMediaIds: [] };
  }

  const media = [];
  const invalidMediaIds = [];
  const seen = new Set();

  // 1. Products + their attached media (has product context)
  if (normalizedProductIds.length) {
    const data = await safeGraphQL(admin, SHOPIFY_PRODUCT_QUERY, { ids: normalizedProductIds });
    const nodes = data?.nodes || [];

    nodes.forEach((node) => {
      if (node?.__typename !== "Product") return;

      const productMedia = node.media?.nodes || [];
      productMedia.forEach((m) => {
        if (m?.__typename === "MediaImage" && m.image?.url && !seen.has(m.id)) {
          seen.add(m.id);
          media.push({
            mediaId: m.id,
            sourceUrl: m.image.url,
            productId: node.id,
            productTitle: node.title || "",
          });
        }
      });
    });
  }
  
  if (normalizedMediaIds.length) {
    const data = await safeGraphQL(admin, SHOPIFY_MEDIA_QUERY, { ids: normalizedMediaIds });
    const nodes = data?.nodes || [];

    nodes.forEach((node) => {
      if (node?.__typename === "MediaImage" && node.image?.url && !seen.has(node.id)) {
        seen.add(node.id);
        media.push({
          mediaId: node.id,
          sourceUrl: node.image.url,
          productId: null,     
          productTitle: "",
        });
      }
    });
  }

  normalizedMediaIds.forEach((id) => {
    if (!seen.has(id)) invalidMediaIds.push(id);
  });

  console.log(`✅ Resolved ${media.length} media items | ${invalidMediaIds.length} invalid`);
  return { media, invalidMediaIds };
}

function deriveFilenameFromUrl(url, fallbackIndex) {
  try {
    const pathname = new URL(url).pathname;
    const candidate = pathname.split("/").filter(Boolean).pop();
    if (candidate) return candidate;
  } catch {}
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
      new File([blob], filename, { type: blob.type || "image/jpeg" })
    );
  }

  return files;
}