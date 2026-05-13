import renderTemplate from "../build-cache/search.hbs.js";

// ── Types ──

interface DialogLine {
  a: string;
  t: string;
  i: string;
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
  stageId: string;
  chapterTitle: string;
  pageTitle: string;
  matchCount: number;
  lines: { actor: string; content: string; match: boolean; lineId?: string; lineUrl?: string; separator?: boolean }[];
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
      /*for (const st of stages) {
        st.u = BASE_URL + st.u;
      }*/
      allStages.push(...stages);
    }
    dataCache = allStages;
    loadingPromise = null;
    return allStages;
  })();

  return loadingPromise;
}

const CONTEXT_RADIUS = 2;

// ── Query parsing ──

interface SearchToken {
  raw: string;
  lower: string;
  quoted: boolean;
}

function parseQuery(query: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  let i = 0;
  while (i < query.length) {
    // Skip whitespace
    while (i < query.length && query[i] === ' ') i++;
    if (i >= query.length) break;

    if (query[i] === '"') {
      // Quoted phrase
      i++; // skip opening quote
      let phrase = '';
      while (i < query.length && query[i] !== '"') {
        phrase += query[i];
        i++;
      }
      if (i < query.length) i++; // skip closing quote
      const trimmed = phrase.trim();
      if (trimmed) {
        tokens.push({ raw: trimmed, lower: trimmed.toLowerCase(), quoted: true });
      }
    } else {
      // Plain token
      let word = '';
      while (i < query.length && query[i] !== ' ' && query[i] !== '"') {
        word += query[i];
        i++;
      }
      if (word) {
        tokens.push({ raw: word, lower: word.toLowerCase(), quoted: false });
      }
    }
  }
  return tokens;
}

// ── Search ──

function getSearchText(line: DialogLine): string {
  return line.T ?? line.t.replace(/<[^>]*>/g, '');
}

function getSearchActor(line: DialogLine): string {
  return line.A ?? line.a.replace(/<[^>]*>/g, '');
}

function searchInData(data: StageData[], tokens: SearchToken[], actor?: string): SearchMatch[] {
  const a = actor?.toLowerCase();
  const matches: SearchMatch[] = [];

  for (const stage of data) {
    for (let i = 0; i < stage.l.length; i++) {
      const line = stage.l[i]!;
      const text = getSearchText(line);
      // All tokens must match
      let allMatch = true;
      for (const tok of tokens) {
        if (!text.includes(tok.lower)) { allMatch = false; break; }
      }
      if (!allMatch) continue;
      if (a && !getSearchActor(line).includes(a)) continue;
      matches.push({ stage, lineIdx: i });
    }
  }

  return matches;
}

// ── Highlight ──

function highlightText(html: string, tokens: SearchToken[]): string {
  if (!tokens.length) return html;

  // Build array of {lower, length} for each token to highlight
  const terms = tokens.map(t => ({ lower: t.lower, len: t.raw.length }));

  const wrapped = '>' + html + '<';
  const re = />([^<]*)</g;
  const result = wrapped.replace(re, (_match: string, text: string) => {
    const lower = text.toLowerCase();
    // Find all match intervals
    const intervals: [number, number][] = [];
    for (const term of terms) {
      let idx = lower.indexOf(term.lower);
      while (idx !== -1) {
        intervals.push([idx, idx + term.len]);
        idx = lower.indexOf(term.lower, idx + 1);
      }
    }
    if (!intervals.length) return '>' + text + '<';

    // Merge overlapping intervals
    intervals.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [intervals[0]!];
    for (let i = 1; i < intervals.length; i++) {
      const last = merged[merged.length - 1]!;
      if (intervals[i]![0] <= last[1]) {
        last[1] = Math.max(last[1], intervals[i]![1]);
      } else {
        merged.push(intervals[i]!);
      }
    }

    // Build highlighted output
    let out = '';
    let pos = 0;
    for (const [s, e] of merged) {
      out += text.slice(pos, s);
      out += '<search-match>' + text.slice(s, e) + '</search-match>';
      pos = e;
    }
    out += text.slice(pos);
    return '>' + out + '<';
  });
  return result.slice(1, -1);
}

// ── Group ──

function groupResults(
  matches: SearchMatch[],
  tokens: SearchToken[],
  offset: number,
  limit: number,
): {
  results: GroupedResult[];
  totalCount: number;
  hasMore: boolean;
} {
  // Group ALL matches into stages first
  const stageMap = new Map<StageData, Set<number>>();
  for (const m of matches) {
    if (!stageMap.has(m.stage)) {
      stageMap.set(m.stage, new Set());
    }
    stageMap.get(m.stage)!.add(m.lineIdx);
  }

  // Build all result items
  const allResults: GroupedResult[] = [];
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
    const lines: { actor: string; content: string; match: boolean; lineId?: string; lineUrl?: string; separator?: boolean }[] = [];
    for (let k = 0; k < sortedIndices.length; k++) {
      // Insert separator if gap > 1
      if (k > 0 && sortedIndices[k]! - sortedIndices[k-1]! > 1) {
        lines.push({ actor: '', content: '', match: false, separator: true });
      }
      const idx = sortedIndices[k]!;
      const ln = stage.l[idx]!;
      const isMatch = matchIndices.has(idx);
      lines.push({
        actor: ln.a,
        content: isMatch ? highlightText(ln.t, tokens) : ln.t,
        match: isMatch,
        lineId: ln.i,
        lineUrl: stage.u + "#" + ln.i,
      });
    }

    const firstMatchId = stage.l[Math.min(...matchIndices)]!.i;
    const stageNum = firstMatchId.split('_')[1]!;

    allResults.push({
      url: stage.u + "#stage_" + stageNum,
      stageId: "stage_" + stageNum,
      chapterTitle: stage.t,
      pageTitle: stage.p,
      matchCount: matchIndices.size,
      lines,
    });
  }

  allResults.sort((a, b) => b.matchCount - a.matchCount);

  const totalCount = allResults.length;
  const results = allResults.slice(offset, offset + limit);

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
  const tokens = parseQuery(q);
  const matches = searchInData(data, tokens, actor || undefined);
  const { results, totalCount, hasMore } = groupResults(matches, tokens, offset, limit);
  const matchTotalCount = matches.length;

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
    showInfo: matchTotalCount > 0,
    matchTotalCount,
    showRange: results.length < totalCount,
    rangeStart: offset + 1,
    rangeEnd: Math.min(offset + results.length, totalCount),
  });
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'max-age=600' },
  });
}
