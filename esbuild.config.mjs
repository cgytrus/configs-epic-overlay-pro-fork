import esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEV = process.argv.includes('--watch');
const outFile = resolve(__dirname, 'dist', 'configs-epic-overlay-pro-fork.user.js');
const metaPath = resolve(__dirname, 'src', 'meta.js');

// Plugin: prepend metadata banner after each build
const MetaBannerPlugin = {
  name: 'meta-banner',
  setup(build) {
    build.onEnd(async () => {
      try {
        await mkdir(dirname(outFile), { recursive: true });
        const [meta, js] = await Promise.all([
          readFile(metaPath, 'utf8'),
          readFile(outFile, 'utf8'),
        ]);
        // Normalize CRLF and prepend
        let banner = meta.trim() + '\n';
        try {
          banner = banner
            .replace('GIT_COUNT', execSync('git rev-list HEAD --count').toString().trim())
            .replace('GIT_HASH', execSync('git describe --always --dirty').toString().trim());
        }
        catch (err) {
          console.warn('[meta-banner] Failed to git describe:', err);
        }
        await writeFile(outFile, (banner + js).replace(/\r\n/g, '\n'), 'utf8');
      }
      catch (err) {
        console.error('[meta-banner] Failed to prepend metadata:', err);
      }
    });
  },
};

const buildOptions = {
  entryPoints: [resolve(__dirname, 'src', 'main.ts')],
  outfile: outFile,
  bundle: true,
  minify: false,
  legalComments: 'none',
  target: ['es2021'],
  format: 'iife',
  sourcemap: false,
  logLevel: 'info',
  plugins: [ MetaBannerPlugin ],
};

async function buildOnce() {
  await esbuild.build(buildOptions);
  console.log('[build] Done.');
}

async function buildAndWatch() {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('[watch] Building and watching for changes...');
}

if (DEV) {
  await buildAndWatch();
} else {
  await buildOnce();
}