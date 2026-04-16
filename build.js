const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');

function ensureDist() {
  if (!fs.existsSync('dist')) fs.mkdirSync('dist');
}

async function buildAndInjectHTML() {
  // Build ui.ts bundle
  await esbuild.build({
    entryPoints: ['src/ui.ts'],
    bundle: true,
    outfile: 'dist/ui-bundle.js',
    platform: 'browser',
    target: ['es2019'],
    format: 'iife',
    minify: !isWatch,
    sourcemap: isWatch ? 'inline' : false,
  });

  // Inline the bundle into ui.html.
  // Escape </script> so any occurrence in the bundle doesn't prematurely
  // close the script tag when the browser parses the page.
  const html = fs.readFileSync('src/ui.html', 'utf-8');
  const js = fs.readFileSync('dist/ui-bundle.js', 'utf-8');
  const safeJs = js.replace(/<\/script/gi, '<\\/script');
  const output = html.replace('<!-- INJECT_BUNDLE -->', '<script>' + safeJs + '<\/script>');
  fs.writeFileSync('dist/ui.html', output);
  fs.unlinkSync('dist/ui-bundle.js');
  console.log('[build] dist/ui.html ready');
}

async function buildCode() {
  await esbuild.build({
    entryPoints: ['src/code.ts'],
    bundle: true,
    outfile: 'dist/code.js',
    platform: 'browser',
    // Figma's sandbox (QuickJS) doesn't support optional chaining (?.)
    // or nullish coalescing (??). Target es2017 forces esbuild to transpile
    // those operators into compatible equivalents.
    target: ['es2017'],
    format: 'iife',
    minify: !isWatch,
    sourcemap: isWatch ? 'inline' : false,
  });
  console.log('[build] dist/code.js ready');
}

async function main() {
  ensureDist();

  if (isWatch) {
    // Watch mode: rebuild on changes
    const codeCtx = await esbuild.context({
      entryPoints: ['src/code.ts'],
      bundle: true,
      outfile: 'dist/code.js',
      platform: 'browser',
      target: ['es2017'],
      format: 'iife',
      sourcemap: 'inline',
    });

    const uiCtx = await esbuild.context({
      entryPoints: ['src/ui.ts'],
      bundle: true,
      outfile: 'dist/ui-bundle.js',
      platform: 'browser',
      target: ['es2019'],
      format: 'iife',
      sourcemap: 'inline',
      plugins: [{
        name: 'inject-html',
        setup(build) {
          build.onEnd(() => {
            const html = fs.readFileSync('src/ui.html', 'utf-8');
            const js = fs.readFileSync('dist/ui-bundle.js', 'utf-8');
            const output = html.replace('<!-- INJECT_BUNDLE -->', `<script>\n${js}\n</script>`);
            fs.writeFileSync('dist/ui.html', output);
            console.log('[watch] rebuilt');
          });
        }
      }]
    });

    await codeCtx.watch();
    await uiCtx.watch();
    console.log('[watch] watching for changes...');
  } else {
    await Promise.all([buildCode(), buildAndInjectHTML()]);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
