import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import Handlebars from 'handlebars';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PAGES_SRC = join(ROOT, 'data', 'dist', 'pages');
const PAGES_DST = join(ROOT, 'dist', 'static', 'all');

// ── Extract flat clean lines from blocks ──

function cleanText(text) {
  if (typeof text !== 'string') return '';
  return text
}

function extractLines(blocks) {
  const result = [];
  for (const blk of blocks) {
    if (blk.lines) {
      for (const ln of blk.lines) {
        const actor = cleanText(ln.actor || '');
        const content = cleanText(ln.content || '');
        if (content) {
          result.push({ a: actor, t: content, tl: content.toLowerCase() });
        }
      }
    }
  }
  return result;
}

// ── Process pages ──

async function processPages(name) {
  const pages = JSON.parse(await readFile(join(PAGES_SRC, `${name}.json`), 'utf-8'));
  const out = pages.map(pg => ({
    u: pg.u,
    c: pg.c,
    ct: pg.ct,
    pt: pg.pt,
    l: extractLines(pg.blocks),
  }));
  await mkdir(PAGES_DST, { recursive: true });
  const json = JSON.stringify(out);
  await writeFile(join(PAGES_DST, `${name}.json`), json, 'utf-8');
  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);
  console.log(`  ${name}.json: ${sizeMB} MiB, ${out.length} pages`);
}

// ── Precompile Handlebars ──

async function precompileHandlebars() {
  const ref = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  console.log(`  git ref: ${ref}`);

  const tplPath = join(ROOT, 'src', 'pages', 'search.hbs');
  let template = await readFile(tplPath, 'utf-8');
  template = template.replace(
    'src="/r/runtime/common.js"',
    `src="/r/runtime/common.js?ref=search%3Bgit%3A${ref}"`
  );

  const compiled = Handlebars.precompile(template, { strict: true, preventIndent: true });

  await mkdir(join(ROOT, 'src', 'build-cache'), { recursive: true });
  const outPath = join(ROOT, 'src', 'build-cache', 'search.hbs.js');
  const code = `// Precompiled Handlebars template: search.hbs
import Handlebars from 'handlebars';
export default Handlebars.template(${compiled});
`;
  await writeFile(outPath, code, 'utf-8');
  console.log('  search.hbs precompiled.');
}

// ── Main ──

for (const name of ['main1', 'main2', 'er']) {
  await processPages(name);
}
await precompileHandlebars();
console.log('build-data done.');
