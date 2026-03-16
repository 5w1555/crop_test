import { index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.jsx"),
  ...prefix("auth", [
    route("login", "routes/auth/login.jsx"),
    route("*", "routes/auth/$.jsx"),
  ]),
  ...prefix("webhooks", [
    ...prefix("app", [
      route("uninstalled", "routes/webhooks/app/uninstalled.jsx"),
      route("scopes_update", "routes/webhooks/app/scopes_update.jsx"),
    ]),
    ...prefix("customers", [
      route("data_request", "routes/webhooks/customers/data_request.jsx"),
      route("redact", "routes/webhooks/customers/redact.jsx"),
    ]),
    ...prefix("shop", [route("redact", "routes/webhooks/shop/redact.jsx")]),
  ]),
  layout("routes/app/layout.jsx", [
    ...prefix("app", [
      index("routes/app/_index.jsx"),
      route("billing", "routes/app/billing.jsx"),
      ...prefix("crop", [
        index("routes/app/crop/index.jsx"),
        route("media/resolve", "routes/app/crop/media.resolve.jsx"),
        route("status/:jobId", "routes/app/crop/status.$jobId.jsx"),
      ]),
    ]),
  ]),
];
