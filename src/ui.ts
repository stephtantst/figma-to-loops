// ---------------------------------------------------------------------------
// ui.ts — runs in the plugin iframe (full browser APIs available)
// ---------------------------------------------------------------------------

import JSZip from 'jszip';
import type {
  ExportPayload,
  ProgressMessage,
  ErrorMessage,
  StartExportMessage,
  FindNodeMessage,
  FrameInfo,
  FrameListMessage,
} from './types';
import { generateMJML } from './mjml-generator';

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const exportBtn    = document.getElementById('export-btn')    as HTMLButtonElement;
const frameListEl  = document.getElementById('frame-list')    as HTMLElement;
const statusBar    = document.getElementById('status-bar')    as HTMLElement;
const statusText   = document.getElementById('status-text')   as HTMLElement;
const zipSection   = document.getElementById('zip-section')   as HTMLElement;
const zipPreview   = document.getElementById('zip-preview')   as HTMLElement;
const stepsSection = document.getElementById('steps-section') as HTMLElement;
const linkInput    = document.getElementById('link-input')    as HTMLInputElement;
const linkBtn      = document.getElementById('link-btn')      as HTMLButtonElement;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let selectedFrameId: string | null = null;
let knownFrames: FrameInfo[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setStatus(msg: string, type: 'idle' | 'loading' | 'success' | 'error') {
  statusText.textContent = msg;
  statusBar.className = 'status-bar ' + type;
}

function safeName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 50);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// IMPORTANT: No multi-line template literals here — esbuild preserves raw
// newlines inside template literals, which causes SyntaxErrors when the
// bundle is injected into a <script> tag and loaded by Figma's WebView.
// Use explicit '\n' in regular strings instead.

function generateReadme(frameName: string, imageCount: number): string {
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
    'index.mjml   -- MJML email template' + n +
    'img/         -- Rasterised images referenced by the template' + n +
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
    'MJML REFERENCE' + n +
    '--------------' + n +
    'https://mjml.io/documentation' + n +
    'https://loops.so/docs' + n
  );
}

function zipRowHTML(filename: string, badge: string, badgeClass: string): string {
  const icon = (
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none">' +
    '<rect x="1" y="1" width="10" height="10" rx="1" stroke="#999" stroke-width="1"/>' +
    '<path d="M3 4h6M3 6h4" stroke="#999" stroke-width="1" stroke-linecap="round"/>' +
    '</svg>'
  );
  return (
    '<div class="zip-row">' +
    icon +
    '<span class="filename">' + filename + '</span>' +
    '<span class="zip-badge ' + badgeClass + '">' + badge + '</span>' +
    '</div>'
  );
}

// ---------------------------------------------------------------------------
// Frame list rendering (Emailify-style)
// ---------------------------------------------------------------------------

function frameItemHTML(frame: FrameInfo, isSelected: boolean): string {
  const frameIcon = (
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none">' +
    '<rect x="0.5" y="0.5" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1"/>' +
    '<path d="M0.5 3.5h11M3.5 0.5v11" stroke="currentColor" stroke-width="0.8"/>' +
    '</svg>'
  );
  return (
    '<div class="frame-item' + (isSelected ? ' selected' : '') + '" data-id="' + escapeHtml(frame.id) + '">' +
    '<span class="frame-item-icon">' + frameIcon + '</span>' +
    '<span class="frame-item-name">' + escapeHtml(frame.name) + '</span>' +
    '<span class="frame-item-size">' + Math.round(frame.width) + 'px</span>' +
    '</div>'
  );
}

function renderFrameList(frames: FrameInfo[], autoSelectId: string | null): void {
  knownFrames = frames;

  // Determine which frame to highlight:
  // 1. Keep current user selection if it still exists in the list
  // 2. Otherwise use the canvas selection passed from code.ts
  // 3. Otherwise default to first frame
  const stillExists = selectedFrameId && frames.some((f) => f.id === selectedFrameId);
  if (!stillExists) {
    selectedFrameId = autoSelectId || (frames[0] ? frames[0].id : null);
  }

  exportBtn.disabled = !selectedFrameId;

  if (frames.length === 0) {
    frameListEl.innerHTML = '<div class="frame-list-empty">No frames found on this page.</div>';
    setStatus('Add a frame to the canvas to get started.', 'idle');
    return;
  }

  frameListEl.innerHTML = frames
    .map((f) => frameItemHTML(f, f.id === selectedFrameId))
    .join('');

  const selectedFrame = frames.find((f) => f.id === selectedFrameId);
  if (selectedFrame) {
    setStatus(escapeHtml(selectedFrame.name) + ' selected \u2014 click Export to begin.', 'idle');
  } else {
    setStatus('Click a frame above, then Export.', 'idle');
  }
}

// Event delegation — one listener on the container handles all frame clicks
frameListEl.addEventListener('click', function(e: MouseEvent) {
  const item = (e.target as Element).closest('.frame-item') as HTMLElement | null;
  if (!item) return;
  const id = item.dataset['id'];
  if (!id) return;

  selectedFrameId = id;
  exportBtn.disabled = false;

  // Update selected highlight
  frameListEl.querySelectorAll('.frame-item').forEach(function(el) {
    el.classList.remove('selected');
  });
  item.classList.add('selected');

  const frame = knownFrames.find((f) => f.id === id);
  if (frame) {
    setStatus(escapeHtml(frame.name) + ' selected \u2014 click Export to begin.', 'idle');
  }
});

// ---------------------------------------------------------------------------
// Main export flow
// ---------------------------------------------------------------------------

async function handleExportData(payload: ExportPayload): Promise<void> {
  setStatus('Generating MJML\u2026', 'loading');

  const { frameName, frameWidth, frame, images } = payload;

  // 1. Generate MJML
  const mjml = generateMJML(frame, frameName);

  // 2. Create ZIP
  setStatus('Building ZIP archive\u2026', 'loading');
  const zip = new JSZip();

  zip.file('index.mjml', mjml);
  zip.file('README.txt', generateReadme(frameName, images.length));

  const imgFolder = zip.folder('img')!;
  for (const img of images) {
    const fname = img.filename.replace(/^img\//, '');
    imgFolder.file(fname, new Uint8Array(img.data), { binary: true });
  }

  // 3. Compress
  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (meta) => {
      setStatus('Compressing\u2026 ' + Math.round(meta.percent) + '%', 'loading');
    },
  );

  // 4. Download
  const baseName = safeName(frameName);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = baseName + '_loops.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 5000);

  // 5. Show ZIP preview
  stepsSection.style.display = 'none';
  zipSection.style.display = 'block';

  let previewHTML = zipRowHTML('index.mjml', 'MJML', 'mjml');
  for (const img of images) {
    const fname = img.filename.replace(/^img\//, '');
    previewHTML += zipRowHTML('img/' + fname, 'IMG', 'img');
  }
  previewHTML += zipRowHTML('README.txt', 'TXT', 'txt');
  zipPreview.innerHTML = previewHTML;

  const sizeKB = Math.round(blob.size / 1024);
  setStatus('Download ready \u2014 ' + baseName + '_loops.zip (' + sizeKB + ' KB)', 'success');
}

// ---------------------------------------------------------------------------
// Unified message handler
// ---------------------------------------------------------------------------

window.onmessage = function(event: MessageEvent) {
  const msg = event.data && event.data.pluginMessage;
  if (!msg) return;

  // Always re-enable the Go button when any message arrives from code.ts
  linkBtn.disabled = false;

  if (msg.type === 'FRAMES_LIST') {
    const { frames, selectedId } = msg as FrameListMessage;
    renderFrameList(frames, selectedId);
    return;
  }

  if (msg.type === 'PROGRESS') {
    setStatus((msg as ProgressMessage).message, 'loading');
    return;
  }

  if (msg.type === 'ERROR') {
    setStatus((msg as ErrorMessage).message, 'error');
    exportBtn.disabled = false;
    return;
  }

  if (msg.type === 'EXPORT_DATA') {
    const payload = msg as ExportPayload;
    handleExportData(payload).catch(function(err: any) {
      setStatus('Error: ' + (err && err.message ? err.message : String(err)), 'error');
    }).finally(function() {
      exportBtn.disabled = false;
    });
  }
};

// ---------------------------------------------------------------------------
// Export button
// ---------------------------------------------------------------------------

exportBtn.addEventListener('click', function() {
  if (!selectedFrameId) return;
  exportBtn.disabled = true;
  setStatus('Sending request to Figma\u2026', 'loading');
  const msg: StartExportMessage = { type: 'EXPORT_FRAME', frameId: selectedFrameId };
  parent.postMessage({ pluginMessage: msg }, '*');
});

// ---------------------------------------------------------------------------
// Link input — paste a Figma node URL to jump directly to a frame
// ---------------------------------------------------------------------------

/**
 * Extracts the Figma node ID from a share URL.
 * Figma URLs use hyphens in the query param: node-id=1234-567
 * The Figma plugin API uses colons:              1234:567
 */
function parseNodeIdFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    const param = url.searchParams.get('node-id');
    if (!param) return null;
    // Convert URL hyphens to Figma API colons: "1234-567" → "1234:567"
    return param.replace(/-/g, ':');
  } catch {
    return null;
  }
}

function submitLink() {
  const raw = linkInput.value.trim();
  if (!raw) {
    setStatus('Paste a Figma link first, then click Go.', 'error');
    linkInput.focus();
    return;
  }

  const nodeId = parseNodeIdFromUrl(raw);
  if (!nodeId) {
    setStatus('Invalid link — copy it from Figma via Share \u2192 Copy link.', 'error');
    return;
  }

  setStatus('Looking up frame\u2026', 'loading');
  linkBtn.disabled = true;

  const msg: FindNodeMessage = { type: 'FIND_NODE', nodeId };
  parent.postMessage({ pluginMessage: msg }, '*');
}

linkBtn.addEventListener('click', submitLink);

linkInput.addEventListener('keydown', function(e: KeyboardEvent) {
  if (e.key === 'Enter') submitLink();
});

// ---------------------------------------------------------------------------
// Init — request the frame list immediately and once more after a short delay
// ---------------------------------------------------------------------------

function requestFrames() {
  parent.postMessage({ pluginMessage: { type: 'GET_FRAMES' } }, '*');
}
requestFrames();
setTimeout(requestFrames, 300);
