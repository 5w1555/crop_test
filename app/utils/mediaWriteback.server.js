import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import prisma from "../db.server.js";

const STAGED_UPLOADS_CREATE_MUTATION = `#graphql
  mutation CreateStagedUploads($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_CREATE_MEDIA_MUTATION = `#graphql
  mutation CreateProductMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        ... on MediaImage {
          id
          status
          image {
            url
          }
        }
      }
      mediaUserErrors {
        field
        message
      }
      product {
        id
      }
    }
  }
`;

const PRODUCT_DELETE_MEDIA_MUTATION = `#graphql
  mutation DeleteProductMedia($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

const IDEMPOTENCY_IN_PROGRESS = "in_progress";
const IDEMPOTENCY_SUCCEEDED = "succeeded";
const IDEMPOTENCY_FAILED = "failed";

const IN_PROGRESS_MAX_POLLS = 15;
const IN_PROGRESS_POLL_DELAY_MS = 25;

function buildCropParamsHash(cropParams) {
  return createHash("sha256").update(JSON.stringify(cropParams ?? null)).digest("hex");
}

function buildIdempotencyKey({ shop, sourceMediaId, cropParamsHash }) {
  const serialized = JSON.stringify({
    shop,
    sourceMediaId,
    cropParamsHash,
  });

  return createHash("sha256").update(serialized).digest("hex");
}

function toStagedUploadInput(output, index) {
  return {
    filename: output.sourceFilename || `cropped-${index + 1}.jpg`,
    mimeType: output.contentType || "image/jpeg",
    fileSize: String(output.byteLength || 0),
    httpMethod: "POST",
    resource: "IMAGE",
  };
}

async function requestStagedUploadTargets({ admin, outputs }) {
  const response = await admin.graphql(STAGED_UPLOADS_CREATE_MUTATION, {
    variables: {
      input: outputs.map(toStagedUploadInput),
    },
  });
  const payload = await response.json();
  const result = payload?.data?.stagedUploadsCreate;

  if (result?.userErrors?.length) {
    throw new Error(result.userErrors.map((item) => item.message).join("; "));
  }

  if (!Array.isArray(result?.stagedTargets) || result.stagedTargets.length !== outputs.length) {
    throw new Error("Shopify did not return upload targets for every cropped image.");
  }

  return result.stagedTargets;
}

async function uploadBinaryToStagedTarget(target, output) {
  const formData = new FormData();
  (target.parameters || []).forEach((parameter) => {
    formData.append(parameter.name, parameter.value);
  });

  const uploadBlob = output.binary
    ? new Blob([output.binary], { type: output.contentType || "image/jpeg" })
    : null;

  if (!uploadBlob) {
    throw new Error("Missing cropped binary for staged upload.");
  }

  formData.append("file", uploadBlob, output.sourceFilename || "cropped-image.jpg");

  const uploadResponse = await fetch(target.url, {
    method: "POST",
    body: formData,
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(errorText || `Staged upload failed (${uploadResponse.status}).`);
  }
}

async function createProductMedia({ admin, productId, resourceUrl, altText }) {
  const response = await admin.graphql(PRODUCT_CREATE_MEDIA_MUTATION, {
    variables: {
      productId,
      media: [
        {
          mediaContentType: "IMAGE",
          originalSource: resourceUrl,
          alt: altText,
        },
      ],
    },
  });
  const payload = await response.json();
  const result = payload?.data?.productCreateMedia;
  const mediaErrors = result?.mediaUserErrors || [];

  if (mediaErrors.length) {
    throw new Error(mediaErrors.map((item) => item.message).join("; "));
  }

  const createdMedia = result?.media?.[0];
  if (!createdMedia?.id) {
    throw new Error("Shopify did not return a destination media ID.");
  }

  return createdMedia;
}

async function maybeDeleteOriginalMedia({ admin, productId, sourceMediaId }) {
  const response = await admin.graphql(PRODUCT_DELETE_MEDIA_MUTATION, {
    variables: {
      productId,
      mediaIds: [sourceMediaId],
    },
  });
  const payload = await response.json();
  const result = payload?.data?.productDeleteMedia;
  const errors = result?.mediaUserErrors || [];

  if (errors.length) {
    throw new Error(errors.map((item) => item.message).join("; "));
  }

  return result?.deletedMediaIds || [];
}

function mapPersistedRecordToResult({ source, output, record, idempotencyKey }) {
  if (record.status === IDEMPOTENCY_SUCCEEDED) {
    return {
      mediaId: source.mediaId,
      sourceMediaId: source.mediaId,
      destinationMediaId: record.destinationMediaId,
      sourceFilename: output.sourceFilename,
      status: "updated",
      updatedImageUrl: record.updatedImageUrl,
      adminTargetUrl: null,
      error: null,
      idempotencyKey,
      mutationOutcome: "reused",
    };
  }

  return {
    mediaId: source.mediaId,
    sourceMediaId: source.mediaId,
    destinationMediaId: null,
    sourceFilename: output.sourceFilename,
    status: "failed",
    updatedImageUrl: null,
    adminTargetUrl: null,
    error: record.error || "Write-back failed.",
    idempotencyKey,
    mutationOutcome: "failed",
  };
}

function isUniqueConstraintError(error) {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ||
    (Boolean(error) && typeof error === "object" && error.code === "P2002")
  );
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function resolvePersistedState({ db, shop, sourceMediaId, cropParamsHash }) {
  for (let pollCount = 0; pollCount <= IN_PROGRESS_MAX_POLLS; pollCount += 1) {
    const existing = await db.mediaWritebackIdempotency.findUnique({
      where: {
        shop_sourceMediaId_cropParamsHash: {
          shop,
          sourceMediaId,
          cropParamsHash,
        },
      },
    });

    if (!existing || existing.status !== IDEMPOTENCY_IN_PROGRESS) {
      return existing;
    }

    await sleep(IN_PROGRESS_POLL_DELAY_MS);
  }

  return null;
}

async function claimIdempotencySlot({ db, shop, sourceMediaId, cropParamsHash, idempotencyKey }) {
  const existing = await db.mediaWritebackIdempotency.findUnique({
    where: {
      shop_sourceMediaId_cropParamsHash: {
        shop,
        sourceMediaId,
        cropParamsHash,
      },
    },
  });

  if (existing) {
    return {
      claimed: false,
      record: existing,
    };
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.mediaWritebackIdempotency.create({
        data: {
          shop,
          sourceMediaId,
          cropParamsHash,
          idempotencyKey,
          status: IDEMPOTENCY_IN_PROGRESS,
        },
      });
    });

    return {
      claimed: true,
      record: null,
    };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const persisted = await resolvePersistedState({
      db,
      shop,
      sourceMediaId,
      cropParamsHash,
    });

    return {
      claimed: false,
      record: persisted,
    };
  }
}

export async function writeBackCroppedMedia({
  admin,
  shop,
  cropOutputs,
  mediaTargets,
  cropParams,
  replaceExisting = true,
  db = prisma,
}) {
  if (!Array.isArray(cropOutputs) || !Array.isArray(mediaTargets)) {
    throw new Error("Invalid write-back payload.");
  }

  const targets = mediaTargets.slice(0, cropOutputs.length);
  const uploadTargets = await requestStagedUploadTargets({
    admin,
    outputs: cropOutputs,
  });

  const perItemResults = [];

  for (const [index, source] of targets.entries()) {
    const output = cropOutputs[index];
    const stagedTarget = uploadTargets[index];
    const cropParamsHash = buildCropParamsHash(cropParams);
    const idempotencyKey = buildIdempotencyKey({
      shop,
      sourceMediaId: source.mediaId,
      cropParamsHash,
    });

    const claim = await claimIdempotencySlot({
      db,
      shop,
      sourceMediaId: source.mediaId,
      cropParamsHash,
      idempotencyKey,
    });

    if (!claim.claimed) {
      const persisted = claim.record;
      perItemResults.push(
        persisted
          ? mapPersistedRecordToResult({
              source,
              output,
              record: persisted,
              idempotencyKey,
            })
          : {
              mediaId: source.mediaId,
              sourceMediaId: source.mediaId,
              destinationMediaId: null,
              sourceFilename: output.sourceFilename,
              status: "failed",
              updatedImageUrl: null,
              adminTargetUrl: null,
              error: "Timed out waiting for existing write-back operation.",
              idempotencyKey,
              mutationOutcome: "failed",
            },
      );
      continue;
    }

    try {
      await uploadBinaryToStagedTarget(stagedTarget, output);
      const createdMedia = await createProductMedia({
        admin,
        productId: source.productId,
        resourceUrl: stagedTarget.resourceUrl,
        altText: `${source.productTitle || "Product"} - cropped`,
      });

      if (replaceExisting) {
        await maybeDeleteOriginalMedia({
          admin,
          productId: source.productId,
          sourceMediaId: source.mediaId,
        });
      }

      await db.mediaWritebackIdempotency.update({
        where: {
          shop_sourceMediaId_cropParamsHash: {
            shop,
            sourceMediaId: source.mediaId,
            cropParamsHash,
          },
        },
        data: {
          status: IDEMPOTENCY_SUCCEEDED,
          destinationMediaId: createdMedia.id,
          updatedImageUrl: createdMedia.image?.url || null,
          error: null,
        },
      });

      perItemResults.push({
        mediaId: source.mediaId,
        sourceMediaId: source.mediaId,
        destinationMediaId: createdMedia.id,
        sourceFilename: output.sourceFilename,
        status: "updated",
        updatedImageUrl: createdMedia.image?.url || null,
        adminTargetUrl: null,
        error: null,
        idempotencyKey,
        mutationOutcome: "created",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Write-back failed.";

      await db.mediaWritebackIdempotency.update({
        where: {
          shop_sourceMediaId_cropParamsHash: {
            shop,
            sourceMediaId: source.mediaId,
            cropParamsHash,
          },
        },
        data: {
          status: IDEMPOTENCY_FAILED,
          destinationMediaId: null,
          updatedImageUrl: null,
          error: message,
        },
      });

      perItemResults.push({
        mediaId: source.mediaId,
        sourceMediaId: source.mediaId,
        destinationMediaId: null,
        sourceFilename: output.sourceFilename,
        status: "failed",
        updatedImageUrl: null,
        adminTargetUrl: null,
        error: message,
        idempotencyKey,
        mutationOutcome: "failed",
      });
    }
  }

  return perItemResults;
}
