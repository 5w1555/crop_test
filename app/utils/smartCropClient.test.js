import process from "node:process";
import test from "node:test";
import assert from "node:assert/strict";
const moduleUrl = new URL("./smartCropClient.js", import.meta.url).href;

async function loadClient(apiUrl) {
  process.env.SMARTCROP_API_URL = apiUrl;
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

test("cropImage posts form data to the crop endpoint", async () => {
  const { cropImage } = await loadClient("https://crop.example");

  let requestedUrl;
  let requestedOptions;
  global.fetch = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;

    return new Response("ok", {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  };

  const file = new File(["image-bytes"], "avatar.png", { type: "image/png" });
  const response = await cropImage(file, { method: "profile" });

  assert.equal(requestedUrl, "https://crop.example/crop");
  assert.equal(requestedOptions.method, "POST");
  assert.ok(requestedOptions.body instanceof FormData);
  assert.equal(requestedOptions.body.get("method"), "profile");
  assert.equal(requestedOptions.body.get("file").name, "avatar.png");
  assert.equal(response.status, 200);
});

test("cropImage throws the API body text when request fails", async () => {
  const { cropImage } = await loadClient("https://crop.example");

  global.fetch = async () => new Response("bad input", { status: 400 });

  const file = new File(["bytes"], "image.png", { type: "image/png" });

  await assert.rejects(() => cropImage(file), /bad input/);
});

test("health returns true for ok responses and false when fetch fails", async () => {
  const { health } = await loadClient("https://crop.example");

  global.fetch = async () => new Response(null, { status: 200 });
  assert.equal(await health(), true);

  global.fetch = async () => {
    throw new Error("network down");
  };
  assert.equal(await health(), false);
});
