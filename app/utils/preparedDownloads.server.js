import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

const DOWNLOAD_TTL_MS = 10 * 60 * 1000;
const DOWNLOAD_DIR = path.join(os.tmpdir(), "smart-crop-downloads");
const downloadStore = new Map();

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

export async function prepareDownloadFromResponse(response) {
  if (!response.body) {
    throw new Error("Crop service returned an empty body.");
  }

  await ensureDownloadDir();

  const token = randomUUID();
  const filePath = path.join(DOWNLOAD_DIR, `${token}.zip`);
  const nodeReadable = Readable.fromWeb(response.body);
  const writer = createWriteStream(filePath);

  nodeReadable.pipe(writer);
  await finished(writer);

  const filename = sanitizeFilename(parseFilename(response.headers.get("content-disposition")));
  const mimeType = response.headers.get("content-type") || "application/zip";
  const expiresAt = Date.now() + DOWNLOAD_TTL_MS;

  const timeout = setTimeout(() => {
    void cleanupToken(token);
  }, DOWNLOAD_TTL_MS);

  downloadStore.set(token, {
    token,
    filePath,
    filename,
    mimeType,
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
    stream: Readable.toWeb(createReadStream(record.filePath)),
  };
}
