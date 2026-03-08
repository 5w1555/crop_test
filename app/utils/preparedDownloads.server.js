import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

const DOWNLOAD_TTL_MS = 10 * 60 * 1000;
const DOWNLOAD_DIR = path.join(os.tmpdir(), "smart-crop-downloads");
const downloadStore = new Map();
const ZIP_MAGIC_HEADERS = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x50, 0x4b, 0x07, 0x08]),
];

function sanitizeFilename(filename) {
  return String(filename || "cropped-images.zip").replace(/[\\/]/g, "-");
}

function parseFilename(contentDisposition) {
  if (!contentDisposition) return "cropped-images.zip";

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  const plainMatch = contentDisposition.match(/filename=([^;]+)/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim();
  }

  return "cropped-images.zip";
}

async function ensureDownloadDir() {
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
}

async function cleanupToken(token) {
  const existing = downloadStore.get(token);
  if (!existing) return;

  downloadStore.delete(token);

  try {
    await fs.unlink(existing.filePath);
  } catch {
    // best-effort cleanup
  }
}

function buildDecodingStream(contentEncoding) {
  if (!contentEncoding) {
    return { transform: null, normalizedEncoding: null };
  }

  const normalized = contentEncoding.toLowerCase().trim();

  if (normalized === "gzip") {
    return { transform: createGunzip(), normalizedEncoding: null };
  }

  if (normalized === "deflate") {
    return { transform: createInflate(), normalizedEncoding: null };
  }

  if (normalized === "br") {
    return { transform: createBrotliDecompress(), normalizedEncoding: null };
  }

  return { transform: null, normalizedEncoding: contentEncoding };
}

async function assertZipSignature(filePath) {
  const handle = await fs.open(filePath, "r");

  try {
    const signature = Buffer.alloc(4);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);

    if (bytesRead < 4) {
      throw new Error("Prepared download is not a valid ZIP archive (missing ZIP signature).");
    }

    const hasValidSignature = ZIP_MAGIC_HEADERS.some((header) => header.equals(signature));
    if (!hasValidSignature) {
      throw new Error("Prepared download is not a valid ZIP archive (invalid ZIP signature).");
    }
  } finally {
    await handle.close();
  }
}

export async function prepareDownloadFromResponse(response) {
  if (!response.body) {
    throw new Error("Crop service returned an empty body.");
  }

  await ensureDownloadDir();

  const token = randomUUID();
  const filePath = path.join(DOWNLOAD_DIR, `${token}.zip`);
  const filename = sanitizeFilename(parseFilename(response.headers.get("content-disposition")));
  const mimeType = response.headers.get("content-type") || "application/zip";
  const contentEncoding = response.headers.get("content-encoding");
  const declaredContentLength = Number.parseInt(response.headers.get("content-length") || "", 10);
  const { transform, normalizedEncoding } = buildDecodingStream(contentEncoding);

  try {
    const nodeReadable = Readable.fromWeb(response.body);
    const writer = createWriteStream(filePath);

    if (transform) {
      await pipeline(nodeReadable, transform, writer);
    } else {
      await pipeline(nodeReadable, writer);
    }

    await assertZipSignature(filePath);
  } catch (error) {
    await fs.unlink(filePath).catch(() => {});
    throw error;
  }

  const fileStats = await fs.stat(filePath);
  const normalizedContentLength = transform
    ? fileStats.size
    : Number.isFinite(declaredContentLength)
      ? declaredContentLength
      : fileStats.size;
  const expiresAt = Date.now() + DOWNLOAD_TTL_MS;

  const timeout = setTimeout(() => {
    void cleanupToken(token);
  }, DOWNLOAD_TTL_MS);

  downloadStore.set(token, {
    token,
    filePath,
    filename,
    mimeType,
    contentEncoding: normalizedEncoding,
    contentLength: normalizedContentLength,
    expiresAt,
    timeout,
  });

  return {
    token,
    filename,
    expiresInSeconds: Math.floor(DOWNLOAD_TTL_MS / 1000),
  };
}

export function takePreparedDownload(token) {
  const record = downloadStore.get(token);
  if (!record) return null;

  if (Date.now() > record.expiresAt) {
    void cleanupToken(token);
    return null;
  }

  clearTimeout(record.timeout);
  downloadStore.delete(token);

  setTimeout(() => {
    void fs.unlink(record.filePath).catch(() => {});
  }, 60 * 1000);

  return {
    filename: record.filename,
    mimeType: record.mimeType,
    contentEncoding: record.contentEncoding,
    contentLength: record.contentLength,
    stream: Readable.toWeb(createReadStream(record.filePath)),
  };
}
