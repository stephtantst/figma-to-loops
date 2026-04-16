// ---------------------------------------------------------------------------
// export-duitnow-custom.js — Hand-crafted export for DuitNow XB EDM
// Usage: FIGMA_TOKEN=xxx node export-duitnow-custom.js
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
  // CRC-32 table
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

  // Build raw scanlines: filter byte (0=None) + RGB per pixel
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
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
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
      // top (#EAF3FF) → 29.5% from top (#F5F9FF)
      const f = t / 0.295;
      r = Math.round(234 + f * 11);
      g = Math.round(243 + f * 6);
      b = 255;
    } else {
      // 29.5% from top (#F5F9FF) → bottom (white), via 96.5% from top
      const f = Math.min((t - 0.295) / 0.67, 1);
      r = Math.round(245 + f * 10);
      g = Math.round(249 + f * 6);
      b = 255;
    }
    return [r, g, b];
  });
}

// Banner gradient: top=#EAF3FF → via #F5F9FF → bottom≈warm white #FFFEF6
// Figma: linear-gradient(~0deg, rgba(255,251,209,0.2)@3.5% via rgba(204,225,255,0.2)@70.5% to rgba(152,194,255,0.2)@top)
function makeBannerGradient() {
  return makePNG(600, 300, (x, y, w, h) => {
    const t = y / (h - 1); // 0=top, 1=bottom
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

const TOKEN   = process.env.FIGMA_TOKEN;
const FILE_KEY = 'v9uHxHSrA9hWQYT2et0bUc';

if (!TOKEN) {
  console.error('Usage: FIGMA_TOKEN=xxx node export-duitnow-custom.js');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Image nodes — keyed from Figma design context, unique filenames guaranteed
// ---------------------------------------------------------------------------

const RASTER_NODES = [
  { id: 'I12347:2778;457:4105',     file: 'img/logo.png' },
  { id: 'I12420:82164;450:1979',    file: 'img/hero.png' },
  { id: 'I12347:2785;1619:5774',    file: 'img/stat_icon_1.png' },
  { id: 'I12347:2786;1619:5769',    file: 'img/stat_icon_2.png' },
  { id: 'I12347:2787;1619:5769',    file: 'img/stat_icon_3.png' },
  { id: 'I12420:82169;6573:41510',  file: 'img/who_1.png' },
  { id: 'I12420:82169;6573:41516',  file: 'img/who_2.png' },
  { id: 'I12420:82169;6573:41522',  file: 'img/who_3.png' },
  { id: 'I12347:2796;6026:9950',    file: 'img/payment_details.png' },
  { id: 'I12420:106865;552:5396',   file: 'img/ways_1.png' },
  { id: 'I12420:106876;552:5396',   file: 'img/ways_2.png' },
  { id: 'I12420:106884;552:5396',   file: 'img/ways_3.png' },
  { id: 'I12347:2806;12233:17288',  file: 'img/help_banner.png' },
  { id: 'I12347:2807;552:915',      file: 'img/social_instagram.png' },
  { id: 'I12347:2807;552:918',      file: 'img/social_facebook.png' },
  { id: 'I12347:2807;552:931',      file: 'img/social_linkedin.png' },
  { id: 'I12347:2807;552:1302',     file: 'img/social_youtube.png' },
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

function generateMJML() {
  const n = '\n';
  const statCard = (icon, html) => `
            <tr>
              <td style="background-color:#f9f9fb;border-radius:8px;padding:10px 32px 10px 16px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
                  <tr>
                    <td width="56" valign="middle" align="right" style="padding-right:16px;">
                      <img src="${icon}" width="40" height="40" alt="" style="display:block;" />
                    </td>
                    <td valign="middle" style="font-family:'Hauora';font-size:14px;color:#000000;line-height:1.35;">${html}</td>
                  </tr>
                </table>
              </td>
            </tr>`;

  const whoCol = (img, titleHtml, bodyHtml) => `
              <td width="168" valign="top">
                <img src="${img}" width="168" height="168" alt="" style="display:block;border-radius:10px;width:168px;height:168px;object-fit:cover;" />
                <div style="height:16px;font-size:0;line-height:0;">&nbsp;</div>
                <p style="font-family:'Hauora';font-size:12px;color:#000000;margin:0;line-height:1.5;"><strong>${titleHtml}</strong><br/>${bodyHtml}</p>
              </td>`;

  const wayRow = (imgSrc, titleHtml, bodyHtml) => `
    <mj-section background-color="#ffffff" padding="20px 32px">
      <mj-column>
        <mj-raw>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
            <tr>
              <td width="284" valign="middle" style="padding:8px 32px 8px 0;vertical-align:middle;">
                <p style="font-family:'Hauora';font-size:20px;font-weight:700;color:#000000;margin:0 0 8px 0;line-height:1.2;">${titleHtml}</p>
                <p style="font-family:'Hauora';font-size:11px;color:#000000;margin:0;line-height:1.5;">${bodyHtml}</p>
              </td>
              <td width="252" valign="middle" style="vertical-align:middle;">
                <img src="${imgSrc}" width="252" height="190" alt="" style="display:block;border-radius:8px;width:252px;object-fit:cover;" />
              </td>
            </tr>
          </table>
        </mj-raw>
      </mj-column>
    </mj-section>`;

  return `<mjml>
  <mj-head>
    <mj-font name="MD Nichrome Trial" href="https://fonts.googleapis.com/css2?family=MD+Nichrome+Trial:wght@400;700&display=swap" />
    <mj-font name="Hauora" href="https://fonts.googleapis.com/css2?family=Hauora:wght@400;700&display=swap" />
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
    <mj-section background-color="#ffffff" padding="20px 32px">
      <mj-column>
        <mj-image src="img/logo.png" width="111px" align="left" alt="HitPay" padding="0" />
      </mj-column>
    </mj-section>

    <!-- Hero Title — light blue gradient background -->
    <mj-section background-url="img/gradient_hero.png" background-size="100% 100%" background-color="#EAF3FF" padding="28px 32px 0 32px">
      <mj-column>
        <mj-text font-family="'MD Nichrome Trial'" font-size="32px" font-weight="700" color="#000000" align="center" line-height="43px" padding="0">The Key to Malaysia Is Here:<br/>Accept DuitNow QR Now</mj-text>
        <mj-spacer height="4px" />
      </mj-column>
    </mj-section>

    <!-- Hero Image (536px wide, rounded 18px) -->
    <mj-section background-color="#ffffff" padding="15px 0">
      <mj-column>
        <mj-image src="img/hero.png" width="536px" align="center" alt="" padding="0" border-radius="18px" />
      </mj-column>
    </mj-section>

    <!-- Intro Paragraph -->
    <mj-section background-color="#ffffff" padding="20px 30px 5px 32px">
      <mj-column>
        <mj-text font-family="'Hauora'" font-size="16px" color="#03102f" line-height="22px" padding="0">Now instantly available for international merchants (i.e. Singapore, Philippines, and more) via HitPay &#x2014; no local entity required.</mj-text>
      </mj-column>
    </mj-section>

    <!-- Why DuitNow Heading -->
    <mj-section background-color="#ffffff" padding="15px 32px 5px 32px">
      <mj-column>
        <mj-text font-family="'MD Nichrome Trial'" font-size="30px" font-weight="700" color="#000000" line-height="34px" padding="0">Why DuitNow Is Your Gateway to Malaysia</mj-text>
      </mj-column>
    </mj-section>

    <!-- Why DuitNow Body -->
    <mj-section background-color="#ffffff" padding="10px 30px 10px 32px">
      <mj-column>
        <mj-text font-family="'Hauora'" font-size="16px" color="#03102f" line-height="22px" padding="0">Accept payments in Malaysia from Touch &#x2019;n Go to every major bank.<br/><br/>Skip the local setup and bank hurdles; start accepting MYR instantly via DuitNow on HitPay</mj-text>
      </mj-column>
    </mj-section>

    <!-- Stat Cards (white outer, gray rounded cards) -->
    <mj-section background-color="#ffffff" padding="20px 32px 15px 32px">
      <mj-column>
        <mj-raw>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">${statCard('img/stat_icon_1.png', '<strong>Massive Adoption:</strong> E-wallets and DuitNow QR account for <strong>over 20%</strong> of Malaysia&#x2019;s total retail transaction volume&#x2014;and growing.')}
            <tr><td height="8" style="font-size:0;line-height:0;">&nbsp;</td></tr>${statCard('img/stat_icon_2.png', '<strong>High Penetration:</strong> Malaysia&#x2019;s e-wallet adoption exceeds 60%. If you don&#x2019;t offer preferred local payment methods, you could be losing <strong>6 out of 10</strong> potential customers at checkout.')}
            <tr><td height="8" style="font-size:0;line-height:0;">&nbsp;</td></tr>${statCard('img/stat_icon_3.png', '<strong>Mainstream Trust:</strong> Malaysian shoppers actively look for the DuitNow logo. It signals a secure, familiar, and truly local checkout experience.')}
          </table>
        </mj-raw>
      </mj-column>
    </mj-section>

    <!-- CTA Button 1 -->
    <mj-section background-color="#ffffff" padding="20px 0 25px 0">
      <mj-column>
        <mj-button background-color="#4179e2" color="#ffffff" border-radius="8px" inner-padding="10px 12px" href="https://dashboard.hit-pay.com/" align="center" font-family="'Hauora'" font-size="14px" font-weight="700">Start Transacting with DuitNow QR Now</mj-button>
      </mj-column>
    </mj-section>

    <!-- Who Benefits Heading -->
    <mj-section background-color="#ffffff" padding="15px 32px 5px 32px">
      <mj-column>
        <mj-text font-family="'MD Nichrome Trial'" font-size="30px" font-weight="700" color="#000000" line-height="34px" padding="0">Who Benefits</mj-text>
      </mj-column>
    </mj-section>

    <!-- Who Benefits — 3 columns, 168px each, 16px gaps -->
    <mj-section background-color="#ffffff" padding="14px 32px 17px 32px">
      <mj-column>
        <mj-raw>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
            <tr>${whoCol('img/who_1.png', 'Global E-commerce Brands', 'Fashion, beauty, electronics, and DTC brands expanding into Malaysia&#x2014;without setting up a local entity.')}
              <td width="16">&nbsp;</td>${whoCol('img/who_2.png', 'Travel &amp; Education Platforms', 'Businesses collecting bookings, tuition, or service fees from Malaysian residents in MYR.')}
              <td width="16">&nbsp;</td>${whoCol('img/who_3.png', 'SaaS &amp; Digital Services', 'Subscription platforms, gaming companies, digital content providers, and software businesses billing Malaysian customers seamlessly in local currency.')}
            </tr>
          </table>
        </mj-raw>
      </mj-column>
    </mj-section>

    <!-- Payment Details Heading -->
    <mj-section background-color="#ffffff" padding="15px 32px 5px 32px">
      <mj-column>
        <mj-text font-family="'MD Nichrome Trial'" font-size="30px" font-weight="700" color="#000000" line-height="34px" padding="0">Payment Details</mj-text>
      </mj-column>
    </mj-section>

    <!-- Payment Details Image -->
    <mj-section background-color="#ffffff" padding="15px 32px">
      <mj-column>
        <mj-image src="img/payment_details.png" width="536px" alt="" padding="0" border-radius="8px" />
      </mj-column>
    </mj-section>

    <!-- CTA Button 2 -->
    <mj-section background-color="#ffffff" padding="20px 0 25px 0">
      <mj-column>
        <mj-button background-color="#4179e2" color="#ffffff" border-radius="8px" inner-padding="10px 12px" href="https://dashboard.hit-pay.com/" align="center" font-family="'Hauora'" font-size="14px" font-weight="700">Unlock Malaysia with DuitNow Today!</mj-button>
      </mj-column>
    </mj-section>

    <!-- Divider -->
    <mj-section background-color="#ffffff" padding="15px 32px">
      <mj-column>
        <mj-divider border-color="#cccccc" border-width="1px" padding="0" />
      </mj-column>
    </mj-section>

    <!-- 3 Ways Heading -->
    <mj-section background-color="#ffffff" padding="15px 32px 5px 32px">
      <mj-column>
        <mj-text font-family="'MD Nichrome Trial'" font-size="30px" font-weight="700" color="#000000" line-height="34px" padding="0">3 Powerful Ways to Start Selling in MYR</mj-text>
      </mj-column>
    </mj-section>

    <!-- Way 1: Borderless QR -->${wayRow(
  'img/ways_1.png',
  'In-Store with Borderless QR (POS)',
  'Perfect for retail, pop-ups, events, and hospitality.<br/><br/>Generate a Dynamic QR from your HitPay POS. Malaysian customers scan with Touch &#x2019;n Go or their banking app via DuitNow and pay instantly in MYR.<br/><br/>You get:<br/>&#x2022;&nbsp;Real-time payment confirmation<br/>&#x2022;&nbsp;Automatic MYR-to-home-currency settlement<br/>&#x2022;&nbsp;No manual reconciliation<br/><br/>Sell to Malaysian tourists as seamlessly as you sell locally.<br/><br/><a href="https://hitpayapp.com/hitpay-borderless-qr-payments" style="color:#006fff;text-decoration:underline;">Start using Borderless QR &#x2192;</a>'
)}

    <!-- Way 2: Multicurrency -->${wayRow(
  'img/ways_2.png',
  'Create a Multicurrency HitPay Online Store',
  'Ideal for cross-border e-commerce. Turn on DuitNow in your payment settings and instantly offer a fully local Malaysian checkout experience&#x2014;without additional integrations.<br/><br/>You get:<br/>&#x2022;&nbsp;Higher checkout conversion from Malaysian shoppers<br/>&#x2022;&nbsp;Access to every major Malaysian bank and wallet via one QR standard<br/>&#x2022;&nbsp;Automatic currency conversion and settlement<br/><br/>No local bank account required.<br/><br/><a href="https://hitpayapp.com/multi-currency-ecommerce-pricing" style="color:#006fff;text-decoration:underline;">Start using Multicurrency HitPay Online Store &#x2192;</a>'
)}

    <!-- Way 3: Payment Links -->${wayRow(
  'img/ways_3.png',
  'Send MYR Payment Links Anywhere',
  'Best for remote sales, social commerce, travel bookings, or invoice collections.<br/>Create and share payment links in MYR via WhatsApp, email, or social media. Customers complete payment instantly using their preferred Malaysian banking app or Touch &#x2019;n Go.<br/><br/>You get:<br/>&#x2022;&nbsp;Faster collections from Malaysian customers<br/>&#x2022;&nbsp;Frictionless cross-border billing<br/>&#x2022;&nbsp;Support for full and partial refunds<br/><br/>Turn conversations into paid transactions&#x2014;in MYR.'
)}

    <!-- Banner: Need Help — warm-to-blue gradient background -->
    <mj-section background-url="img/gradient_banner.png" background-size="100% 100%" background-color="#EAF3FF" padding="32px 32px 40px 32px">
      <mj-column>
        <mj-text font-family="'Hauora'" font-size="20px" font-weight="700" color="#000000" align="center" line-height="1.21" padding="0 0 8px 0">Need help or have any questions?</mj-text>
        <mj-text font-family="'Hauora'" font-size="14px" color="#61667c" align="center" line-height="1.35" padding="0 0 16px 0">If you need help with getting the most out of HitPay, we&#x2019;re here for you.<br/>Reply to this email and our team will be in touch.</mj-text>
        <mj-image src="img/help_banner.png" width="536px" alt="" padding="0" border-radius="10px" />
      </mj-column>
    </mj-section>

    <!-- Footer -->
    <mj-section background-color="#03102f" padding="16px">
      <mj-column>
        <mj-text font-family="'Inter'" font-size="13px" color="#cbcdd4" align="center" line-height="1.38" padding="0 0 16px 0">HitPay Payment Solutions Pte Ltd<br/>88 Market Street - Level #40-01, CapitaSpring<br/>Singapore, 048948</mj-text>
        <mj-raw>
          <table cellpadding="0" cellspacing="0" border="0" role="presentation" align="center" style="margin:0 auto 16px auto;">
            <tr>
              <td style="padding:0 8px;"><a href="https://www.instagram.com/hitpayapp/" target="_blank"><img src="img/social_instagram.png" width="20" height="20" alt="Instagram" style="display:block;" /></a></td>
              <td style="padding:0 8px;"><a href="https://www.facebook.com/hitpayapp" target="_blank"><img src="img/social_facebook.png" width="24" height="24" alt="Facebook" style="display:block;" /></a></td>
              <td style="padding:0 8px;"><a href="https://www.linkedin.com/company/hit-pay/" target="_blank"><img src="img/social_linkedin.png" width="24" height="24" alt="LinkedIn" style="display:block;" /></a></td>
              <td style="padding:0 8px;"><a href="https://www.youtube.com/channel/UC80fT7hF8OR9uDxF6tnwDxQ" target="_blank"><img src="img/social_youtube.png" width="24" height="24" alt="YouTube" style="display:block;" /></a></td>
            </tr>
          </table>
        </mj-raw>
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
  const n = '\n';
  return (
    'Figma to Loops Export' + n +
    '======================' + n +
    'Frame    : DuitNow XB - EDM (Updated)' + n +
    'Generated: ' + new Date().toISOString() + n +
    'Images   : ' + RASTER_NODES.length + n +
    n +
    'CONTENTS' + n +
    '--------' + n +
    'index.mjml   -- MJML email template' + n +
    'img/         -- PNG images at 2x resolution' + n +
    n +
    'HOW TO USE WITH LOOPS' + n +
    '---------------------' + n +
    '1. Host images on a CDN (S3, Cloudinary, Cloudflare R2, etc.)' + n +
    '2. Replace relative img/ paths in the MJML with absolute URLs' + n +
    '3. Compile MJML to HTML:  npx mjml index.mjml -o index.html' + n +
    '4. In Loops: Settings > Templates > Import > paste the HTML' + n +
    n +
    'NOTES' + n +
    '-----' + n +
    '- {unsubscribe_link} is replaced by Loops at send time' + n
  );
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
  console.log('Frame: DuitNow XB - EDM (Updated)');

  // 1. Request image renders from Figma
  console.log('\nRequesting image renders from Figma (' + RASTER_NODES.length + ' nodes)...');
  const ids = RASTER_NODES.map(n => n.id);
  const imgResp = await figmaGet(
    '/images/' + FILE_KEY + '?ids=' + encodeURIComponent(ids.join(',')) + '&format=png&scale=2'
  );
  if (imgResp.err) throw new Error('Figma image export error: ' + imgResp.err);

  const rendered = imgResp.images || {};
  const missing = ids.filter(id => !rendered[id]);
  if (missing.length) {
    console.warn('Warning: no render URL for ' + missing.length + ' nodes:', missing.join(', '));
  }

  // 2. Download images
  console.log('Downloading images...');
  const imageData = new Map();
  for (let i = 0; i < RASTER_NODES.length; i++) {
    const node = RASTER_NODES[i];
    const url = rendered[node.id];
    process.stdout.write('  [' + (i + 1) + '/' + RASTER_NODES.length + '] ' + node.file + '... ');
    if (url) {
      const buf = await fetchBuf(url, {});
      imageData.set(node.id, buf);
      process.stdout.write(Math.round(buf.length / 1024) + ' KB\n');
    } else {
      process.stdout.write('(no render)\n');
    }
  }

  // 3. Generate gradient images
  console.log('Generating gradient images...');
  const heroGradientBuf   = makeHeroGradient();
  const bannerGradientBuf = makeBannerGradient();
  console.log('  hero gradient:   ' + Math.round(heroGradientBuf.length / 1024) + ' KB');
  console.log('  banner gradient: ' + Math.round(bannerGradientBuf.length / 1024) + ' KB');

  // 4. Assemble ZIP
  console.log('\nGenerating MJML...');
  const mjml   = generateMJML();
  const readme = generateReadme();

  const zipFiles = [
    ['index.mjml', mjml],
    ['img/gradient_hero.png', heroGradientBuf],
    ['img/gradient_banner.png', bannerGradientBuf],
  ];
  for (const node of RASTER_NODES) {
    const buf = imageData.get(node.id);
    if (buf) zipFiles.push([node.file, buf]);
  }
  zipFiles.push(['README.txt', readme]);

  // 5. Write ZIP
  const zipPath = path.join(__dirname, 'duitnow_xb___edm__updated__loops.zip');
  console.log('Building ZIP...');
  await buildZip(zipPath, zipFiles);

  const sizeKB = Math.round(fs.statSync(zipPath).size / 1024);
  console.log('\nDone! duitnow_xb___edm__updated__loops.zip (' + sizeKB + ' KB)');
  console.log('Path: ' + zipPath);
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
