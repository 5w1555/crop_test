import { data } from "react-router";
import { authenticate } from "../shopify.server";
import { isPreviewRequest } from "../lib/shopify-auth.server";

const PRODUCT_SEARCH_QUERY = `#graphql
  query ProductSearch($query: String!, $first: Int!) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          featuredImage {
            url
          }
          images(first: 10) {
            edges {
              node {
                url
              }
            }
          }
        }
      }
    }
  }
`;

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const term = (url.searchParams.get("q") || "").trim();

  if (!term) {
    return data({ products: [] });
  }

  if (isPreviewRequest(request)) {
    return data({ products: [] });
  }

  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(PRODUCT_SEARCH_QUERY, {
    variables: {
      query: `title:*${term.replace(/"/g, "") }*`,
      first: 20,
    },
  });

  const payload = await response.json();

  if (payload?.errors?.length) {
    return data({ products: [], errors: payload.errors }, { status: 502 });
  }

  const edges = payload?.data?.products?.edges || [];

  const products = edges
    .map(({ node }) => {
      const urls = [
        node?.featuredImage?.url,
        ...(node?.images?.edges || []).map((imgEdge) => imgEdge?.node?.url),
      ].filter(Boolean);

      const imageUrls = Array.from(new Set(urls));

      return {
        id: node?.id,
        title: node?.title,
        imageUrls,
      };
    })
    .filter((product) => product.title && product.imageUrls.length > 0);

  return data({ products });
};
