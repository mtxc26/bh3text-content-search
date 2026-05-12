// After bh3text-data produces dist/pages/*.json, this script copies them to dist/static/all/
// and precompiles the Handlebars template.

import { cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import Handlebars from 'handlebars';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PAGES_SRC = join(ROOT, 'data', 'dist', 'pages');
const PAGES_DST = join(ROOT, 'dist', 'static', 'all');

async function copyPages() {
  await mkdir(PAGES_DST, { recursive: true });
  for (const name of ['main1.json', 'main2.json', 'er.json']) {
    await cp(join(PAGES_SRC, name), join(PAGES_DST, name));
    console.log(`  Copied ${name}`);
  }
}

async function precompileHandlebars() {
  const tplPath = join(ROOT, 'src', 'pages', 'search.hbs');
  const template = await readFile(tplPath, 'utf-8');
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

await copyPages();
await precompileHandlebars();
console.log('build-data done.');
