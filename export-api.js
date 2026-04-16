// ---------------------------------------------------------------------------
// export-api.js — Figma → semantic MJML + images ZIP via REST API
// Usage: FIGMA_TOKEN=xxx node export-api.js <figma-url>
// ---------------------------------------------------------------------------

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const zlib  = require('zlib');

// ---------------------------------------------------------------------------
// PNG generation (no external deps) — used for gradient backgrounds
// ---------------------------------------------------------------------------

function makePNG(width, height, getPixel) {
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[i] = c;
  }
  function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function u32(n) { return [(n>>>24)&0xff,(n>>>16)&0xff,(n>>>8)&0xff,n&0xff]; }
  function chunk(type, data) {
    const tb = Buffer.from(type, 'ascii');
    const crc = u32(crc32(Buffer.concat([tb, data])));
    return Buffer.concat([Buffer.from(u32(data.length)), tb, data, Buffer.from(crc)]);
  }
  const raw = [];
  for (let y = 0; y < height; y++) {
    raw.push(0);
    for (let x = 0; x < width; x++) {
      const [r, g, b] = getPixel(x, y, width, height);
      raw.push(r & 0xff, g & 0xff, b & 0xff);
    }
  }
  const ihdr = Buffer.from([...u32(width), ...u32(height), 8, 2, 0, 0, 0]);
  const idat = zlib.deflateSync(Buffer.from(raw), { level: 6 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Generate a gradient PNG from Figma GRADIENT_LINEAR fill stops.
 * Blends each semi-transparent stop color against white (#ffffff).
 * Always renders top-to-bottom (covers the common vertical email gradient).
 */
function makeGradientPNG(stops, width, height) {
  // Sort stops by position (0=start, 1=end); map to blended RGB over white
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const pts = sorted.map(s => {
    const { r, g, b, a } = s.color;
    const alpha = a !== undefined ? a : 1;
    return {
      pos: s.position,
      r: Math.round((r * alpha + (1 - alpha)) * 255),
      g: Math.round((g * alpha + (1 - alpha)) * 255),
      b: Math.round((b * alpha + (1 - alpha)) * 255),
    };
  });

  return makePNG(width, height, (x, y, w, h) => {
    const t = h > 1 ? y / (h - 1) : 0; // 0=top, 1=bottom
    // Find surrounding stops
    let lo = pts[0], hi = pts[pts.length - 1];
    for (let i = 0; i < pts.length - 1; i++) {
      if (t >= pts[i].pos && t <= pts[i + 1].pos) { lo = pts[i]; hi = pts[i + 1]; break; }
    }
    const span = hi.pos - lo.pos;
    const f = span > 0 ? (t - lo.pos) / span : 0;
    return [
      Math.round(lo.r + f * (hi.r - lo.r)),
      Math.round(lo.g + f * (hi.g - lo.g)),
      Math.round(lo.b + f * (hi.b - lo.b)),
    ];
  });
}

const TOKEN   = process.env.FIGMA_TOKEN;
const RAW_URL = process.argv[2];

if (!TOKEN || !RAW_URL) {
  console.error('Usage: FIGMA_TOKEN=xxx node export-api.js <figma-url>');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

function parseUrl(raw) {
  const u = new URL(raw);
  const parts = u.pathname.split('/');
  const fileKey = parts[2];
  const nodeParam = u.searchParams.get('node-id');
  if (!fileKey || !nodeParam) throw new Error('Could not parse file key or node-id from URL');
  return { fileKey, nodeId: nodeParam.replace(/-/g, ':') };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function fetchBuf(url, headers) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchBuf(res.headers.location, headers).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function figmaGet(apiPath) {
  return fetchBuf('https://api.figma.com/v1' + apiPath, { 'X-Figma-Token': TOKEN })
    .then(buf => JSON.parse(buf.toString()));
}

function safeName(str) {
  return str.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 40);
}

function safeId(str) {
  return str.replace(/[^a-z0-9]/gi, '_').slice(0, 40);
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function rgbToHex(r, g, b) {
  const h = n => Math.round(n * 255).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

function solidFill(fills) {
  if (!fills) return null;
  for (const f of fills) {
    if (f.type === 'SOLID' && f.visible !== false && (f.opacity === undefined || f.opacity > 0.1)) {
      const { r, g, b } = f.color;
      return rgbToHex(r, g, b);
    }
  }
  return null;
}

function gradientFill(fills) {
  if (!fills) return null;
  for (const f of fills) {
    if (f.type && f.type.startsWith('GRADIENT') && f.visible !== false && f.gradientStops) {
      return f;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Node classification
// ---------------------------------------------------------------------------

function hasImageFill(node) {
  return (node.fills || []).some(f => f.type === 'IMAGE' && f.visible !== false);
}

// Detect logo frame: has only vector children (no IMAGE fill)
function isLogoFrame(node) {
  if (node.type !== 'FRAME') return false;
  const name = node.name || '';
  // Named like the Figma image hash pattern, or explicitly "HitPay"
  return name.includes('HitPay') || /^[a-f0-9]{20,}/.test(name);
}

// Social icons container
function isSocialFrame(node) {
  return (node.name || '').includes('\u{1F426}'); // 🐦
}

// Button: FRAME named 🔗 Button with gradient fill
function isButtonFrame(node) {
  return (node.type === 'FRAME' || node.type === 'INSTANCE') &&
    (node.name || '').includes('\u{1F517}'); // 🔗
}

// Spacer: FRAME named 📐 Spacer
function isSpacerFrame(node) {
  return (node.name || '').includes('\u{1F4D0}'); // 📐
}

// Divider: RECTANGLE named ➖ Divider
function isDividerRect(node) {
  return node.type === 'RECTANGLE' && (node.name || '').includes('\u{2796}'); // ➖
}

// Image frame: FRAME named 📷 Image with IMAGE fill
function isImageFrame(node) {
  return (node.name || '').includes('\u{1F4F7}'); // 📷
}

// ---------------------------------------------------------------------------
// Rasterizable node collection (first pass)
// ---------------------------------------------------------------------------

// Map of nodeId → { id, name, filename } for all nodes needing rasterization
const rasterMap = new Map();

function collectRasterNodes(node, depth) {
  if (node.visible === false) return;

  if (depth >= 1) {
    if (isLogoFrame(node) || isSocialFrame(node) || hasImageFill(node)) {
      if (!rasterMap.has(node.id)) {
        const fname = 'img/' + safeName(node.name) + '_' + safeId(node.id) + '.png';
        rasterMap.set(node.id, {
          id: node.id,
          name: node.name,
          filename: fname,
          width: node.absoluteBoundingBox ? node.absoluteBoundingBox.width : 0,
          height: node.absoluteBoundingBox ? node.absoluteBoundingBox.height : 0,
        });
      }
      return; // Don't recurse — this whole subtree is one image
    }
  }

  for (const child of (node.children || [])) {
    collectRasterNodes(child, depth + 1);
  }
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function looksLikeHtml(str) {
  return /<[a-zA-Z][\s\S]*?>/.test(str);
}

function formatTextContent(characters) {
  if (!characters) return '';
  // Raw HTML (e.g. unsubscribe link) — pass through unchanged
  if (looksLikeHtml(characters)) return characters;
  // Escape and convert newlines/line-separators to <br/>
  return escapeXml(characters)
    .replace(/\u2028/g, '<br/>')
    .replace(/\n/g, '<br/>');
}

function mjmlAlign(align) {
  if (align === 'CENTER') return 'center';
  if (align === 'RIGHT') return 'right';
  if (align === 'JUSTIFIED') return 'justify';
  return 'left';
}

// ---------------------------------------------------------------------------
// MJML element generators
// ---------------------------------------------------------------------------

function genText(node) {
  const style = node.style || {};
  const color = solidFill(node.fills) || '#000000';
  const fontFamilyRaw = style.fontFamily || 'Hauora';
  const fontFamily = escapeXml(fontFamilyRaw);
  const fontSize = style.fontSize ? Math.round(style.fontSize) + 'px' : '14px';
  const fontWeight = style.fontWeight || 400;
  const lineHeight = style.lineHeightPx ? Math.round(style.lineHeightPx) + 'px' : '1.5';
  const align = mjmlAlign(style.textAlignHorizontal);
  const content = formatTextContent(node.characters || '');

  let attrs = [
    'font-family="' + fontFamily + '"',
    'font-size="' + fontSize + '"',
    'color="' + color + '"',
    'align="' + align + '"',
    'line-height="' + lineHeight + '"',
    'padding="0"',
  ];
  if (fontWeight !== 400) attrs.push('font-weight="' + fontWeight + '"');

  return '<mj-text ' + attrs.join(' ') + '>' + content + '</mj-text>';
}

function genImageEl(filename, widthPx, alt) {
  const w = Math.round(widthPx) + 'px';
  return '<mj-image src="' + filename + '" width="' + w + '" alt="' + escapeXml(alt || '') + '" padding="0" />';
}

function genButton(node) {
  const textChild = (node.children || []).find(c => c.type === 'TEXT' && c.visible !== false);
  const label = textChild ? (textChild.characters || 'Click Here') : 'Click Here';
  const textColor = solidFill(textChild ? textChild.fills : null) || '#ffffff';
  const radius = node.cornerRadius ? Math.round(node.cornerRadius) + 'px' : '8px';
  const nodeH = node.absoluteBoundingBox ? node.absoluteBoundingBox.height : 40;
  const pv = Math.max(8, Math.round((nodeH - 16) / 2)) + 'px';

  // Use first gradient stop color as solid background
  let bgColor = '#4179e1';
  const gradFill = (node.fills || []).find(f => f.type && f.type.startsWith('GRADIENT'));
  if (gradFill && gradFill.gradientStops && gradFill.gradientStops[0]) {
    const s = gradFill.gradientStops[0].color;
    bgColor = rgbToHex(s.r, s.g, s.b);
  }

  const labelHtml = looksLikeHtml(label) ? label : escapeXml(label);

  return (
    '<mj-button ' +
    'background-color="' + bgColor + '" ' +
    'color="' + textColor + '" ' +
    'border-radius="' + radius + '" ' +
    'inner-padding="' + pv + ' 24px" ' +
    'href="#" ' +
    'align="center"' +
    '>' +
    '<span style="color:' + textColor + ';font-weight:700;">' + labelHtml + '</span>' +
    '</mj-button>'
  );
}

function genSpacer(heightPx) {
  return '<mj-spacer height="' + Math.round(heightPx) + 'px" />';
}

function genDivider(node) {
  const color = solidFill(node.fills) || '#e0e0e0';
  const h = node.absoluteBoundingBox ? Math.max(1, Math.round(node.absoluteBoundingBox.height)) : 1;
  return '<mj-divider border-color="' + color + '" border-width="' + h + 'px" padding="4px 0" />';
}

// ---------------------------------------------------------------------------
// Column content — recursively maps leaf nodes to MJML elements
// ---------------------------------------------------------------------------

function genColumnContent(items, maxWidth) {
  const out = [];

  for (const item of items) {
    if (item.visible === false) continue;

    // TEXT node
    if (item.type === 'TEXT') {
      out.push(genText(item));
      continue;
    }

    // Spacer frame
    if (isSpacerFrame(item)) {
      const h = item.absoluteBoundingBox ? item.absoluteBoundingBox.height : 8;
      out.push(genSpacer(h));
      continue;
    }

    // Divider rectangle
    if (isDividerRect(item)) {
      out.push(genDivider(item));
      continue;
    }

    // Button frame
    if (isButtonFrame(item)) {
      out.push(genButton(item));
      continue;
    }

    // Rasterized node (logo, image, social)
    const raster = rasterMap.get(item.id);
    if (raster) {
      const w = item.absoluteBoundingBox ? item.absoluteBoundingBox.width : maxWidth;
      out.push(genImageEl(raster.filename, Math.min(w, maxWidth), item.name));
      continue;
    }

    // Recurse into container children (FRAME, GROUP, INSTANCE without special classification)
    const kids = (item.children || []).filter(c => c.visible !== false);
    if (kids.length > 0) {
      out.push(...genColumnContent(kids, maxWidth));
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Section generation
// ---------------------------------------------------------------------------

// Gradient files collected during section generation — populated by genMjSection
const gradientFiles = new Map(); // filename → Buffer
let gradientCounter = 0;

/**
 * Generates one <mj-section> from a HORIZONTAL row node.
 * padding override allows wrapper sections to distribute their padding.
 * Gradient fills are auto-converted to PNG backgrounds.
 */
function genMjSection(row, frameWidth, padOverride) {
  const bg = solidFill(row.fills);
  const grad = !bg ? gradientFill(row.fills) : null;

  const pt = padOverride && padOverride.top   !== undefined ? padOverride.top   : (row.paddingTop    || 0);
  const pr = padOverride && padOverride.right !== undefined ? padOverride.right : (row.paddingRight  || 0);
  const pb = padOverride && padOverride.bot   !== undefined ? padOverride.bot   : (row.paddingBottom || 0);
  const pl = padOverride && padOverride.left  !== undefined ? padOverride.left  : (row.paddingLeft   || 0);

  const pad = Math.round(pt) + 'px ' + Math.round(pr) + 'px ' + Math.round(pb) + 'px ' + Math.round(pl) + 'px';
  const n = '\n';

  let bgAttr = bg ? ' background-color="' + bg + '"' : '';
  if (grad) {
    // Generate gradient PNG and use as background-url (scales to fill via background-size)
    const gradFile = 'img/gradient_' + (++gradientCounter) + '.png';
    const bbox = row.absoluteBoundingBox;
    const gWidth = bbox ? Math.round(bbox.width) : frameWidth;
    const gHeight = bbox ? Math.max(Math.round(bbox.height), 4) : 200;
    gradientFiles.set(gradFile, makeGradientPNG(grad.gradientStops, gWidth, gHeight));
    // Fallback color = top stop blended with white
    const topStop = grad.gradientStops[0];
    const tc = topStop.color;
    const ta = tc.a !== undefined ? tc.a : 1;
    const fallback = rgbToHex(tc.r * ta + (1 - ta), tc.g * ta + (1 - ta), tc.b * ta + (1 - ta));
    bgAttr = ' background-url="' + gradFile + '" background-size="100% 100%" background-color="' + fallback + '"';
  }

  let out = '<mj-section' + bgAttr + ' padding="' + pad + '">' + n;

  const visibleCols = (row.children || []).filter(c => c.visible !== false);
  const innerWidth = frameWidth - Math.round(pl) - Math.round(pr);

  for (const col of visibleCols) {
    const colBg = solidFill(col.fills);
    const colBbox = col.absoluteBoundingBox;

    // Use pixel width from Figma bounding box when multiple columns exist
    let colWidthAttr = '';
    if (visibleCols.length > 1 && colBbox) {
      colWidthAttr = ' width="' + Math.round(colBbox.width) + 'px"';
    }

    const colBgAttr = colBg ? ' background-color="' + colBg + '"' : '';
    out += '  <mj-column' + colBgAttr + colWidthAttr + '>' + n;

    const colMaxWidth = colBbox ? Math.round(colBbox.width) : innerWidth;
    const visibleItems = (col.children || []).filter(i => i.visible !== false);
    const elements = genColumnContent(visibleItems, colMaxWidth);

    for (const el of elements) {
      out += '    ' + el + n;
    }
    out += '  </mj-column>' + n;
  }

  out += '</mj-section>';
  return out;
}

/**
 * Converts one top-level Figma section to one or more mj-section strings.
 * VERTICAL wrapper sections (like "🎁 ...") produce one mj-section per visible sub-row.
 */
function genTopLevelSection(sec, frameWidth) {
  if (sec.layoutMode === 'VERTICAL') {
    const visRows = (sec.children || []).filter(r => r.visible !== false);
    const parts = [];

    for (let ri = 0; ri < visRows.length; ri++) {
      const row = visRows[ri];
      // Use the sub-row's own padding; supplement with wrapper top/bottom on edge rows
      const padOverride = {
        top:   ri === 0 ? Math.max(row.paddingTop || 0, sec.paddingTop || 0) : (row.paddingTop || 0),
        right: Math.max(row.paddingRight || 0, sec.paddingRight || 0),
        bot:   ri === visRows.length - 1 ? Math.max(row.paddingBottom || 0, sec.paddingBottom || 0) : (row.paddingBottom || 0),
        left:  Math.max(row.paddingLeft || 0, sec.paddingLeft || 0),
      };
      parts.push(genMjSection(row, frameWidth, padOverride));
    }
    return parts.join('\n');
  }

  return genMjSection(sec, frameWidth, null);
}

// ---------------------------------------------------------------------------
// Full MJML document
// ---------------------------------------------------------------------------

function generateMJML(doc, frameName, frameWidth) {
  const w = Math.round(frameWidth);
  const n = '\n';

  // Collect font families used
  const customFonts = new Set();
  const webSafe = new Set(['Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New', 'Trebuchet MS']);

  function collectFonts(node) {
    if (node.visible === false) return;
    const fam = node.style && node.style.fontFamily;
    if (fam && !webSafe.has(fam)) customFonts.add(fam);
    for (const child of (node.children || [])) collectFonts(child);
  }
  for (const sec of (doc.children || [])) collectFonts(sec);

  const fontDecls = [...customFonts].map(f => {
    const encoded = encodeURIComponent(f).replace(/%20/g, '+');
    return '    <mj-font name="' + escapeXml(f) + '" href="https://fonts.googleapis.com/css2?family=' + encoded + ':wght@400;500;600;700&display=swap" />';
  }).join(n);

  const lines = [
    '<mjml>',
    '  <mj-head>',
    fontDecls,
    '    <mj-attributes>',
    '      <mj-all font-family="Hauora" />',
    '      <mj-body width="' + w + 'px" />',
    '      <mj-text padding="0" />',
    '      <mj-image padding="0" />',
    '      <mj-section padding="0" />',
    '    </mj-attributes>',
    '  </mj-head>',
    '  <mj-body width="' + w + 'px">',
  ];

  for (const sec of (doc.children || [])) {
    if (sec.visible === false) continue;
    const sectionMjml = genTopLevelSection(sec, frameWidth);
    for (const line of sectionMjml.split('\n')) {
      lines.push('    ' + line);
    }
  }

  lines.push('  </mj-body>');
  lines.push('</mjml>');

  return lines.filter(l => l.trim() !== '').join(n) + n;
}

// ---------------------------------------------------------------------------
// README
// ---------------------------------------------------------------------------

function generateReadme(frameName, imageCount) {
  const n = '\n';
  return (
    'Figma to Loops Export' + n +
    '======================' + n +
    'Frame    : ' + frameName + n +
    'Generated: ' + new Date().toISOString() + n +
    'Images   : ' + imageCount + n +
    n +
    'CONTENTS' + n +
    '--------' + n +
    'index.mjml   -- MJML email template (semantic: text, buttons, images)' + n +
    'img/         -- PNG images at 2x resolution for retina displays' + n +
    n +
    'HOW TO USE WITH LOOPS' + n +
    '---------------------' + n +
    '1. Host images on a CDN (S3, Cloudinary, Cloudflare R2, etc.)' + n +
    '2. Replace relative img/ paths in the MJML with absolute URLs:' + n +
    '     src="img/hero.png"  ->  src="https://your-cdn.com/hero.png"' + n +
    '3. Compile MJML to HTML:' + n +
    '     npx mjml index.mjml -o index.html' + n +
    '4. In Loops: Settings > Templates > Import > paste the HTML.' + n +
    n +
    'NOTES' + n +
    '-----' + n +
    '- Button href="#" placeholders should be replaced with real URLs' + n +
    '- {unsubscribe_link} in the footer is replaced by Loops at send time' + n +
    '- Custom fonts (MD Nichrome Trial, Hauora, Inter) load via Google Fonts' + n +
    n +
    'MJML REFERENCE' + n +
    '--------------' + n +
    'https://mjml.io/documentation' + n +
    'https://loops.so/docs' + n
  );
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

async function buildZip(outPath, files) {
  const JSZip = require('./node_modules/jszip');
  const zip = new JSZip();
  for (const [name, data] of files) {
    zip.file(name, data);
  }
  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(outPath, buf);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { fileKey, nodeId } = parseUrl(RAW_URL);
  console.log('File key : ' + fileKey);
  console.log('Node ID  : ' + nodeId);

  // 1. Fetch node tree
  console.log('\nFetching node tree…');
  const resp = await figmaGet('/files/' + fileKey + '/nodes?ids=' + encodeURIComponent(nodeId));
  const doc  = resp.nodes[nodeId] && resp.nodes[nodeId].document;
  if (!doc) throw new Error('Node not found in API response');

  const frameName  = doc.name;
  const frameWidth = doc.absoluteBoundingBox ? doc.absoluteBoundingBox.width : 600;
  console.log('Frame    : "' + frameName + '" (' + Math.round(frameWidth) + 'px wide)');

  // 2. Collect all nodes that need to be rasterized
  for (const child of (doc.children || [])) {
    collectRasterNodes(child, 1);
  }
  console.log('Rasterize: ' + rasterMap.size + ' image node(s)');

  // 3. Batch export all rasterizable nodes via Figma Images API
  const imageData = new Map(); // nodeId → Buffer
  if (rasterMap.size > 0) {
    console.log('\nRequesting image renders from Figma…');
    const ids = [...rasterMap.keys()];
    const imgResp = await figmaGet(
      '/images/' + fileKey + '?ids=' + encodeURIComponent(ids.join(',')) + '&format=png&scale=2'
    );
    if (imgResp.err) throw new Error('Figma image export error: ' + imgResp.err);

    // 4. Download all images
    console.log('Downloading ' + Object.keys(imgResp.images).length + ' image(s)…');
    let dlIdx = 0;
    for (const [nodeId, meta] of rasterMap) {
      const url = imgResp.images[nodeId];
      dlIdx++;
      process.stdout.write('  [' + dlIdx + '/' + rasterMap.size + '] ' + meta.name.slice(0, 50) + '… ');
      if (url) {
        const buf = await fetchBuf(url, {});
        imageData.set(nodeId, buf);
        process.stdout.write(Math.round(buf.length / 1024) + ' KB\n');
      } else {
        process.stdout.write('(no render)\n');
      }
    }
  }

  // 5. Generate MJML (gradient PNG generation happens as a side-effect here)
  console.log('\nGenerating MJML…');
  const mjml   = generateMJML(doc, frameName, frameWidth);
  const readme = generateReadme(frameName, imageData.size);

  if (gradientFiles.size > 0) {
    console.log('Generated ' + gradientFiles.size + ' gradient PNG(s)');
  }

  // 6. Assemble ZIP
  const zipFiles = [['index.mjml', mjml]];

  for (const [nodeId, meta] of rasterMap) {
    const buf = imageData.get(nodeId);
    if (buf) {
      zipFiles.push([meta.filename, buf]);
    }
  }
  for (const [fname, buf] of gradientFiles) {
    zipFiles.push([fname, buf]);
  }
  zipFiles.push(['README.txt', readme]);

  // 7. Write ZIP
  const zipName = safeName(frameName) + '_loops.zip';
  const zipPath = path.join(__dirname, zipName);
  console.log('\nBuilding ZIP → ' + zipName);
  await buildZip(zipPath, zipFiles);

  const sizeKB = Math.round(fs.statSync(zipPath).size / 1024);
  console.log('\nDone! ' + zipName + ' (' + sizeKB + ' KB)');
  console.log('Path: ' + zipPath);
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
