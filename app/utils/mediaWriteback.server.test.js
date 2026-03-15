import test from "node:test";
import assert from "node:assert/strict";

import { writeBackCroppedMedia } from "./mediaWriteback.server.js";

function createInMemoryDb() {
  const records = new Map();

  const toKey = ({ shop, sourceMediaId, cropParamsHash }) => `${shop}::${sourceMediaId}::${cropParamsHash}`;

  const mediaWritebackIdempotency = {
    async findUnique({ where }) {
      const key = toKey(where.shop_sourceMediaId_cropParamsHash);
      const record = records.get(key);
      return record ? { ...record } : null;
    },
    async create({ data }) {
      const key = toKey(data);
      if (records.has(key)) {
        const error = new Error("Unique constraint violation");
        error.code = "P2002";
        throw error;
      }

      records.set(key, {
        ...data,
      });

      return { ...records.get(key) };
    },
    async update({ where, data }) {
      const key = toKey(where.shop_sourceMediaId_cropParamsHash);
      const existing = records.get(key);
      if (!existing) {
        throw new Error("Record not found");
      }

      const next = {
        ...existing,
        ...data,
      };
      records.set(key, next);
      return { ...next };
    },
  };

  return {
    mediaWritebackIdempotency,
    async $transaction(handler) {
      return handler({ mediaWritebackIdempotency });
    },
    snapshot() {
      return Array.from(records.values()).map((item) => ({ ...item }));
    },
  };
}

function createAdminMock({ createMediaDelayMs = 0 } = {}) {
  const calls = {
    stagedUploads: 0,
    createMedia: 0,
    deleteMedia: 0,
  };

  return {
    calls,
    admin: {
      async graphql(query) {
        if (query.includes("CreateStagedUploads")) {
          calls.stagedUploads += 1;
          return {
            json: async () => ({
              data: {
                stagedUploadsCreate: {
                  stagedTargets: [
                    {
                      url: "https://upload.example.com/staged",
                      resourceUrl: "https://resource.example.com/cropped.jpg",
                      parameters: [],
                    },
                  ],
                  userErrors: [],
                },
              },
            }),
          };
        }

        if (query.includes("CreateProductMedia")) {
          calls.createMedia += 1;
          if (createMediaDelayMs) {
            await new Promise((resolve) => setTimeout(resolve, createMediaDelayMs));
          }

          return {
            json: async () => ({
              data: {
                productCreateMedia: {
                  media: [
                    {
                      id: "gid://shopify/MediaImage/999",
                      image: {
                        url: "https://cdn.example.com/999.jpg",
                      },
                    },
                  ],
                  mediaUserErrors: [],
                },
              },
            }),
          };
        }

        if (query.includes("DeleteProductMedia")) {
          calls.deleteMedia += 1;
          return {
            json: async () => ({
              data: {
                productDeleteMedia: {
                  deletedMediaIds: ["gid://shopify/MediaImage/111"],
                  mediaUserErrors: [],
                },
              },
            }),
          };
        }

        throw new Error("Unexpected GraphQL query");
      },
    },
  };
}

test("writeBackCroppedMedia persists deterministic outcomes", async () => {
  const db = createInMemoryDb();
  const { admin, calls } = createAdminMock();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => "",
  });

  try {
    const payload = {
      admin,
      shop: "test-shop.myshopify.com",
      cropOutputs: [
        {
          sourceFilename: "source.jpg",
          contentType: "image/jpeg",
          byteLength: 3,
          binary: new Uint8Array([1, 2, 3]),
        },
      ],
      mediaTargets: [
        {
          mediaId: "gid://shopify/MediaImage/111",
          productId: "gid://shopify/Product/1",
          productTitle: "Cap",
        },
      ],
      cropParams: {
        aspectRatio: "1:1",
      },
      db,
    };

    const created = await writeBackCroppedMedia(payload);
    const reused = await writeBackCroppedMedia(payload);

    assert.equal(created[0].mutationOutcome, "created");
    assert.equal(created[0].status, "updated");
    assert.equal(reused[0].mutationOutcome, "reused");
    assert.equal(reused[0].status, "updated");
    assert.equal(calls.createMedia, 1);

    const records = db.snapshot();
    assert.equal(records.length, 1);
    assert.equal(records[0].status, "succeeded");
    assert.equal(records[0].destinationMediaId, "gid://shopify/MediaImage/999");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("writeBackCroppedMedia dedupes two simultaneous identical requests", async () => {
  const db = createInMemoryDb();
  const { admin, calls } = createAdminMock({ createMediaDelayMs: 60 });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => "",
  });

  try {
    const payload = {
      admin,
      shop: "test-shop.myshopify.com",
      cropOutputs: [
        {
          sourceFilename: "source.jpg",
          contentType: "image/jpeg",
          byteLength: 3,
          binary: new Uint8Array([1, 2, 3]),
        },
      ],
      mediaTargets: [
        {
          mediaId: "gid://shopify/MediaImage/111",
          productId: "gid://shopify/Product/1",
          productTitle: "Cap",
        },
      ],
      cropParams: {
        aspectRatio: "1:1",
      },
      db,
    };

    const [first, second] = await Promise.all([
      writeBackCroppedMedia(payload),
      writeBackCroppedMedia(payload),
    ]);

    const outcomes = [first[0].mutationOutcome, second[0].mutationOutcome].sort();
    assert.deepEqual(outcomes, ["created", "reused"]);
    assert.equal(calls.createMedia, 1);

    const records = db.snapshot();
    assert.equal(records.length, 1);
    assert.equal(records[0].status, "succeeded");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
