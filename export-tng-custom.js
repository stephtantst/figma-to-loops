// ---------------------------------------------------------------------------
// export-tng-custom.js — Hand-crafted export for TnG Recurring EDM
// Usage: FIGMA_TOKEN=xxx node export-tng-custom.js
// ---------------------------------------------------------------------------

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const zlib  = require('zlib');

// ---------------------------------------------------------------------------
// PNG generation (no external deps)
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

// Hero title gradient: top=#EAF3FF → via #F5F9FF → bottom=white
// Figma: bg-gradient-to-t from rgba(255,255,255,0.2)@3.5% via rgba(204,225,255,0.2)@70.5% to rgba(152,194,255,0.2)@top
function makeHeroGradient() {
  return makePNG(600, 200, (x, y, w, h) => {
    const t = y / (h - 1); // 0=top, 1=bottom
    let r, g, b;
    if (t < 0.295) {
      const f = t / 0.295;
      r = Math.round(234 + f * 11);
      g = Math.round(243 + f * 6);
      b = 255;
    } else {
      const f = Math.min((t - 0.295) / 0.67, 1);
      r = Math.round(245 + f * 10);
      g = Math.round(249 + f * 6);
      b = 255;
    }
    return [r, g, b];
  });
}

// CTA banner gradient: top=#EAF3FF → via #F5F9FF → bottom≈warm white #FFFEF6
// Figma: bg-gradient-to-t from rgba(255,251,209,0.2)@3.5% via rgba(204,225,255,0.2)@70.5% to rgba(152,194,255,0.2)@top
function makeBannerGradient() {
  return makePNG(600, 300, (x, y, w, h) => {
    const t = y / (h - 1);
    let r, g, b;
    if (t < 0.295) {
      const f = t / 0.295;
      r = Math.round(234 + f * 11);
      g = Math.round(243 + f * 6);
      b = 255;
    } else if (t < 0.965) {
      const f = (t - 0.295) / 0.67;
      r = Math.round(245 + f * 10);
      g = Math.round(249 + f * 5);
      b = Math.round(255 - f * 9);
    } else {
      r = 255; g = 254; b = 246;
    }
    return [r, g, b];
  });
}

const TOKEN    = process.env.FIGMA_TOKEN;
const FILE_KEY = 'v9uHxHSrA9hWQYT2et0bUc';

if (!TOKEN) {
  console.error('Usage: FIGMA_TOKEN=xxx node export-tng-custom.js');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Image nodes — from Figma design context, unique filenames
// ---------------------------------------------------------------------------

const RASTER_NODES = [
  { id: 'I12291:2916;457:4105',   file: 'img/logo.png' },
  { id: 'I12291:2918;450:1979',   file: 'img/hero.png' },
  { id: 'I12291:32810;1619:5774', file: 'img/icon_1.png' },
  { id: 'I12291:32811;1619:5769', file: 'img/icon_2.png' },
  { id: 'I12291:32812;1619:5769', file: 'img/icon_3.png' },
  { id: '12294:52699',            file: 'img/fees_table.png' },
  { id: 'I12291:2930;552:913',    file: 'img/social.png' },
];

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

// ---------------------------------------------------------------------------
// MJML — hand-crafted for pixel-perfect fidelity
// ---------------------------------------------------------------------------

const statCard = (icon, html) => `
            <tr>
              <td style="background-color:#f9f9fb;border-radius:8px;padding:10px 16px 10px 16px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
                  <tr>
                    <td width="56" valign="middle" align="right" style="padding-right:16px;">
                      <img src="${icon}" width="40" height="40" alt="" style="display:block;" />
                    </td>
                    <td valign="middle" style="font-family:'Hauora';font-size:14px;font-weight:700;color:#000000;line-height:1.35;">${html}</td>
                  </tr>
                </table>
              </td>
            </tr>`;

function generateMJML() {
  return `<mjml>
  <mj-head>
    <mj-font name="Hauora" href="https://fonts.googleapis.com/css2?family=Hauora:wght@400;700&display=swap" />
    <mj-font name="Inter" href="https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap" />
    <mj-attributes>
      <mj-all font-family="Hauora" />
      <mj-body width="600px" />
      <mj-text padding="0" />
      <mj-image padding="0" />
      <mj-section padding="0" />
    </mj-attributes>
  </mj-head>
  <mj-body width="600px" background-color="#ffffff">

    <!-- Logo Header -->
    <mj-section background-color="#ffffff" padding="20px 32px 20px 32px">
      <mj-column>
        <mj-image src="img/logo.png" width="111px" align="left" alt="HitPay" padding="0" />
      </mj-column>
    </mj-section>

    <!-- Hero Title — MD Nichrome Test Bold 32px, light blue gradient background -->
    <mj-section background-url="img/gradient_hero.png" background-size="100% 100%" background-color="#EAF3FF" padding="28px 32px 0 32px">
      <mj-column>
        <mj-text font-family="'MD Nichrome Test'" font-size="32px" font-weight="700" color="#000000" align="center" line-height="43px" padding="0">TnG for Subscriptions <span style="color:#2388ff;">(MY)</span> is now LIVE!</mj-text>
        <mj-spacer height="4px" />
      </mj-column>
    </mj-section>

    <!-- Hero Image (536px wide, rounded 8px) -->
    <mj-section background-color="#ffffff" padding="15px 0 15px 0">
      <mj-column>
        <mj-image src="img/hero.png" width="536px" align="center" alt="" padding="0" border-radius="8px" />
      </mj-column>
    </mj-section>

    <!-- Intro Paragraph — Hauora Regular 15px -->
    <mj-section background-color="#ffffff" padding="10px 30px 10px 32px">
      <mj-column>
        <mj-text font-family="'Hauora'" font-size="15px" color="#03102f" align="left" line-height="21px" padding="0">You can now accept Touch &#x2019;n Go (TnG) for recurring payments in Malaysia, not just one-time transactions.</mj-text>
      </mj-column>
    </mj-section>

    <!-- Benefits Heading — MD Nichrome Test Dark 30px -->
    <mj-section background-color="#ffffff" padding="15px 32px 5px 32px">
      <mj-column>
        <mj-text font-family="'MD Nichrome Test'" font-size="30px" color="#000000" align="left" line-height="34px" padding="0" font-weight="800">Benefits:</mj-text>
      </mj-column>
    </mj-section>

    <!-- Benefits — 3 icon+text cards (Hauora Bold 14px) with rounded corners -->
    <mj-section background-color="#ffffff" padding="20px 32px 15px 32px">
      <mj-column>
        <mj-raw>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">${statCard('img/icon_1.png', 'Tap into TnG&#x2019;s strong brand and large user base in Malaysia')}
            <tr><td height="8" style="font-size:0;line-height:0;">&nbsp;</td></tr>${statCard('img/icon_2.png', 'Offer customers a non-card option for subscriptions')}
            <tr><td height="8" style="font-size:0;line-height:0;">&nbsp;</td></tr>${statCard('img/icon_3.png', 'Increase payment flexibility and potentially improve subscription conversion')}
          </table>
        </mj-raw>
      </mj-column>
    </mj-section>

    <!-- Merchant Onboarding Heading — MD Nichrome Test Dark 30px -->
    <mj-section background-color="#ffffff" padding="15px 32px 5px 32px">
      <mj-column>
        <mj-text font-family="'MD Nichrome Test'" font-size="30px" color="#000000" align="left" line-height="34px" padding="0" font-weight="800">Merchant Onboarding:</mj-text>
      </mj-column>
    </mj-section>

    <!-- Merchant Onboarding — Hauora Regular 16px, bullet list -->
    <mj-section background-color="#ffffff" padding="10px 30px 10px 32px">
      <mj-column>
        <mj-text font-family="'Hauora'" font-size="16px" color="#03102f" align="left" line-height="22px" padding="0">&#x2022; Automatically enabled for all verified MY merchants</mj-text>
      </mj-column>
    </mj-section>

    <!-- How to Accept Heading — MD Nichrome Test Dark 30px -->
    <mj-section background-color="#ffffff" padding="15px 32px 5px 32px">
      <mj-column>
        <mj-text font-family="'MD Nichrome Test'" font-size="30px" color="#000000" align="left" line-height="34px" padding="0" font-weight="800">How to accept Touch &#x2019;n Go for Subscriptions:</mj-text>
      </mj-column>
    </mj-section>

    <!-- How to Accept — Hauora Regular 14px, numbered steps in rounded card -->
    <mj-section background-color="#ffffff" padding="10px 32px 10px 32px">
      <mj-column>
        <mj-raw>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
            <tr>
              <td style="background-color:#f9f9fb;border-radius:8px;padding:10px 32px 10px 32px;">
                <ol style="font-family:'Hauora';font-size:14px;color:#000000;line-height:1.5;margin:0;padding-left:20px;">
                  <li style="margin-bottom:8px;">Create a subscription and share the link with your customers.</li>
                  <li style="margin-bottom:8px;">At checkout, customers simply select Touch &#x2019;n Go and link their account.</li>
                  <li>Once the first payment is completed, all future renewals are automatically charged to their linked Touch &#x2019;n Go account based on the subscription cycle.</li>
                </ol>
              </td>
            </tr>
          </table>
        </mj-raw>
      </mj-column>
    </mj-section>

    <!-- Fees & Payouts Heading — MD Nichrome Test Dark 30px -->
    <mj-section background-color="#ffffff" padding="15px 32px 5px 32px">
      <mj-column>
        <mj-text font-family="'MD Nichrome Test'" font-size="30px" color="#000000" align="left" line-height="34px" padding="0" font-weight="800">Fees &amp; Payouts:</mj-text>
      </mj-column>
    </mj-section>

    <!-- Fees & Payouts Table Image -->
    <mj-section background-color="#ffffff" padding="8px 32px 30px 32px">
      <mj-column>
        <mj-image src="img/fees_table.png" width="536px" align="center" alt="" padding="0" border-radius="8px" />
      </mj-column>
    </mj-section>

    <!-- Help CTA — Hauora Bold 20px heading + Regular 14px body, warm-to-blue gradient -->
    <mj-section background-url="img/gradient_cta.png" background-size="100% 100%" background-color="#EAF3FF" padding="40px 16px 40px 16px">
      <mj-column>
        <mj-text font-family="'Hauora'" font-size="20px" font-weight="700" color="#000000" align="center" line-height="1.21" padding="0 0 8px 0">Need help or have any questions?</mj-text>
        <mj-text font-family="'Hauora'" font-size="14px" color="#61667c" align="center" line-height="1.35" padding="0">If you need help with getting the most out of HitPay, we&#x2019;re here for you.<br/>Email us at <a href="mailto:support@hitpayapp.com" style="color:#61667c;">support@hitpayapp.com</a> and our team will be in touch.</mj-text>
        <mj-spacer height="4px" />
      </mj-column>
    </mj-section>

    <!-- Footer — Inter Regular 13px address, 12px unsubscribe -->
    <mj-section background-color="#03102f" padding="16px 16px 16px 16px">
      <mj-column>
        <mj-text font-family="'Inter'" font-size="13px" color="#cbcdd4" align="center" line-height="1.38" padding="0 0 16px 0">HitPay Payment Solutions Pte Ltd<br/>88 Market Street - Level #40-01, CapitaSpring<br/>Singapore, 048948</mj-text>
        <mj-image src="img/social.png" width="144px" align="center" alt="Follow us on social media" padding="0 0 16px 0" />
        <mj-text font-family="'Inter'" font-size="12px" color="#cbcdd4" align="center" line-height="1.5" padding="0"><a href="{unsubscribe_link}" style="color:#cbcdd4;text-decoration:underline;">Unsubscribe</a></mj-text>
      </mj-column>
    </mj-section>

  </mj-body>
</mjml>`;
}

// ---------------------------------------------------------------------------
// README
// ---------------------------------------------------------------------------

function generateReadme() {
  return [
    'Figma to Loops Export',
    '======================',
    'Frame    : TnG Recurring',
    'Generated: ' + new Date().toISOString(),
    'Images   : ' + RASTER_NODES.length,
    '',
    'CONTENTS',
    '--------',
    'index.mjml   -- MJML email template',
    'img/         -- PNG images at 2x resolution',
    '',
    'HOW TO USE WITH LOOPS',
    '---------------------',
    '1. Host images on a CDN (S3, Cloudinary, Cloudflare R2, etc.)',
    '2. Replace relative img/ paths in the MJML with absolute URLs',
    '3. Compile MJML to HTML:  npx mjml index.mjml -o index.html',
    '4. In Loops: Settings > Templates > Import > paste the HTML',
    '',
    'NOTES',
    '-----',
    '- {unsubscribe_link} is replaced by Loops at send time',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

async function buildZip(outPath, files) {
  const JSZip = require('jszip');
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
  console.log('Frame: TnG Recurring');

  // 1. Request image renders from Figma
  console.log('\nRequesting image renders from Figma (' + RASTER_NODES.length + ' nodes)...');
  const ids = RASTER_NODES.map(n => n.id);
  const imgResp = await figmaGet(
    '/images/' + FILE_KEY + '?ids=' + encodeURIComponent(ids.join(',')) + '&format=png&scale=2'
  );
  if (imgResp.err) throw new Error('Figma image export error: ' + imgResp.err);

  const urlMap = imgResp.images || {};
  const missing = ids.filter(id => !urlMap[id]);
  if (missing.length) {
    console.warn('WARNING: No render URL for node(s):', missing.join(', '));
  }

  // 2. Download images
  console.log('Downloading ' + RASTER_NODES.length + ' image(s)...');
  const imageFiles = [];
  for (let i = 0; i < RASTER_NODES.length; i++) {
    const { id, file } = RASTER_NODES[i];
    const url = urlMap[id];
    if (!url) { console.warn('  SKIP (no URL):', file); continue; }
    process.stdout.write('  [' + (i + 1) + '/' + RASTER_NODES.length + '] ' + file + '… ');
    const buf = await fetchBuf(url, {});
    console.log(Math.round(buf.length / 1024) + ' KB');
    imageFiles.push([file, buf]);
  }

  // 3. Generate gradient PNGs
  console.log('\nGenerating gradient PNGs...');
  imageFiles.push(['img/gradient_hero.png', makeHeroGradient()]);
  imageFiles.push(['img/gradient_cta.png', makeBannerGradient()]);

  // 4. Generate MJML + README
  console.log('Generating MJML...');
  const mjml = generateMJML();
  const readme = generateReadme();

  // 5. Build ZIP
  const outName = 'tng_recurring_loops.zip';
  const outPath = path.join(__dirname, outName);
  console.log('\nBuilding ZIP → ' + outName);
  await buildZip(outPath, [
    ['index.mjml', Buffer.from(mjml, 'utf8')],
    ['README.txt', Buffer.from(readme, 'utf8')],
    ...imageFiles,
  ]);

  const size = fs.statSync(outPath).size;
  console.log('\nDone! ' + outName + ' (' + Math.round(size / 1024) + ' KB)');
  console.log('Path:', outPath);
}

main().catch(err => { console.error(err); process.exit(1); });
