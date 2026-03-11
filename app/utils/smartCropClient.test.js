import process from "node:process";
import test from "node:test";
import assert from "node:assert/strict";
const moduleUrl = new URL("./smartCropClient.js", import.meta.url).href;

async function loadClient(apiUrl, apiToken = "test-token") {
  if (apiUrl === undefined) {
    delete process.env.SMARTCROP_API_URL;
  } else {
    process.env.SMARTCROP_API_URL = apiUrl;
  }

  if (apiToken === null) {
    delete process.env.SMARTCROP_API_TOKEN;
  } else {
    process.env.SMARTCROP_API_TOKEN = apiToken;
  }

  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

test("cropImage trims trailing slash from SMARTCROP_API_URL", async () => {
  const { cropImage } = await loadClient("https://crop.example/");

  let requestedUrl;
  let requestedHeaders;
  global.fetch = async (url, options) => {
    requestedUrl = url;
    requestedHeaders = options.headers;
    return new Response("ok", { status: 200 });
  };

  const file = new File(["image-bytes"], "avatar.png", { type: "image/png" });
  await cropImage(file);

  assert.equal(requestedUrl, "https://crop.example/crop");
  assert.equal(requestedHeaders["X-SmartCrop-Token"], "test-token");
});

test("health uses Render fallback API URL when SMARTCROP_API_URL is not set", async () => {
  delete process.env.SMARTCROP_API_URL;
  process.env.RENDER = "true";

  const { health } = await loadClient();

  let requestedUrl;
  global.fetch = async (url) => {
    requestedUrl = url;
    return new Response(null, { status: 200 });
  };

  assert.equal(await health(), true);
  assert.equal(requestedUrl, "https://smart-crop-api-f97p.onrender.com/health");

  delete process.env.RENDER;
});

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
  assert.equal(requestedOptions.headers["X-SmartCrop-Token"], "test-token");
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

test("cropImages posts repeated files form data to the batch crop endpoint", async () => {
  const { cropImages } = await loadClient("https://crop.example");

  let requestedUrl;
  let requestedOptions;
  global.fetch = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;

    return new Response("ok", {
      status: 200,
      headers: { "content-type": "application/zip" },
    });
  };

  const files = [
    new File(["a"], "avatar-1.png", { type: "image/png" }),
    new File(["b"], "avatar-2.png", { type: "image/png" }),
  ];

  const response = await cropImages(files, { method: "auto" });

  assert.equal(requestedUrl, "https://crop.example/crop/batch");
  assert.equal(requestedOptions.method, "POST");
  assert.equal(requestedOptions.headers["X-SmartCrop-Token"], "test-token");
  assert.ok(requestedOptions.body instanceof FormData);
  assert.equal(requestedOptions.body.get("method"), "auto");
  const postedFiles = requestedOptions.body.getAll("files");
  assert.equal(postedFiles.length, 2);
  assert.equal(postedFiles[0].name, "avatar-1.png");
  assert.equal(postedFiles[1].name, "avatar-2.png");
  assert.equal(response.status, 200);
});

test("cropImage appends optional crop contract fields", async () => {
  const { cropImage } = await loadClient("https://crop.example");

  let requestedOptions;
  global.fetch = async (_url, options) => {
    requestedOptions = options;
    return new Response("ok", { status: 200 });
  };

  const file = new File(["image-bytes"], "avatar.png", { type: "image/png" });
  await cropImage(file, {
    method: "auto",
    targetAspectRatio: "4:5",
    marginTop: 0.1,
    marginRight: 0.2,
    marginBottom: 0.05,
    marginLeft: 0.15,
    anchorHint: "top",
    cropCoordinates: {
      left: 0.1,
      top: 0.2,
      width: 0.6,
      height: 0.5,
    },
    filters: ["detail", "sharpen"],
    pipeline: "salience",
  });

  assert.equal(requestedOptions.body.get("target_aspect_ratio"), "4:5");
  assert.equal(requestedOptions.body.get("margin_top"), "0.1");
  assert.equal(requestedOptions.body.get("margin_right"), "0.2");
  assert.equal(requestedOptions.body.get("margin_bottom"), "0.05");
  assert.equal(requestedOptions.body.get("margin_left"), "0.15");
  assert.equal(requestedOptions.body.get("anchor_hint"), "top");
  assert.equal(
    requestedOptions.body.get("crop_coordinates"),
    '{"left":0.1,"top":0.2,"width":0.6,"height":0.5}',
  );
  assert.equal(requestedOptions.body.get("filters"), '["detail","sharpen"]');
  assert.equal(requestedOptions.body.get("pipeline"), "salience");
});

test("cropImages appends optional crop contract fields", async () => {
  const { cropImages } = await loadClient("https://crop.example");

  let requestedOptions;
  global.fetch = async (_url, options) => {
    requestedOptions = options;
    return new Response("ok", { status: 200 });
  };

  const files = [new File(["image-bytes"], "avatar.png", { type: "image/png" })];
  await cropImages(files, {
    method: "profile",
    targetAspectRatio: "1:1",
    marginTop: 0.1,
    marginRight: 0.1,
    marginBottom: 0.1,
    marginLeft: 0.1,
    anchorHint: "center",
    cropCoordinates:
      '{"left":0.15,"top":0.1,"width":0.7,"height":0.75,"unit":"fraction"}',
    filters: "detail,sharpen",
    pipeline: "face",
  });

  assert.equal(requestedOptions.body.get("method"), "profile");
  assert.equal(requestedOptions.body.get("target_aspect_ratio"), "1:1");
  assert.equal(requestedOptions.body.get("margin_top"), "0.1");
  assert.equal(requestedOptions.body.get("margin_right"), "0.1");
  assert.equal(requestedOptions.body.get("margin_bottom"), "0.1");
  assert.equal(requestedOptions.body.get("margin_left"), "0.1");
  assert.equal(requestedOptions.body.get("anchor_hint"), "center");
  assert.equal(
    requestedOptions.body.get("crop_coordinates"),
    '{"left":0.15,"top":0.1,"width":0.7,"height":0.75,"unit":"fraction"}',
  );
  assert.equal(requestedOptions.body.get("filters"), "detail,sharpen");
  assert.equal(requestedOptions.body.get("pipeline"), "face");
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

test("cropImage throws when SMARTCROP_API_TOKEN is missing", async () => {
  const { cropImage } = await loadClient("https://crop.example", null);

  const file = new File(["image-bytes"], "avatar.png", { type: "image/png" });

  await assert.rejects(() => cropImage(file), /SMARTCROP_API_TOKEN is required/);
});
