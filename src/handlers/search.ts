import renderTemplate from "../build-cache/search.hbs.js";

// ── Types ──

interface DialogLine {
  a: string;
  t: string;
  tl: string;
}

interface StageData {
  c: string;
  ct: string;
  pt: string;
  u: string;
  l: DialogLine[];
}

interface SearchMatch {
  stage: StageData;
  lineIdx: number;
}

interface GroupedResult {
  url: string;
  chapterTitle: string;
  pageTitle: string;
  matchCount: number;
  lines: { actor: string; content: string; match: boolean }[];
}

// ── Cache ──

let dataCache: StageData[] | null = null;

let loadingPromise: Promise<StageData[]> | null = null;
const BASE_URL = 'https://www.bh3text.com';
const CATEGORIES = ['main1', 'main2', 'er'] as const;

async function loadAllData(env: any): Promise<StageData[]> {
  if (dataCache) return dataCache;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const allStages: StageData[] = [];

    for (const cat of CATEGORIES) {
      const req = new Request(`https://local/all/${cat}.json`);
      const resp = await env.ASSETS.fetch(req);
      if (!resp.ok) continue;
      const stages = await resp.json() as StageData[];
      for (const st of stages) {
        st.u = BASE_URL + st.u;
      }
      allStages.push(...stages);
    }

    dataCache = allStages;
    loadingPromise = null;
    return allStages;
  })();

  return loadingPromise;
}

const CONTEXT_RADIUS = 2;

function procColorTag(_: string, c: string, content: string): string {
    c = c.toLowerCase();
    if (c === '#ffffffff' || c === '#fff' || c === '#fffff' || c === '#fffffff' || c === '#ffffff')
        return '<span style="color:#fff">';
    if (c === '#000000') return '<span style="color:#000">';
    let alpha = 1;
    if (c.startsWith('#') && c.length === 10) {
        alpha = parseInt(c.substring(8), 16) / 255;
        c = c.substring(0, 7);
    }
    if (alpha < 1) return `<span style="color:${c};opacity:${alpha.toFixed(2)}">${content}</span>`;
    return `<span style="color:${c}">${content}</span>`;
}

function searchInData(data: StageData[], query: string): SearchMatch[] {
  const q = query.toLowerCase();
  const matches: SearchMatch[] = [];

  for (const stage of data) {
    for (let i = 0; i < stage.l.length; i++) {
      if (stage.l[i]!.tl.includes(q)) {
        matches.push({ stage, lineIdx: i });
      }
    }
  }

  return matches;
}

function highlightText(text: string, query: string): string {
  let escaped = text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/<color=(#?\w+)>(.*?)<\/color>/g, procColorTag);

  if (!query) return escaped;

  const qLower = query.toLowerCase();
  const escLower = escaped.toLowerCase();
  let result = '';
  let lastIdx = 0;

  let idx = escLower.indexOf(qLower);
  while (idx !== -1) {
    result += escaped.slice(lastIdx, idx);
    result += '<search-match>' + escaped.slice(idx, idx + query.length) + '</search-match>';
    lastIdx = idx + query.length;
    idx = escLower.indexOf(qLower, lastIdx);
  }
  result += escaped.slice(lastIdx);

  return result;
}

function groupResults(
  matches: SearchMatch[],
  query: string,
  offset: number,
  limit: number,
): {
  results: GroupedResult[];
  totalCount: number;
  hasMore: boolean;
} {
  const totalCount = matches.length;
  const pageMatches = matches.slice(offset, offset + limit);

  const stageMap = new Map<StageData, Set<number>>();
  for (const m of pageMatches) {
    if (!stageMap.has(m.stage)) {
      stageMap.set(m.stage, new Set());
    }
    stageMap.get(m.stage)!.add(m.lineIdx);
  }

  const results: GroupedResult[] = [];
  for (const [stage, matchIndices] of stageMap) {
    const linesToInclude = new Set<number>();
    for (const idx of matchIndices) {
      const start = Math.max(0, idx - CONTEXT_RADIUS);
      const end = Math.min(stage.l.length - 1, idx + CONTEXT_RADIUS);
      for (let j = start; j <= end; j++) {
        linesToInclude.add(j);
      }
    }

    const sortedIndices = [...linesToInclude].sort((a, b) => a - b);
    const lines = sortedIndices.map((idx) => {
      const ln = stage.l[idx]!;
      const isMatch = matchIndices.has(idx);
      return {
        actor: ln.a,
        content: isMatch ? highlightText(ln.t, query) : highlightText(ln.t, ''),
        match: isMatch,
      };
    });

    results.push({
      url: stage.u,
      chapterTitle: stage.ct,
      pageTitle: stage.pt,
      matchCount: matchIndices.size,
      lines,
    });
  }

  results.sort((a, b) => b.matchCount - a.matchCount);

  return { results, totalCount, hasMore: offset + limit < totalCount };
}
// ── Handler ──

export async function handleSearch(request: Request, env: any): Promise<Response> {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const format = url.searchParams.get('format') || 'html';
  const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1000);

  if (!q) {
    if (format === 'json') {
      return Response.json({ error: 'Missing query parameter: q' }, { status: 400 });
    }
    const html = renderTemplate({
      q: "",
      results: [],
      offset: 0,
      limit,
      hasMore: false,
    });
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'max-age=600' },
    });
  }

  const data = await loadAllData(env);
  const matches = searchInData(data, q);
  const { results, totalCount, hasMore } = groupResults(matches, q, offset, limit);

  if (format === 'json') {
    return Response.json({
      query: q,
      totalCount,
      offset,
      limit,
      hasMore,
      results: results.map((r) => ({
        url: r.url,
        chapterTitle: r.chapterTitle,
        pageTitle: r.pageTitle,
        matchCount: r.matchCount,
        lines: r.lines,
      })),
    }, {
      headers: { 'Cache-Control': 'max-age=600' },
    });
  }

  const encodedQ = encodeURIComponent(q);
  const html = renderTemplate({
    q,
    encodedQ,
    results,
    offset,
    limit,
    totalCount,
    hasMore,
    nextOffset: offset + limit,
    showInfo: totalCount > 0,
    showRange: results.length < totalCount,
    rangeStart: offset + 1,
    rangeEnd: Math.min(offset + results.length, totalCount),
  });
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=600' },
  });
}
