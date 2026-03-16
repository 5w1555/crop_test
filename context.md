# Project Context (frontend-focused)

## Stack and runtime
- **Framework**: React Router v7 app (file-based routes via `@react-router/fs-routes`).
- **Build tooling**: Vite + React Router Vite plugin.
- **UI ecosystem**: Shopify App Bridge + Shopify web components (`<s-page>`, `<s-card>`, etc.).
- **Backend integration**: Node server routes call Shopify auth helpers and a FastAPI image-cropping service.

## Repository layout summary
- `app/` — main React Router application (server entry, root document, routes, Shopify integration).
- `fastapi_service/` — separate Python service that performs crop/salience operations.
- `prisma/` — DB schema used by Shopify session storage.
- `vite.config.js` — Vite configuration with Shopify-specific HMR behavior.

## Front-end architecture

### Routing model
- Route discovery is done by `flatRoutes()` in `app/routes.ts`.
- UI and loader/action logic are colocated in route modules under `app/routes/`.
- Important front-end routes:
  - `app/routes/_index.jsx`: top-level landing/redirect behavior.
  - `app/routes/app._index.jsx`: embedded app index with upload + crop interaction.
  - `app/routes/app/crop/index.jsx`: explicit crop route with the same upload/crop workflow.
  - `app/routes/auth/login.jsx`: login screen.

### App shell
- `app/root.jsx` defines the HTML shell and React Router document primitives (`Links`, `Meta`, `Outlet`, `Scripts`).
- `app/entry.server.jsx` provides SSR rendering through `ServerRouter` and React 18 streaming.

### Crop UI flow
- User chooses one or more images in the UI.
- Client handler builds `FormData` and POSTs to `/app/crop` using `shopify.fetch`.
- Route `action` parses `formData`, calls `cropImagesWithOutputs(...)`, and returns JSON.
- UI renders preview of the first `croppedBase64` output and download link.

## Issue found and fixed

### Symptom
Vite SSR/import analysis error:
> The requested module 'react-router' does not provide an export named 'json'

### Root cause
A route module imported `json` from `react-router` (invalid in this stack/version). Another route imported `json` from `@remix-run/node`, which is inconsistent with the current React Router v7 server API.

### Fix applied
- Replaced route responses with **standard `Response.json(...)`** in both crop route modules.
- Removed invalid/inconsistent `json` imports.
- Kept route behavior and response payload shape unchanged.
- Cleaned an unused `session` binding in actions.

## Current frontend health checks
- `npm run typecheck` passes.
- `npm run build` passes, including Vite client build + SSR bundle.

## Notes for next iterations
- `app/routes/app._index.jsx` and `app/routes/app/crop/index.jsx` currently duplicate crop UI/action logic; consider consolidating into one source-of-truth route/component.
- The UI currently uses alert-based status messages; replacing alerts with inline Polaris feedback would improve UX.
