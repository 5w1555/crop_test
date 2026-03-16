import test from "node:test";
import assert from "node:assert/strict";

import { resolveSelectedMedia } from "./shopifyMedia.server.js";

test("resolveSelectedMedia resolves media IDs through selected products", async () => {
  const graphqlCalls = [];
  const admin = {
    graphql: async (_query, { variables }) => {
      graphqlCalls.push(variables.ids);
      return {
        json: async () => ({
          data: {
            nodes: [
              {
                __typename: "MediaImage",
                id: "gid://shopify/MediaImage/10",
                image: { url: "https://cdn.example.com/10.jpg" },
                product: {
                  id: "gid://shopify/Product/1",
                  title: "Hat",
                },
              },
              {
                __typename: "Product",
                id: "gid://shopify/Product/1",
                title: "Hat",
                media: {
                  nodes: [
                    {
                      __typename: "MediaImage",
                      id: "gid://shopify/MediaImage/10",
                      image: { url: "https://cdn.example.com/10.jpg" },
                    },
                  ],
                },
              },
            ],
          },
        }),
      };
    },
  };

  const resolved = await resolveSelectedMedia({
    admin,
    mediaIds: ["gid://shopify/MediaImage/10"],
    productIds: ["gid://shopify/Product/1"],
  });

  assert.deepEqual(graphqlCalls, [["gid://shopify/MediaImage/10", "gid://shopify/Product/1"]]);
  assert.deepEqual(resolved.invalidMediaIds, []);
  assert.deepEqual(resolved.media, [
    {
      mediaId: "gid://shopify/MediaImage/10",
      sourceUrl: "https://cdn.example.com/10.jpg",
      productId: "gid://shopify/Product/1",
      productTitle: "Hat",
    },
  ]);
});

test("resolveSelectedMedia expands product selections into media images", async () => {
  const admin = {
    graphql: async () => ({
      json: async () => ({
        data: {
          nodes: [
            {
              __typename: "Product",
              id: "gid://shopify/Product/1",
              title: "Shirt",
              media: {
                nodes: [
                  {
                    __typename: "MediaImage",
                    id: "gid://shopify/MediaImage/11",
                    image: { url: "https://cdn.example.com/11.jpg" },
                  },
                  {
                    __typename: "ExternalVideo",
                    id: "gid://shopify/ExternalVideo/5",
                  },
                ],
              },
            },
          ],
        },
      }),
    }),
  };

  const resolved = await resolveSelectedMedia({
    admin,
    mediaIds: [],
    productIds: ["gid://shopify/Product/1"],
  });

  assert.deepEqual(resolved.invalidMediaIds, []);
  assert.deepEqual(resolved.media, [
    {
      mediaId: "gid://shopify/MediaImage/11",
      sourceUrl: "https://cdn.example.com/11.jpg",
      productId: "gid://shopify/Product/1",
      productTitle: "Shirt",
    },
  ]);
});


test("resolveSelectedMedia marks direct media IDs invalid without selected products", async () => {
  const admin = {
    graphql: async () => ({
      json: async () => ({
        data: {
          nodes: [null],
        },
      }),
    }),
  };

  const resolved = await resolveSelectedMedia({
    admin,
    mediaIds: ["gid://shopify/MediaImage/404"],
    productIds: [],
  });

  assert.deepEqual(resolved.media, []);
  assert.deepEqual(resolved.invalidMediaIds, ["gid://shopify/MediaImage/404"]);
});

test("resolveSelectedMedia resolves direct media IDs when media node is returned", async () => {
  const admin = {
    graphql: async () => ({
      json: async () => ({
        data: {
          nodes: [
            {
              __typename: "MediaImage",
              id: "gid://shopify/MediaImage/22",
              image: { url: "https://cdn.example.com/22.jpg" },
              product: {
                id: "gid://shopify/Product/2",
                title: "Socks",
              },
            },
          ],
        },
      }),
    }),
  };

  const resolved = await resolveSelectedMedia({
    admin,
    mediaIds: ["gid://shopify/MediaImage/22"],
    productIds: [],
  });

  assert.deepEqual(resolved.invalidMediaIds, []);
  assert.deepEqual(resolved.media, [
    {
      mediaId: "gid://shopify/MediaImage/22",
      sourceUrl: "https://cdn.example.com/22.jpg",
      productId: "gid://shopify/Product/2",
      productTitle: "Socks",
    },
  ]);
});
