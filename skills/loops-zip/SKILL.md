---
name: loops-zip
description: Use this skill when the user provides a Figma URL and wants to generate a Loops-ready MJML + images ZIP file. Triggers on phrases like "generate the zip", "export to Loops", "figma to loops", or when the user shares a figma.com/design URL and asks for a ZIP.
version: 1.1.0
---

# Figma → Loops ZIP Generator

Generate a Loops-ready MJML + images ZIP from a Figma frame URL.

## Setup check

First, check if `FIGMA_TOKEN` is set:
```bash
echo "FIGMA_TOKEN set: ${FIGMA_TOKEN:+yes}"
```
If not set, ask the user for their Figma personal access token (Figma → Settings → Account → Personal access tokens). It looks like `figd_...`.

## Step 1 — Get Figma design context

Use the Figma MCP `get_design_context` tool with:
- `fileKey`: extracted from the URL (e.g. `figma.com/design/:fileKey/...`)
- `nodeId`: from `?node-id=12347-2777` → convert `-` to `:` → `12347:2777`

This returns a screenshot and component code showing the exact layout — use it to understand the design structure before generating.

## Step 2 — Run the generic export

From `/Users/stephtan/Documents/GitHub/figma-to-loops`:
```bash
FIGMA_TOKEN=<token> node export-api.js "<figma-url>"
```

The generic exporter now handles automatically:
- **Fonts** — reads font family, size, weight, color directly from Figma node tree
- **Gradient backgrounds** — auto-detects gradient fills and generates `img/gradient_N.png` PNG files referenced via `background-url`
- **Raster images** — all `📷 Image`, logo, and `🐦 Social` nodes exported at 2x

## Step 3 — Review and fix remaining issues

Compare the generated `index.mjml` against the Figma MCP screenshot. The generic exporter handles gradients and fonts correctly — only fix these if present:

**Rounded stat/icon cards** (icon left, text right, `#f9f9fb` gray rounded background) — The generic exporter renders each card as a plain `mj-section` with no `border-radius`. To get rounded corners, create a custom script using `mj-raw` with nested tables. Set `border-radius:8px` on the outer `<td>`. See the `statCard` helper in `export-tng-custom.js` or `export-duitnow-custom.js`.

**Multi-column layouts** (3 columns like "Who Benefits") — Use `mj-raw` with an HTML table instead of 3 `mj-column` elements. Column widths must sum to (600 - left padding - right padding). See the `whoCol` helper in `export-duitnow-custom.js`.

**Two-column split rows** (text left + image right like "3 Powerful Ways") — Use `mj-raw` with a 2-column table. See the `wayRow` helper in `export-duitnow-custom.js`.

**Mixed font sizes in one text block** — If a CTA section has a large heading + smaller body text in the same node, the generic exporter renders them as one `mj-text` at the heading size. Split into separate `mj-text` elements in a custom script.

**Inline color spans** — Text runs with a different color (e.g. `(MY)` in blue) are flattened to plain text. Add `<span style="color:#XXXXXX;">` manually in the custom script.

**Numbered/bulleted lists** — List items render as flat `<br/>`-separated text. Replace with `<ol>/<ul>` inside `mj-raw` in a custom script.

**Button URLs** — Replace `href="#"` placeholders with real URLs from the design (usually `https://dashboard.hit-pay.com/` for CTAs).

## Step 4 — Rebuild ZIP if fixes were needed

If you rewrote sections, create a custom script (named `export-<frame-name>-custom.js`) modelled on `export-tng-custom.js`:
- `RASTER_NODES` array — node IDs from the MCP output `data-node-id` attributes
- `generateMJML()` — hand-crafted MJML using correct font families (`'MD Nichrome Test', Arial, sans-serif` / `'Hauora', Arial, sans-serif` / `'Inter', Arial, sans-serif`) — **never replace with just `Arial`**
- Gradient PNGs — `makeHeroGradient()` / `makeBannerGradient()` are pre-built for the standard HitPay blue gradient; reuse or derive new ones from the MCP `rgba(...)` stop values

Run it:
```bash
FIGMA_TOKEN=<token> node export-<frame-name>-custom.js
```

## Step 5 — Report

State the ZIP path, file size, image count, and any sections that needed manual fixes.

## Reference files (in `/Users/stephtan/Documents/GitHub/figma-to-loops`)
- `export-api.js` — generic exporter; handles fonts + gradients automatically; use this first
- `export-tng-custom.js` — custom script for TnG Recurring (rounded cards, lists, inline spans)
- `export-duitnow-custom.js` — custom script for DuitNow XB (3-col grid, 2-col split rows, help banner)
- `CLAUDE.md` — full reference for when generic vs custom scripts are needed
