import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { prepareDownloadFromResponse, takePreparedDownload } from "./preparedDownloads.server.js";

const EMPTY_ZIP_BYTES = Buffer.from([
  0x50, 0x4b, 0x05, 0x06,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00,
]);

async function readWebStream(stream) {
  const response = new Response(stream);
  return Buffer.from(await response.arrayBuffer());
}

test("prepareDownloadFromResponse persists identity ZIP payload", async () => {
  const response = new Response(EMPTY_ZIP_BYTES, {
    headers: {
      "content-type": "application/zip",
      "content-length": String(EMPTY_ZIP_BYTES.length),
      "content-disposition": 'attachment; filename="identity.zip"',
    },
  });

  const prepared = await prepareDownloadFromResponse(response);
  const taken = takePreparedDownload(prepared.token);

  assert.ok(taken);
  assert.equal(taken.filename, "identity.zip");
  assert.equal(taken.mimeType, "application/zip");
  assert.equal(taken.contentEncoding, null);
  assert.equal(taken.contentLength, EMPTY_ZIP_BYTES.length);

  const persistedBytes = await readWebStream(taken.stream);
  assert.deepEqual(persistedBytes, EMPTY_ZIP_BYTES);
});

test("prepareDownloadFromResponse decodes gzip ZIP payload and clears encoding", async () => {
  const gzippedZip = gzipSync(EMPTY_ZIP_BYTES);
  const response = new Response(gzippedZip, {
    headers: {
      "content-type": "application/zip",
      "content-encoding": "gzip",
      "content-length": String(gzippedZip.length),
      "content-disposition": 'attachment; filename="encoded.zip"',
    },
  });

  const prepared = await prepareDownloadFromResponse(response);
  const taken = takePreparedDownload(prepared.token);

  assert.ok(taken);
  assert.equal(taken.filename, "encoded.zip");
  assert.equal(taken.contentEncoding, null);
  assert.equal(taken.contentLength, EMPTY_ZIP_BYTES.length);

  const persistedBytes = await readWebStream(taken.stream);
  assert.deepEqual(persistedBytes, EMPTY_ZIP_BYTES);
});

test("prepareDownloadFromResponse rejects invalid ZIP payloads", async () => {
  const response = new Response(Buffer.from("this is not a zip"), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="bad.zip"',
    },
  });

  await assert.rejects(
    () => prepareDownloadFromResponse(response),
    /Prepared download is not a valid ZIP archive/,
  );
});
