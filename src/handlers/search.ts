import renderTemplate from "../build-cache/search.hbs.js";
import { gunzipSync } from "fflate";

// ── Types ──

interface DialogLine {
  a: string;
  t: string;
}

interface StageData {
  c: string;
  ct: string;
  s: string;
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
  stageId: string;
  matchCount: number;
  lines: { actor: string; content: string; match: boolean }[];
}

// ── Cache ──

let dataCache: StageData[] | null = null;

const BASE_URL = 'https://www.bh3text.com';
const CATEGORIES = ['main1', 'main2', 'er'] as const;

async function loadAllData(env: any): Promise<StageData[]> {
  if (dataCache) return dataCache;

  const allStages: StageData[] = [];

  for (const cat of CATEGORIES) {
    const req = new Request(`https://local/all/${cat}.json.gz`);
    const resp = await env.ASSETS.fetch(req);
    if (!resp.ok) continue;
    const buf = new Uint8Array(await resp.arrayBuffer());
    const decompressed = gunzipSync(buf);
    const text = new TextDecoder().decode(decompressed);
    const stages = JSON.parse(text) as StageData[];
    for (const st of stages) {
      st.u = BASE_URL + st.u;
    }
    allStages.push(...stages);
  }

  dataCache = allStages;
  return allStages;
}

const CONTEXT_RADIUS = 2;

function searchInData(data: StageData[], query: string): SearchMatch[] {
  const q = query.toLowerCase();
  const matches: SearchMatch[] = [];

  for (const stage of data) {
    for (let i = 0; i < stage.l.length; i++) {
      if (stage.l[i]!.t.toLowerCase().includes(q)) {
        matches.push({ stage, lineIdx: i });
      }
    }
  }

  return matches;
}

function highlightText(text: string, query: string): string {
  let escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  if (!query) return escaped;

  const qLower = query.toLowerCase();
  const escLower = escaped.toLowerCase();
  let result = '';
  let lastIdx = 0;

  let idx = escLower.indexOf(qLower);
  while (idx !== -1) {
    result += escaped.slice(lastIdx, idx);
    result += '<mark>' + escaped.slice(idx, idx + query.length) + '</mark>';
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
      stageId: stage.s,
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
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 50);

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
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
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
        stageId: r.stageId,
        matchCount: r.matchCount,
        lines: r.lines,
      })),
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
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
