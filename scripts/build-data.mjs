import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import Handlebars from 'handlebars';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PAGES_SRC = join(ROOT, 'data', 'dist', 'pages');
const PAGES_DST = join(ROOT, 'dist', 'static', 'all');
const WEBSTATIC = join(ROOT, 'dist', 'static');

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

// ── Chinese chapter number conversion (from bh3text/build/util.mjs) ──

const CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

function toCnText(n) {
  if (n < 10) return CN_DIGITS[n];
  if (n === 10) return "十";
  const q = Math.floor(n / 10);
  const r = n % 10;
  if (q === 1) return "十" + (r > 0 ? CN_DIGITS[r] : "");
  return CN_DIGITS[q] + "十" + (r > 0 ? CN_DIGITS[r] : "");
}

function toChapterNumber(ch) {
  const n = Number(ch) % 100;
  if (isNaN(n)) return String(ch);
  const a = Math.floor(n);
  const b = Math.round(10 * (n - a));
  let s = "第" + toCnText(a) + "章";
  if (b > 0) { s += "间章"; if (b > 1 && b !== 5) s += b; }
  return s;
}

const CATEGORY_LABELS = { main1: "主线第一部", main2: "主线第二部", er: "往世乐土" };

const MARS_STAGE_NUMBER_MAP = {
  "1.5": "虚影的宴舞", "3.5": "一个梦游者的苦痛",
  "7.5": "神明无处祈祷", "9.5": "星星仍在闪烁", "11.5": "光所梦寻之夜",
};

// ── Process pages ──

async function processPages(name) {
  const pages = JSON.parse(await readFile(join(PAGES_SRC, `${name}.json`), 'utf-8'));
  const out = pages.map(pg => {
    const isMarsChapter = name === "main2" && String(pg.c).includes(".5") && MARS_STAGE_NUMBER_MAP[String(pg.c)];
    const chapterLabel = isMarsChapter ? "梦间拾集" : (CATEGORY_LABELS[name] || "");
    const chapterNum = name === "er" ? "" : (isMarsChapter ? "" : toChapterNumber(pg.c));
    return {
      u: pg.u,
      c: chapterLabel + chapterNum,
      t: pg.ct,
      p: pg.pt,
      l: extractLines(pg.blocks),
    };
  });
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
await mkdir(WEBSTATIC, { recursive: true });
await cp(join(ROOT, 'public'), WEBSTATIC, { recursive: true });

for (const name of ['main1', 'main2', 'er']) {
  await processPages(name);
}
await precompileHandlebars();
console.log('build-data done.');
