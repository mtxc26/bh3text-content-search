import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIST = join(ROOT, 'data', 'dist');
const OUT_DIR = join(ROOT, 'dist', 'static', 'all');

async function loadJSON(p) {
  return JSON.parse(await readFile(p, 'utf-8'));
}

function cleanText(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/<[^>]*>/g, '');
}

function extractLines(dialogLines) {
  const result = [];
  for (const ln of dialogLines) {
    if (ln.text || ln.type === 'CG') continue;
    if (ln.isOption) continue;
    const actor = cleanText(ln.actor || '');
    const rawContent = Array.isArray(ln.content)
      ? ln.content.join('')
      : (ln.content || '');
    const content = cleanText(rawContent);
    if (content) {
      result.push({ a: actor, t: content });
    }
  }
  return result;
}

async function buildMain1() {
  console.log('Building main1...');
  const appIdx = await loadJSON(join(DATA_DIST, 'app/index/main.json'));
  const stages = [];

  for (const [, chapters] of Object.entries(appIdx)) {
    for (const ch of chapters) {
      const chapter = ch.chapter;
      const chapterTitle = ch.title;

      let dialogData;
      try {
        dialogData = await loadJSON(join(DATA_DIST, 'dialog/data/main', `${chapter}.json`));
      } catch { continue; }

      for (const [stageId, lines] of Object.entries(dialogData)) {
        if (!Array.isArray(lines)) continue;
        const flatLines = extractLines(lines);
        if (flatLines.length === 0) continue;

        const url = `/dialog/mainline/1/${chapter}/${encodeURIComponent(stageId)}`;
        stages.push({ c: chapter, ct: chapterTitle, s: stageId, u: url, l: flatLines });
      }
    }
  }

  console.log(`  main1: ${stages.length} stages`);
  return stages;
}

async function buildMain2() {
  console.log('Building main2...');
  const appIdx = await loadJSON(join(DATA_DIST, 'app/index/main2.json'));
  const stages = [];

  for (const [, chapters] of Object.entries(appIdx)) {
    for (const ch of chapters) {
      const chapter = ch.chapter;
      const chapterTitle = ch.title;

      // main2 dialog data files use simple chapter naming: 1.json, 1_5.json, etc.
      const dataFile = String(chapter).includes('.5')
        ? `${chapter.replace('.5', '_5')}.json`
        : `${chapter}.json`;

      let dialogData;
      try {
        dialogData = await loadJSON(join(DATA_DIST, 'dialog/data/main2', dataFile));
      } catch { continue; }

      for (const [stageId, lines] of Object.entries(dialogData)) {
        if (!Array.isArray(lines)) continue;
        const flatLines = extractLines(lines);
        if (flatLines.length === 0) continue;

        const url = `/dialog/mainline/2/${chapter}/${encodeURIComponent(stageId)}`;
        stages.push({ c: chapter, ct: chapterTitle, s: stageId, u: url, l: flatLines });
      }
    }
  }

  console.log(`  main2: ${stages.length} stages`);
  return stages;
}

async function buildEr() {
  console.log('Building er...');
  const erIdx = await loadJSON(join(DATA_DIST, 'dialog/index/er.json'));
  const stages = [];

  for (const [chapter, chapterStages] of Object.entries(erIdx)) {
    let dialogData;
    try {
      dialogData = await loadJSON(join(DATA_DIST, 'dialog/data/er', `${chapter}.json`));
    } catch {
      try {
        dialogData = await loadJSON(join(DATA_DIST, 'dialog/data/er/0.json'));
      } catch { continue; }
    }

    for (const stage of chapterStages) {
      const stageId = stage.id;
      if (!stageId) continue;

      const allLines = [];
      for (const item of (stage.data || [])) {
        if (typeof item === 'string') {
          const lines = dialogData[item];
          if (lines && Array.isArray(lines)) {
            allLines.push(...extractLines(lines));
          }
        } else if (Array.isArray(item) && item.length > 0) {
          for (const subItem of item) {
            if (Array.isArray(subItem) && subItem.length >= 2) {
              const actor = cleanText(String(subItem[0] || ''));
              const content = cleanText(String(subItem[1] || ''));
              if (content) {
                allLines.push({ a: actor, t: content });
              }
            }
          }
        }
      }

      if (allLines.length === 0) continue;

      const chapterTitle = `往世乐土 ${chapter === '0' ? '序章' : '第' + chapter + '章'}`;
      const url = `/dialog/er/${chapter}/${encodeURIComponent(stageId)}`;
      stages.push({ c: chapter, ct: chapterTitle, s: stageId, u: url, l: allLines });
    }
  }

  console.log(`  er: ${stages.length} stages`);
  return stages;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const [main1, main2, er] = await Promise.all([
    buildMain1(),
    buildMain2(),
    buildEr(),
  ]);

  for (const [name, data] of [['main1', main1], ['main2', main2], ['er', er]]) {
    const json = JSON.stringify(data);
    const gzPath = join(OUT_DIR, `${name}.json.gz`);
    const compressed = gzipSync(json);
    await writeFile(gzPath, compressed);
    const gzSizeMB = (compressed.length / 1024 / 1024).toFixed(2);
    console.log(`  ${name}.json.gz: ${gzSizeMB} MiB`);
  }

  console.log('\nBuild done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
