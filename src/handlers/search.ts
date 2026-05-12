import renderTemplate from "../build-cache/search.hbs.js";

// ── Types ──

interface DialogLine {
  a: string;
  t: string;
  A?: string;
  T?: string;
}

interface StageData {
  c: string;
  t: string;
  p: string;
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

// ── Search ──

function getSearchText(line: DialogLine): string {
  return line.T ?? line.t.replace(/<[^>]*>/g, '');
}

function getSearchActor(line: DialogLine): string {
  return line.A ?? line.a.replace(/<[^>]*>/g, '');
}

function searchInData(data: StageData[], query: string, actor?: string): SearchMatch[] {
  const q = query.toLowerCase();
  const a = actor?.toLowerCase();
  const matches: SearchMatch[] = [];

  for (const stage of data) {
    for (let i = 0; i < stage.l.length; i++) {
      const line = stage.l[i]!;
      if (!getSearchText(line).includes(q)) continue;
      if (a && !getSearchActor(line).includes(a)) continue;
      matches.push({ stage, lineIdx: i });
    }
  }

  return matches;
}

// ── Highlight ──

function highlightText(html: string, query: string): string {
  if (!query) return html;
  const qLower = query.toLowerCase();
  const wrapped = '>' + html + '<';
  const re = />([^<]*)</g;
  const result = wrapped.replace(re, (_match: string, text: string) => {
    const lower = text.toLowerCase();
    let out = '';
    let lastIdx = 0;
    let idx = lower.indexOf(qLower);
    while (idx !== -1) {
      out += text.slice(lastIdx, idx);
      out += '<search-match>' + text.slice(idx, idx + query.length) + '</search-match>';
      lastIdx = idx + query.length;
      idx = lower.indexOf(qLower, lastIdx);
    }
    out += text.slice(lastIdx);
    return '>' + out + '<';
  });
  return result.slice(1, -1);
}

// ── Group ──

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
        content: isMatch ? highlightText(ln.t, query) : ln.t,
        match: isMatch,
      };
    });

    results.push({
      url: stage.u,
      chapterTitle: stage.t,
      pageTitle: stage.p,
      matchCount: matchIndices.size,
      lines,
    });
  }

  results.sort((a, b) => b.matchCount - a.matchCount);
  return { results, totalCount, hasMore: offset + limit < totalCount };
}

// ── Build URL ──

function buildSearchUrl(q: string, actor: string, offset: number, limit: number): string {
  let url = `/search?q=${encodeURIComponent(q)}`;
  if (actor) url += `&a=${encodeURIComponent(actor)}`;
  url += `&offset=${offset}&limit=${limit}`;
  return url;
}

// ── Handler ──

export async function handleSearch(request: Request, env: any): Promise<Response> {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const actor = (url.searchParams.get('a') || '').trim();
  const format = url.searchParams.get('format') || 'html';
  const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1000);

  if (!q) {
    if (format === 'json') {
      return Response.json({ error: 'Missing query parameter: q' }, { status: 400 });
    }
    const html = renderTemplate({ q: "", actor: "", results: [], offset: 0, limit, hasMore: false });
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'max-age=600' },
    });
  }

  const data = await loadAllData(env);
  const matches = searchInData(data, q, actor || undefined);
  const { results, totalCount, hasMore } = groupResults(matches, q, offset, limit);

  if (format === 'json') {
    return Response.json({
      query: q,
      actor: actor || undefined,
      totalCount, offset, limit, hasMore,
      results: results.map(r => ({
        url: r.url, chapterTitle: r.chapterTitle, pageTitle: r.pageTitle,
        matchCount: r.matchCount, lines: r.lines,
      })),
    }, { headers: { 'Cache-Control': 'max-age=600' } });
  }

  const prevUrl = offset > 0 ? buildSearchUrl(q, actor, Math.max(0, offset - limit), limit) : '';
  const nextUrl = hasMore ? buildSearchUrl(q, actor, offset + limit, limit) : '';

  const html = renderTemplate({
    q, actor,
    results, offset, limit, totalCount, hasMore,
    prevUrl, nextUrl, hasPagination: !!(prevUrl || nextUrl),
    showInfo: totalCount > 0,
    showRange: results.length < totalCount,
    rangeStart: offset + 1,
    rangeEnd: Math.min(offset + results.length, totalCount),
  });
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=600' },
  });
}
