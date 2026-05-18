import renderTemplate from "../build-cache/search.hbs.js";
import { checkSync } from "recheck";
import yn from "yn";

const BASE_URL = 'https://www.bh3text.com';
const CATEGORIES = ['main1', 'main2', 'er'] as const;
const CONTEXT_RADIUS = 2;
const HTML_TAG_RE = /<[^>]*>/g;

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

interface GroupedLine {
  actor: string;
  content: string;
  match: boolean;
  lineId?: string;
  lineUrl?: string;
  separator?: boolean;
}

interface GroupedResult {
  url: string;
  stageId: string;
  chapter: string;
  chapterTitle: string;
  pageTitle: string;
  matchCount: number;
  lines: GroupedLine[];
}

type SearchMode =
  | { kind: 'plain'; tokens: SearchToken[] }
  | { kind: 'regex'; regex: RegExp };

// ── Cache ──

let dataCache: StageData[] | null = null;
let loadingPromise: Promise<StageData[]> | null = null;
const textCache = new WeakMap<DialogLine, string>();
const actorCache = new WeakMap<DialogLine, string>();

async function loadAllData(env: any): Promise<StageData[]> {
  if (dataCache) return dataCache;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const allStages: StageData[] = [];
    for (const cat of CATEGORIES) {
      const req = new Request(`https://local/all/${cat}.json`);
      const resp = await env.ASSETS.fetch(req);
      if (!resp.ok) continue;
      const stages = (await resp.json()) as StageData[];
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
    while (i < query.length && query[i] === ' ') i++;
    if (i >= query.length) break;

    if (query[i] === '"') {
      i++;
      let phrase = '';
      while (i < query.length && query[i] !== '"') {
        phrase += query[i];
        i++;
      }
      if (i < query.length) i++;
      const trimmed = phrase.trim();
      if (trimmed) {
        tokens.push({ raw: trimmed, lower: trimmed.toLowerCase(), quoted: true });
      }
    } else {
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


function parseNonNegativeInt(value: string | null, fallback: number): number {
  if (value == null) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (value == null) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSearchMode(query: string, regexEnabled: boolean, flags: string): SearchMode | { error: string } {
  if (!regexEnabled) {
    const tokens = parseQuery(query);
    return { kind: 'plain', tokens };
  }

  try {
    const checkResult = checkSync(query, flags);
    if (checkResult.status === 'vulnerable' && checkResult.complexity.type === 'exponential') {
      return { error: '暂不支持此表达式，请尝试修改您的输入。' };
    }
    return { kind: 'regex', regex: new RegExp(query, flags) };
  } catch (error) {
    const message = String(error);
    return { error: `Invalid input: ${message}` };
  }
}

// ── URL Builder ──

function buildSearchUrl(q: string, actor: string, regexEnabled: boolean, flags: string, offset: number, limit: number): string {
  const params = new URLSearchParams();
  params.set("q", q);
  if (actor) params.set("a", actor);
  if (regexEnabled) params.set("regex", "1");
  if (flags) params.set("flags", flags);
  params.set("offset", String(offset));
  params.set("limit", String(limit));
  return "/search?" + params.toString();
}

// ── Text helpers ──

function getSearchText(line: DialogLine): string {
  const cached = textCache.get(line);
  if (cached !== undefined) return cached;
  const text = line.T ?? line.t.replace(HTML_TAG_RE, '');
  textCache.set(line, text);
  return text;
}

function getSearchActor(line: DialogLine): string {
  const cached = actorCache.get(line);
  if (cached !== undefined) return cached;
  const actor = line.A ?? line.a.replace(HTML_TAG_RE, '');
  actorCache.set(line, actor);
  return actor;
}

// ── Search ──

function searchInData(data: StageData[], mode: SearchMode, actor?: string): SearchMatch[] {
  const a = actor?.toLowerCase();
  const matches: SearchMatch[] = [];

  for (let stageIdx = 0; stageIdx < data.length; stageIdx++) {
    const stage = data[stageIdx]!;
    for (let i = 0; i < stage.l.length; i++) {
      const line = stage.l[i]!;

      if (a && !getSearchActor(line).includes(a)) continue;

      const text = getSearchText(line);
      let matched = false;

      if (mode.kind === 'plain') {
        const lowerText = text.toLowerCase();
        matched = true;
        for (let t = 0; t < mode.tokens.length; t++) {
          if (!lowerText.includes(mode.tokens[t]!.lower)) {
            matched = false;
            break;
          }
        }
      } else {
        mode.regex.lastIndex = 0;
        matched = mode.regex.test(text);
      }

      if (!matched) continue;
      matches.push({ stage, lineIdx: i });
    }
  }

  return matches;
}

// ── Highlight ──

function mergeIntervals(intervals: [number, number][]): [number, number][] {
  if (!intervals.length) return intervals;
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [intervals[0]!];
  for (let i = 1; i < intervals.length; i++) {
    const current = intervals[i]!;
    const last = merged[merged.length - 1]!;
    if (current[0] <= last[1]) {
      last[1] = Math.max(last[1], current[1]);
    } else {
      merged.push(current);
    }
  }
  return merged;
}

function highlightIntervals(text: string, intervals: [number, number][]): string {
  if (!intervals.length) return text;
  const merged = mergeIntervals(intervals);
  let out = '';
  let pos = 0;
  for (let i = 0; i < merged.length; i++) {
    const [start, end] = merged[i]!;
    out += text.slice(pos, start);
    out += '<search-match>' + text.slice(start, end) + '</search-match>';
    pos = end;
  }
  out += text.slice(pos);
  return out;
}

function highlightText(html: string, tokens: SearchToken[]): string {
  if (!tokens.length) return html;

  const terms = tokens.map(token => ({ lower: token.lower, len: token.raw.length }));
  const wrapped = '>' + html + '<';
  const re = />([^<]*)</g;

  const result = wrapped.replace(re, (_match: string, text: string) => {
    const lower = text.toLowerCase();
    const intervals: [number, number][] = [];

    for (let i = 0; i < terms.length; i++) {
      const term = terms[i]!;
      let idx = lower.indexOf(term.lower);
      while (idx !== -1) {
        intervals.push([idx, idx + term.len]);
        idx = lower.indexOf(term.lower, idx + 1);
      }
    }

    return intervals.length ? '>' + highlightIntervals(text, intervals) + '<' : '>' + text + '<';
  });

  return result.slice(1, -1);
}

function highlightRegexText(html: string, regex: RegExp): string {
  const wrapped = '>' + html + '<';
  const re = />([^<]*)</g;
  const highlightFlags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const highlightRegex = new RegExp(regex.source, highlightFlags);

  const result = wrapped.replace(re, (_match: string, text: string) => {
    const intervals: [number, number][] = [];
    highlightRegex.lastIndex = 0;

    let execResult: RegExpExecArray | null;
    while ((execResult = highlightRegex.exec(text)) !== null) {
      const matchText = execResult[0];
      if (!matchText) {
        return '>' + text + '<';
      }
      intervals.push([execResult.index, execResult.index + matchText.length]);
    }

    return intervals.length ? '>' + highlightIntervals(text, intervals) + '<' : '>' + text + '<';
  });

  return result.slice(1, -1);
}

// ── Group ──

function groupResults(
  matches: SearchMatch[],
  mode: SearchMode,
  offset: number,
  limit: number,
): {
  results: GroupedResult[];
  totalCount: number;
  hasMore: boolean;
} {
  const stageMap = new Map<StageData, { matchIndices: Set<number>; firstIdx: number }>();

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    let bucket = stageMap.get(match.stage);
    if (!bucket) {
      bucket = { matchIndices: new Set<number>(), firstIdx: match.lineIdx };
      stageMap.set(match.stage, bucket);
    }
    bucket.matchIndices.add(match.lineIdx);
    if (match.lineIdx < bucket.firstIdx) {
      bucket.firstIdx = match.lineIdx;
    }
  }

  const allResults: GroupedResult[] = [];

  for (const [stage, bucket] of stageMap) {
    const linesToInclude = new Set<number>();
    for (const idx of bucket.matchIndices) {
      const start = Math.max(0, idx - CONTEXT_RADIUS);
      const end = Math.min(stage.l.length - 1, idx + CONTEXT_RADIUS);
      for (let j = start; j <= end; j++) {
        linesToInclude.add(j);
      }
    }

    const sortedIndices = Array.from(linesToInclude).sort((a, b) => a - b);
    const lines: GroupedLine[] = [];

    for (let k = 0; k < sortedIndices.length; k++) {
      if (k > 0 && sortedIndices[k]! - sortedIndices[k - 1]! > 1) {
        lines.push({ actor: '', content: '', match: false, separator: true });
      }

      const idx = sortedIndices[k]!;
      const ln = stage.l[idx]!;
      const isMatch = bucket.matchIndices.has(idx);
      lines.push({
        actor: ln.a,
        content: isMatch
          ? (mode.kind === 'plain' ? highlightText(ln.t, mode.tokens) : highlightRegexText(ln.t, mode.regex))
          : ln.t,
        match: isMatch,
        lineId: ln.i,
        lineUrl: stage.u + '#' + ln.i,
      });
    }

    const firstMatchId = stage.l[bucket.firstIdx]!.i;
    const stageNum = firstMatchId.split('_')[1] || firstMatchId;

    allResults.push({
      url: stage.u + '#stage_' + stageNum,
      stageId: 'stage_' + stageNum,
      chapter: stage.c,
      chapterTitle: stage.t,
      pageTitle: stage.p,
      matchCount: bucket.matchIndices.size,
      lines,
    });
  }

  allResults.sort((a, b) => b.matchCount - a.matchCount);

  const totalCount = allResults.length;
  const results = allResults.slice(offset, offset + limit);

  return { results, totalCount, hasMore: offset + limit < totalCount };
}

// ── Handler ──

export async function handleSearch(request: Request, env: any): Promise<Response> {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const actor = (url.searchParams.get('a') || '').trim();
  const format = (url.searchParams.get('format') || 'html').trim().toLowerCase();
  const regexEnabled = !!yn(url.searchParams.get('regex'));
  const flags = (url.searchParams.get('flags') || '').trim();
  const offset = parseNonNegativeInt(url.searchParams.get('offset'), 0);
  const limit = Math.min(parsePositiveInt(url.searchParams.get('limit'), 100), 1000);

  if (!q) {
    if (format === 'json') {
      return Response.json({ error: 'Missing query parameter: q' }, { status: 400 });
    }
    const html = renderTemplate({ q: "", actor: "", regex: regexEnabled, flags, results: [], offset: 0, limit, hasMore: false, searchOptionsOpen: Boolean(actor || regexEnabled || flags) });
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'max-age=600' },
    });
  }

  const mode = parseSearchMode(q, regexEnabled, flags);
  if ('error' in mode) {
    if (format === 'json') {
      return Response.json({ error: mode.error }, { status: 400 });
    }

    const html = renderTemplate({ q, actor, regex: regexEnabled, flags, results: [], offset, limit, hasMore: false, errorMessage: mode.error, searchOptionsOpen: Boolean(actor || regexEnabled || flags || mode.error) });
    return new Response(html, {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'max-age=600' },
    });
  }

  const data = await loadAllData(env);
  const matches = searchInData(data, mode, actor || undefined);
  const { results, totalCount, hasMore } = groupResults(matches, mode, offset, limit);
  const matchTotalCount = matches.length;

  if (format === 'json') {
    return Response.json({
      query: q,
      actor: actor || undefined,
      regex: regexEnabled,
      flags: regexEnabled ? flags : undefined,
      totalCount,
      offset,
      limit,
      hasMore,
      results: results.map(r => ({
        url: r.url,
        chapter: r.chapter,
        chapterTitle: r.chapterTitle,
        pageTitle: r.pageTitle,
        matchCount: r.matchCount,
        lines: r.lines,
      })),
    }, { headers: { 'Cache-Control': 'max-age=600' } });
  }

  const prevUrl = offset > 0 ? buildSearchUrl(q, actor, regexEnabled, flags, Math.max(0, offset - limit), limit) : '';
  const nextUrl = hasMore ? buildSearchUrl(q, actor, regexEnabled, flags, offset + limit, limit) : '';

  const html = renderTemplate({ q, actor, regex: regexEnabled, flags, results, offset, limit, totalCount, hasMore, prevUrl, nextUrl, hasPagination: !!(prevUrl || nextUrl), showInfo: matchTotalCount > 0, matchTotalCount, showRange: results.length < totalCount, rangeStart: offset + 1, rangeEnd: Math.min(offset + results.length, totalCount), searchOptionsOpen: Boolean(actor || regexEnabled || flags) });

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'max-age=600' },
  });
}
