# UX redesign plan: progressive disclosure for Shopify merchants

## Goal
Ship an opinionated Smart Crop experience that is easy to trust on first run, while still supporting power-user control.

## Product model

### Layer 1 — Zero friction (default)
- Default path is upload + one primary action.
- Auto method is selected automatically.
- Merchant can run batch processing without understanding crop internals.

### Layer 2 — Light control (visible, low-noise)
- Show a preset selector near the primary action.
- Presets use merchant-facing language:
  - Auto
  - Portrait
  - Product
  - Square
- Presets map to backend method choices and are one-click.

### Layer 3 — Power user (collapsed by default)
- Advanced section remains available but hidden initially.
- Expose method override first.
- Then expand to include margin/aspect/filters once backend parameters are wired.

## What the repo needs right now

1. **Front-end IA update on crop page (done in this branch)**
   - Reframe the page into Layer 1/2/3 sections.
   - Make one obvious action (`Auto-crop images`) the visual default.
   - Keep advanced controls collapsed.

2. **Preset abstraction in UI state (done in this branch)**
   - Introduce preset state separate from raw method state.
   - Persist method submission via hidden form field.
   - Allow advanced override to replace preset mapping.

3. **Backend contract extension (next)**
   - Add optional fields to `/crop` and `/crop/batch` for:
     - target aspect ratio
     - crop margins / padding
     - profile-style anchoring hints
     - optional filters (if needed)
   - Ensure Free vs Pro gating remains centralized in `reservePlanCapacity`.

4. **Preset configuration source (next)**
   - Move preset mapping out of route component into a shared config module.
   - Add plan-awareness rules per preset (for example, free fallback behavior).

5. **Preview confidence loop (next)**
   - Add a preflight preview mode (sample 6–12 items) before full batch run.
   - Keep a clear "Apply to all" action after preview approval.

6. **State persistence (next)**
   - Persist last-used preset and advanced override preference per shop/user.
   - Keep first-time default opinionated (`Auto`) for new merchants.

7. **Instrumentation (next)**
   - Track funnel events:
     - upload started
     - crop run started
     - crop run completed
     - preset selected
     - advanced opened
   - Use this to validate conversion impact of the redesign.

## Acceptance criteria for redesign
- A first-time merchant can upload and run without opening advanced settings.
- Default flow requires no crop-strategy vocabulary.
- Preset selection is understandable in non-technical language.
- Advanced controls are discoverable but do not dominate first render.
