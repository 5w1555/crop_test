# Shopify App Template - React Router

This is a template for building a [Shopify app](https://shopify.dev/docs/apps/getting-started) using [React Router](https://reactrouter.com/).  It was forked from the [Shopify Remix app template](https://github.com/Shopify/shopify-app-template-remix) and converted to React Router.

Rather than cloning this repo, follow the [Quick Start steps](https://github.com/Shopify/shopify-app-template-react-router#quick-start).

Visit the [`shopify.dev` documentation](https://shopify.dev/docs/api/shopify-app-react-router) for more details on the React Router app package.

## Upgrading from Remix

If you have an existing Remix app that you want to upgrade to React Router, please follow the [upgrade guide](https://github.com/Shopify/shopify-app-template-react-router/wiki/Upgrading-from-Remix).  Otherwise, please follow the quick start guide below.

## Quick start

### Prerequisites

Before you begin, you'll need the following:

1. **Node.js**: [Download and install](https://nodejs.org/en/download/) it if you haven't already.
2. **Shopify Partner Account**: [Create an account](https://partners.shopify.com/signup) if you don't have one.
3. **Test Store**: Set up either a [development store](https://help.shopify.com/en/partners/dashboard/development-stores#create-a-development-store) or a [Shopify Plus sandbox store](https://help.shopify.com/en/partners/dashboard/managing-stores/plus-sandbox-store) for testing your app.
4. **Shopify CLI**: [Download and install](https://shopify.dev/docs/apps/tools/cli/getting-started) it if you haven't already.
```shell
npm install -g @shopify/cli@latest
```

### Setup

```shell
shopify app init --template=https://github.com/Shopify/shopify-app-template-react-router
```

### Local Development

```shell
shopify app dev
```

Press P to open the URL to your app. Once you click install, you can start development.

Local development is powered by [the Shopify CLI](https://shopify.dev/docs/apps/tools/cli). It logs into your partners account, connects to an app, provides environment variables, updates remote config, creates a tunnel and provides commands to generate extensions.

### Authenticating and querying data

To authenticate and query data you can use the `shopify` const that is exported from `/app/shopify.server.js`:

```js
export async function loader({ request }) {
  const { admin } = await shopify.authenticate.admin(request);

  const response = await admin.graphql(`
    {
      products(first: 25) {
        nodes {
          title
          description
        }
      }
    }`);

  const {
    data: {
      products: { nodes },
    },
  } = await response.json();

  return nodes;
}
```

This template comes pre-configured with examples of:

1. Setting up your Shopify app in [/app/shopify.server.ts](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/shopify.server.ts)
2. Querying data using Graphql. Please see: [/app/routes/app.\_index.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/app._index.tsx).
3. Responding to webhooks. Please see [/app/routes/webhooks.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/webhooks.app.uninstalled.tsx).

Please read the [documentation for @shopify/shopify-app-react-router](https://shopify.dev/docs/api/shopify-app-react-router) to see what other API's are available.

## Shopify Dev MCP

This template is configured with the Shopify Dev MCP. This instructs [Cursor](https://cursor.com/), [GitHub Copilot](https://github.com/features/copilot) and [Claude Code](https://claude.com/product/claude-code) and [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) to use the Shopify Dev MCP.  

For more information on the Shopify Dev MCP please read [the  documentation](https://shopify.dev/docs/apps/build/devmcp).


## Production-ready DB initialization (Prisma + Render)

This template now assumes **PostgreSQL** in `prisma/schema.prisma`, which is a better fit than SQLite for hosted environments like Render.

### 1) Configure environment variables

Create `.env` from `.env.example` and fill in values:

```bash
cp .env.example .env
```

At minimum for local/prod you need:

- `DATABASE_URL` (for app runtime; with Neon use the pooled URL)
- `DIRECT_DATABASE_URL` (for Prisma migrations; with Neon use the direct/non-pooled URL)
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `SCOPES`
- `SHOPIFY_BILLING_TEST_MODE` (`false` in production; `true` in development/staging)
- `SMARTCROP_API_URL` (URL of the deployed Smart Crop FastAPI service)
- `SMARTCROP_API_TOKEN` (shared secret used by Node app and FastAPI service; sent as `X-SmartCrop-Token`)
- `SMARTCROP_FRONTEND_ORIGINS` on the FastAPI service (comma-separated allowed frontend origins, for example `https://your-admin-app.onrender.com,http://localhost:3000`; do not rely on `*` in production)
- `SMARTCROP_MAX_UPLOAD_MB` on FastAPI (max upload size per file, default `12` on Render)
- `SMARTCROP_MAX_BATCH_FILES` on FastAPI (max number of files accepted by `/crop/batch`, default `8`)
- `SMARTCROP_MAX_CONCURRENCY` on FastAPI (request slots for heavy crop processing; use `1` on small instances to avoid memory spikes)
- `SMARTCROP_ACQUIRE_TIMEOUT_SECONDS` on FastAPI (how long requests wait for a processing slot before returning `503`)
- `SMARTCROP_PRELOAD_MODEL` on FastAPI (`1`/`0`; preloads InsightFace in a background startup thread to reduce first-request cold-start)

### 2) Initialize the database schema

Use Prisma migrations to create/update your tables:

```bash
npm run setup
```

`npm run setup` runs:

1. `prisma generate`
2. `prisma migrate deploy`

So every environment applies committed migrations consistently.

### Neon-specific connection setup

If you are using Neon, configure both database URLs:

- `DATABASE_URL`: Neon **pooled** connection string (typically contains `-pooler` host), with `sslmode=require&pgbouncer=true`.
- `DIRECT_DATABASE_URL`: Neon **direct/non-pooled** connection string, with `sslmode=require`.

This split ensures runtime queries use pooling while Prisma migrations use a direct connection.

### Billing mode by environment

Set `SHOPIFY_BILLING_TEST_MODE` per environment so Shopify billing behaves correctly:

- **Production:** `SHOPIFY_BILLING_TEST_MODE=false` (real charges)
- **Development/Staging:** `SHOPIFY_BILLING_TEST_MODE=true` (test charges)

### Shopify app URL parity (first-line session troubleshooting)

If merchants immediately see **session-expired** toasts right after install/auth, first verify URL parity between runtime env and Shopify Partners config:

- `SHOPIFY_APP_URL` must be set.
- In production (`NODE_ENV=production`), `SHOPIFY_APP_URL` must be `https://...`.
- `SHOPIFY_APP_URL` origin must match `shopify.app.toml` `application_url` origin exactly (same scheme + host + port).

Example parity check:

- `SHOPIFY_APP_URL=https://smart-crop-app.onrender.com`
- `shopify.app.toml` -> `application_url = "https://smart-crop-app.onrender.com"`

The server now validates this at startup and logs a clear mismatch message because this is a common root cause of immediate session-expired loops after OAuth.

### 3) Render deployment baseline

A `render.yaml` is included to provision:

- A managed PostgreSQL database (`smart-crop-db`)
- A Node web service (`smart-crop-app`)
- Automatic `DATABASE_URL` wiring from the database to the app service
- `SMARTCROP_API_URL` set for the Node service to reach the deployed FastAPI Smart Crop API
- `SMARTCROP_API_TOKEN` set on **both** services to the same secret value

The app startup command is:

```bash
npm run setup && npm run start
```

This guarantees migrations are applied before serving traffic.

> `SMARTCROP_API_URL` is required for Smart Crop and must point to your deployed FastAPI endpoint (prefer Render internal URL when both services are in the same Render workspace; otherwise use the external URL such as `https://smart-crop-api-f97p.onrender.com`).
>
> `SMARTCROP_API_TOKEN` must match across both services. FastAPI rejects missing tokens with `401` and invalid tokens with `403` on `/crop` and `/crop/batch`.
>
> For batch ZIP downloads via Cloudflare R2, set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET` on the FastAPI service, and add an R2 lifecycle rule for prefix `smartcrop/batch/` with 1-day expiration.

### Smart Crop shared-secret rotation and rollback

Use this procedure when rotating `SMARTCROP_API_TOKEN`:

1. Generate a new high-entropy token (for example from your password manager).
2. Update `SMARTCROP_API_TOKEN` on the **FastAPI service** in Render and deploy.
3. Update `SMARTCROP_API_TOKEN` on the **Node app service** in Render and deploy.
4. Verify uploads from the app succeed (single + batch crop).

Rollback steps (if crop requests fail after rotation):

1. Reapply the previous known-good token to **both** services.
2. Redeploy both services.
3. Confirm `/app/additional` Smart Crop checks recover and crop requests succeed.

## What to configure in the `.toml` files

### `shopify.app.toml`

- `client_id`: Your app client ID from Shopify Partners.
- `name`: App display name in Shopify.
- `application_url`: Public app base URL (for Render, your `https://<service>.onrender.com` URL or custom domain).
- `embedded`: Whether app runs embedded in admin.

`[build]`
- `automatically_update_urls_on_dev`: Lets CLI rewrite dev URLs while tunneling.
- `include_config_on_deploy`: Pushes config changes during `shopify app deploy`.

`[webhooks]`
- `api_version`: Admin API version for webhook subscriptions.

`[[webhooks.subscriptions]]`
- `topics`: Event topic list.
- `uri`: Relative endpoint in your app.

### Compliance webhooks, retention, and deletion behavior

Because this app is distributed via the Shopify App Store (`AppDistribution.AppStore`), it subscribes to the required compliance topics in `shopify.app.toml`:

- `customers/data_request` → `/webhooks/customers/data_request`
- `customers/redact` → `/webhooks/customers/redact`
- `shop/redact` → `/webhooks/shop/redact`

Webhook handlers are implemented under `app/routes/` and follow the same pattern as other webhook routes:

- Verify the webhook with `authenticate.webhook(request)`.
- Safely parse payload fields with defensive access (`?.` / type checks).
- Return HTTP 200 quickly.
- Log webhook request IDs (`x-request-id` or `x-shopify-webhook-id`) for auditability.

#### Data retention/deletion policy in this app

- **`app/uninstalled`**: deletes all local `Session` rows and any `ShopPlanUsage` record for the shop.
- **`shop/redact`**: performs the same full shop-level cleanup (`Session` + `ShopPlanUsage`).
- **`customers/redact` and `customers/data_request`**: currently audit-log requests and do not persist customer records locally.

#### Manual cleanup procedures

If you need to run explicit cleanup outside webhook delivery (for incident response or support operations), use Prisma Studio or SQL:

```sql
-- Remove all sessions and plan-usage state for one shop
DELETE FROM "Session" WHERE shop = '<shop-domain.myshopify.com>';
DELETE FROM "ShopPlanUsage" WHERE shop = '<shop-domain.myshopify.com>';
```

For full environment reset:

```sql
DELETE FROM "Session";
DELETE FROM "ShopPlanUsage";
```

`[access_scopes]`
- `scopes`: OAuth scopes your app requests.

## Commercial readiness updates

This app now includes a real Shopify billing implementation for the Pro tier:

- Billing is configured in `app/shopify.server.js` using Shopify app subscriptions (`BillingInterval.Every30Days`, €10/month).
- Merchants can start/cancel the subscription from `/app/billing`.
- Crop quota + feature access are synchronized with Shopify billing state on every loader/action request.

Shopify integration depth now includes merchant catalog context in `/app/additional`:

- The app reads recent products (`products` query with title/handle/inventory/featuredImage).
- This justifies a minimal `read_products` scope and removes the previously over-broad `write_products` request.

`[auth]`
- `redirect_urls`: Allowed OAuth callback URLs. In production, this must include your live app callback URL(s).

### `shopify.web.toml`

- `name`: Label for this web process in Shopify tooling.
- `roles`: Which capabilities this process serves (`frontend`, `backend`).
- `webhooks_path`: Endpoint used for webhook health expectations.

`[commands]`
- `predev`: Runs before `shopify app dev` (here: Prisma client generation).
- `dev`: Dev server command (here: applies migrations then starts React Router dev server).

> Important: `shopify.web.toml` is mainly for Shopify CLI app process behavior, while `render.yaml` controls Render infrastructure/runtime.

## Deployment

### Application Storage

This template uses [Prisma](https://www.prisma.io/) to store session data, configured for **PostgreSQL** by default in `prisma/schema.prisma`.

PostgreSQL is a better fit for multi-instance hosted environments (like Render) than file-based SQLite.
The database that works best for you still depends on the data your app needs and how it is queried.
Here’s a short list of databases providers that provide a free tier to get started:

| Database   | Type             | Hosters                                                                                                                                                                                                                               |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MySQL      | SQL              | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-mysql), [Planet Scale](https://planetscale.com/), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/mysql) |
| PostgreSQL | SQL              | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-postgresql), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/postgres)                                   |
| Redis      | Key-value        | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-redis), [Amazon MemoryDB](https://aws.amazon.com/memorydb/)                                                                                                        |
| MongoDB    | NoSQL / Document | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-mongodb), [MongoDB Atlas](https://www.mongodb.com/atlas/database)                                                                                                  |

To use one of these, you can use a different [datasource provider](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference#datasource) in your `schema.prisma` file, or a different [SessionStorage adapter package](https://github.com/Shopify/shopify-api-js/blob/main/packages/shopify-api/docs/guides/session-storage.md).

### Build

Build the app by running the command below with the package manager of your choice:

Using yarn:

```shell
yarn build
```

Using npm:

```shell
npm run build
```

Using pnpm:

```shell
pnpm run build
```

## Test checklist (post-merge)

After merging major changes, validate both app layers:

### Automated checks

- `npm run lint`
- `npm run typecheck`
- `npm test` (covers Smart Crop client request/health behavior)

### Manual end-to-end checks

1. **Embedded app auth flow**: install app in a dev store and confirm OAuth/login still works.
2. **Smart Crop API connectivity**: open **Additional** page and confirm status shows connected when `SMARTCROP_API_URL` is valid.
3. **Crop methods matrix**: upload at least one image and verify each method (`auto`, `head_bust`, `frontal`, `profile`, `chin`, `nose`, `below_lips`) returns an image without server error.
4. **Validation errors**: submit with missing/invalid file and confirm the UI shows an error banner/toast.
5. **Output verification**: ensure returned image preview renders and download link saves a valid PNG.
6. **Webhook/session regression**: reinstall/uninstall app once to confirm webhook handling and session persistence are unaffected.

### FastAPI smoke checks

- `GET /health` returns 200.
- `POST /crop` returns image bytes and proper `Content-Type: image/png`.
- Unsupported method returns a handled error (not 500 crash).

## Hosting

When you're ready to set up your app in production, you can follow [our deployment documentation](https://shopify.dev/docs/apps/deployment/web) to host your app on a cloud provider like [Heroku](https://www.heroku.com/) or [Fly.io](https://fly.io/).

When you reach the step for [setting up environment variables](https://shopify.dev/docs/apps/deployment/web#set-env-vars), you also need to set the variable `NODE_ENV=production`.


## Gotchas / Troubleshooting

### Database tables don't exist

If you get an error like:

```
The table `main.Session` does not exist in the current database.
```

Create the database for Prisma. Run the `setup` script in `package.json` using `npm`, `yarn` or `pnpm`.

### Navigating/redirecting breaks an embedded app

Embedded apps must maintain the user session, which can be tricky inside an iFrame. To avoid issues:

1. Use `Link` from `react-router` or `@shopify/polaris`. Do not use `<a>`.
2. Use `redirect` returned from `authenticate.admin`. Do not use `redirect` from `react-router`
3. Use `useSubmit` from `react-router`.

This only applies if your app is embedded, which it will be by default.

### Webhooks: shop-specific webhook subscriptions aren't updated

If you are registering webhooks in the `afterAuth` hook, using `shopify.registerWebhooks`, you may find that your subscriptions aren't being updated.  

Instead of using the `afterAuth` hook declare app-specific webhooks in the `shopify.app.toml` file.  This approach is easier since Shopify will automatically sync changes every time you run `deploy` (e.g: `npm run deploy`).  Please read these guides to understand more:

1. [app-specific vs shop-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions)
2. [Create a subscription tutorial](https://shopify.dev/docs/apps/build/webhooks/subscribe/get-started?deliveryMethod=https)

If you do need shop-specific webhooks, keep in mind that the package calls `afterAuth` in 2 scenarios:

- After installing the app
- When an access token expires

During normal development, the app won't need to re-authenticate most of the time, so shop-specific subscriptions aren't updated. To force your app to update the subscriptions, uninstall and reinstall the app. Revisiting the app will call the `afterAuth` hook.

### Webhooks: Admin created webhook failing HMAC validation

Webhooks subscriptions created in the [Shopify admin](https://help.shopify.com/en/manual/orders/notifications/webhooks) will fail HMAC validation. This is because the webhook payload is not signed with your app's secret key.  

The recommended solution is to use [app-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions) defined in your toml file instead.  Test your webhooks by triggering events manually in the Shopify admin(e.g. Updating the product title to trigger a `PRODUCTS_UPDATE`).

### Webhooks: Admin object undefined on webhook events triggered by the CLI

When you trigger a webhook event using the Shopify CLI, the `admin` object will be `undefined`. This is because the CLI triggers an event with a valid, but non-existent, shop. The `admin` object is only available when the webhook is triggered by a shop that has installed the app.  This is expected.

Webhooks triggered by the CLI are intended for initial experimentation testing of your webhook configuration. For more information on how to test your webhooks, see the [Shopify CLI documentation](https://shopify.dev/docs/apps/tools/cli/commands#webhook-trigger).

### Incorrect GraphQL Hints

By default the [graphql.vscode-graphql](https://marketplace.visualstudio.com/items?itemName=GraphQL.vscode-graphql) extension for will assume that GraphQL queries or mutations are for the [Shopify Admin API](https://shopify.dev/docs/api/admin). This is a sensible default, but it may not be true if:

1. You use another Shopify API such as the storefront API.
2. You use a third party GraphQL API.

If so, please update [.graphqlrc.ts](https://github.com/Shopify/shopify-app-template-react-router/blob/main/.graphqlrc.ts).

### Using Defer & await for streaming responses

By default the CLI uses a cloudflare tunnel. Unfortunately  cloudflare tunnels wait for the Response stream to finish, then sends one chunk.  This will not affect production.

To test [streaming using await](https://reactrouter.com/api/components/Await#await) during local development we recommend [localhost based development](https://shopify.dev/docs/apps/build/cli-for-apps/networking-options#localhost-based-development).

### "nbf" claim timestamp check failed

This is because a JWT token is expired.  If you  are consistently getting this error, it could be that the clock on your machine is not in sync with the server.  To fix this ensure you have enabled "Set time and date automatically" in the "Date and Time" settings on your computer.

### Using MongoDB and Prisma

If you choose to use MongoDB with Prisma, there are some gotchas in Prisma's MongoDB support to be aware of. Please see the [Prisma SessionStorage README](https://www.npmjs.com/package/@shopify/shopify-app-session-storage-prisma#mongodb).

## Resources

React Router:

- [React Router docs](https://reactrouter.com/home)

Shopify:

- [Intro to Shopify apps](https://shopify.dev/docs/apps/getting-started)
- [Shopify App React Router docs](https://shopify.dev/docs/api/shopify-app-react-router)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
- [Shopify App Bridge](https://shopify.dev/docs/api/app-bridge-library).
- [Polaris Web Components](https://shopify.dev/docs/api/app-home/polaris-web-components).
- [App extensions](https://shopify.dev/docs/apps/app-extensions/list)
- [Shopify Functions](https://shopify.dev/docs/api/functions)

Internationalization:

- [Internationalizing your app](https://shopify.dev/docs/apps/best-practices/internationalization/getting-started)
