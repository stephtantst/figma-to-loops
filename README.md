# figma-to-loops

Export Figma email frames to Loops-ready MJML + images ZIPs — no design tools, no copy-paste.

## How it works

1. Points at a Figma frame URL
2. Fetches the node tree and rasterises all images at 2×
3. Auto-generates gradient PNGs for gradient-background sections
4. Reads fonts, colors, padding, and text directly from Figma
5. Outputs a ZIP with `index.mjml` + an `img/` folder, ready to drop into [Loops](https://loops.so)

---

## Prerequisites

- **Node.js** v18+
- **A Figma personal access token** — Figma → Settings → Account → Personal access tokens → Generate. Starts with `figd_...`

Install dependencies once:

```bash
npm install
```

---

## Quick start

```bash
FIGMA_TOKEN=figd_... node export-api.js "https://www.figma.com/design/<fileKey>/...?node-id=123-456"
```

The URL must point to a specific frame (include `?node-id=...`).

Output: `<frame-name>_loops.zip` in the project root.

---

## What gets exported automatically

| Element | Handled |
|---------|---------|
| Font family, size, weight, color | ✅ |
| Solid background colors | ✅ |
| Gradient backgrounds | ✅ auto-generates PNG |
| Images, logos, photos | ✅ 2× resolution |
| Social icon groups | ✅ |
| Buttons | ✅ gradient → solid approximation |
| Spacers, dividers | ✅ |
| Multi-column layouts | ✅ |

---

## Using the output in Loops

1. **Host images** — upload the `img/` folder to a CDN (S3, Cloudinary, Cloudflare R2, etc.)
2. **Swap paths** — replace `src="img/foo.png"` with your CDN URLs in `index.mjml`
3. **Compile to HTML**:
   ```bash
   npx mjml index.mjml -o index.html
   ```
4. **Import into Loops** — Settings → Templates → Import → paste the HTML
5. `{unsubscribe_link}` is automatically replaced by Loops at send time

---

## When you need a custom script

The generic exporter covers most designs. For pixel-perfect output, create a custom script when:

| Issue | Symptom |
|-------|---------|
| Rounded-corner cards | Stat/icon cards lose `border-radius` |
| Mixed font sizes in one block | CTA heading + body text render at the same size |
| Inline colour spans | e.g. `(MY)` in a different colour gets flattened |
| Numbered / bulleted lists | Steps render as plain `<br/>`-separated text |

Use `export-tng-custom.js` as a starting point — it covers all of the above patterns.

### Custom script steps

1. Copy `export-tng-custom.js` → `export-<frame-name>-custom.js`
2. Update `RASTER_NODES` with node IDs from the Figma design (visible in the MCP `data-node-id` attributes)
3. Rewrite `generateMJML()` using the design as reference — keep the font families (`'MD Nichrome Test'`, `'Hauora'`, `'Inter'`)
4. Run:
   ```bash
   FIGMA_TOKEN=figd_... node export-<frame-name>-custom.js
   ```

---

## Using the Claude Code skill

If you're using [Claude Code](https://claude.ai/code), a `/loops-zip` skill is included. It automates the whole flow:

1. Install the skill (one-time):
   ```bash
   mkdir -p ~/.claude/skills/loops-zip
   cp skills/loops-zip/SKILL.md ~/.claude/skills/loops-zip/SKILL.md
   ```
2. In Claude Code, run `/loops-zip` (or say "generate the zip")
3. Provide your Figma token and frame URL when prompted

Claude will run the generic exporter, compare against the Figma screenshot, and create a custom script if any layout issues are detected.

---

## Project structure

```
export-api.js               Generic exporter — use this first
export-duitnow-custom.js    Custom script: DuitNow XB EDM
export-tng-custom.js        Custom script: TnG Recurring EDM
skills/loops-zip/SKILL.md   Claude Code skill definition
src/                        Figma plugin source (separate tool)
CLAUDE.md                   Reference for Claude Code agents
```

---

## Font compatibility

Fonts are always set exactly as defined in the Figma file — no fallbacks.

| Font | Used for |
|------|----------|
| MD Nichrome Test | Headings (Benefits, Merchant Onboarding, etc.) and hero title |
| Hauora | Body text, stat card labels, CTA copy |
| Inter | Footer address and unsubscribe link |

MD Nichrome Test and Hauora are not on Google Fonts. To ensure they render correctly in all email clients, host the font files and add `@font-face` declarations — or load them via a font delivery service before sending.
