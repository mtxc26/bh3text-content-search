import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import Handlebars from 'handlebars';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PAGES_SRC = join(ROOT, 'data', 'dist', 'pages');
const PAGES_DST = join(ROOT, 'dist', 'static', 'all');

// ── Strip Unity rich text tags ──

function stripUnityTags(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/<[^>]*>/g, '');
}

// ── Extract lines from blocks ──

function extractLines(blocks) {
  const result = [];
  blocks.forEach((blk, bi) => {
    if (blk.lines) {
      blk.lines.forEach((ln, li) => {
        const actor = (ln.actor && typeof ln.actor === 'string') ? ln.actor : '';
        const content = (ln.content && typeof ln.content === 'string') ? ln.content : '';
        if (!content) return;

        const line = { a: actor, t: content, i: `content_${bi+1}_${li+1}` };

        // Stripped actor (for actor search)
        const actor2 = (ln.actor2 && typeof ln.actor2 === 'string') ? ln.actor2 : '';
        const actorStripped = stripUnityTags(actor2);
        if (actorStripped !== actor2) {
          line.A = actorStripped;
        }

        // Stripped content (for search)
        const content2 = (ln.content2 && typeof ln.content2 === 'string') ? ln.content2 : '';
        const contentStripped = stripUnityTags(content2);
        if (contentStripped !== content2) {
          line.T = contentStripped;
        }

        result.push(line);
      });
    }
  });
  return result;
}

// ── Process pages ──

async function processPages(name) {
  const pages = JSON.parse(await readFile(join(PAGES_SRC, `${name}.json`), 'utf-8'));
  const out = pages.map(pg => ({
    u: pg.u,
    c: pg.c,
    t: pg.ct,
    p: pg.pt,
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
  const ref = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  console.log(`  git ref: ${ref}`);

  const tplPath = join(ROOT, 'src', 'pages', 'search.hbs');
  let template = await readFile(tplPath, 'utf-8');
  // Append git ref to all /r/ assets for cache busting
  template = template.replace(/"(\/r\/[^"]+)"/g, `"$1?ref=search%3Bgit%3A${ref}"`);

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
