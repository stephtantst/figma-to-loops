# figma-to-loops

A tool that exports Figma email frames as Loops-ready MJML + images ZIP files.

## What it does

- Fetches the Figma node tree via the REST API
- Rasterizes image nodes at 2x resolution
- Auto-detects gradient fills and generates gradient PNG backgrounds
- Reads fonts, colors, and layout directly from Figma
- Outputs a ZIP containing `index.mjml` + `img/` folder ready for Loops

## How to use

### Quick export (generic)

Works for most designs. Run from the project root:

```bash
FIGMA_TOKEN=figd_... node export-api.js "<figma-url>"
```

The Figma URL should point to a specific frame (include `?node-id=...`).

Output: `<frame-name>_loops.zip` in the project root.

### What the generic exporter handles automatically

- Font families and weights (read directly from Figma)
- Solid background colors
- Gradient backgrounds → generates `img/gradient_N.png` PNG files
- Rasterized images (fills, logos, photos, social icon groups)
- Text (size, weight, color, alignment, line-height)
- Buttons (gradient → solid fill approximation)
- Spacers and dividers
- Multi-column layouts

### When you still need a custom script

The generic exporter can't handle these cases without a custom script:

| Issue | Symptom | Fix |
|-------|---------|-----|
| Rounded-corner cards | Stat/icon cards lose `border-radius` | Use `mj-raw` with HTML table (see `export-duitnow-custom.js` `statCard` helper) |
| Mixed font sizes in one block | CTA has heading + body at different sizes | Split into separate `mj-text` elements |
| Inline color spans | `(MY)` in title should be blue | Add `<span style="color:#2388ff;">` manually |
| Numbered/bulleted lists | Steps render as plain text with `<br/>` | Use `<ol>/<ul>` in `mj-raw` |

### Creating a custom script

Copy `export-duitnow-custom.js` or `export-tng-custom.js` as a starting point.

Key things to update:
1. `RASTER_NODES` — node IDs from the Figma MCP design context (shown as `data-node-id` attributes)
2. `generateMJML()` — hand-craft the MJML using the design context as reference
3. Gradient PNGs — `makeHeroGradient()` and `makeBannerGradient()` are pre-built for the HitPay blue gradient; reuse them or derive new ones from the Figma `rgba(...)` stops

Run a custom script:

```bash
FIGMA_TOKEN=figd_... node export-<name>-custom.js
```

## Getting a Figma token

Figma → Settings → Account → Personal access tokens → Generate new token.
Token starts with `figd_...`.

## Using the Claude skill

In Claude Code, run `/loops-zip` (or ask to "generate the zip") and provide:
1. Your Figma token
2. The Figma frame URL

Claude will run the generic exporter, compare the output against the Figma screenshot, and fix any issues (gradients, layouts, fonts) — creating a custom script if needed.

## How to use the ZIP in Loops

1. Host the `img/` images on a CDN (S3, Cloudinary, Cloudflare R2, etc.)
2. Replace `src="img/foo.png"` paths in `index.mjml` with absolute CDN URLs
3. Compile: `npx mjml index.mjml -o index.html`
4. In Loops: **Settings → Templates → Import** → paste the HTML
5. `{unsubscribe_link}` is automatically replaced by Loops at send time

## Project structure

```
export-api.js               Generic exporter (use this first)
export-duitnow-custom.js    Custom script for DuitNow XB EDM
export-tng-custom.js        Custom script for TnG Recurring EDM
skills/loops-zip/SKILL.md   Claude Code skill definition (version-controlled here)
src/                        Figma plugin source (separate tool)
manifest.json               Figma plugin manifest
```

## Installing the Claude skill

The `skills/loops-zip/SKILL.md` file is the source of truth for the `/loops-zip` Claude Code skill. To install or update it on a new machine:

```bash
mkdir -p ~/.claude/skills/loops-zip
cp skills/loops-zip/SKILL.md ~/.claude/skills/loops-zip/SKILL.md
```

After pulling changes, re-run this command to sync the skill to Claude Code.

## Font notes

Fonts are always set exactly as specified in Figma — no Arial fallback. The three fonts used across HitPay email templates are:

- `MD Nichrome Test` — headings and hero title
- `Hauora` — body text, stat cards, CTA copy, default fallback for unclassified text
- `Inter` — footer address and unsubscribe link

When writing or editing custom scripts, never add `, Arial, sans-serif` after a font name. If a font name is unknown or missing from the Figma node, default to `Hauora`.
