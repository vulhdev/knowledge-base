// Section chunker: splits a markdown body into sections keyed by their position in the heading
// tree. Sections are offset-only — callers store start/end and a hash, never the text.
import { createHash } from "node:crypto";

export const MAX_SECTION_TOKENS = 400;
export const MIN_SECTION_TOKENS = 40;
export const BREADCRUMB_SEP = " › ";

export type CountTokens = (text: string) => number;

export type Section = {
  chunk_key: string;
  heading_path: string;
  ord: number;
  start_char: number;
  end_char: number;
  start_line: number;
  end_line: number;
  chunk_sha: string;
};

type Line = { text: string; start: number; end: number };

type RawSection = {
  key: string;
  headingPath: string;
  firstLine: number; // 0-based
  lastLine: number; // 0-based inclusive
};

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function splitLines(body: string): Line[] {
  const lines: Line[] = [];
  let pos = 0;
  for (const text of body.split("\n")) {
    lines.push({ text, start: pos, end: pos + text.length });
    pos += text.length + 1;
  }
  return lines;
}

const FENCE = /^\s{0,3}(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const TABLE = /^\s*\|/;
const LIST_ITEM = /^\s{0,3}([-*+]|\d+[.)])\s+/;

/** Lines inside fenced code blocks are flagged so a '#' there is never taken as a heading. */
function fenceMask(lines: Line[]): boolean[] {
  const inFence: boolean[] = [];
  let open = false;
  for (const l of lines) {
    if (FENCE.test(l.text)) {
      inFence.push(true);
      open = !open;
      continue;
    }
    inFence.push(open);
  }
  return inFence;
}

function rawSections(lines: Line[]): RawSection[] {
  const inFence = fenceMask(lines);
  const out: RawSection[] = [];
  // Outline keys come from tree position, never from numbers the author typed.
  const stack: { level: number; text: string; n: number }[] = [];
  const childCounts: number[] = [0]; // childCounts[d] = children seen so far under the node at depth d-1

  let current: RawSection = { key: "0", headingPath: "", firstLine: 0, lastLine: -1 };
  for (let i = 0; i < lines.length; i++) {
    const m = inFence[i] ? null : HEADING.exec(lines[i].text);
    if (!m || m[1].length > 4) {
      current.lastLine = i;
      continue;
    }
    const level = m[1].length;
    const text = m[2].trim();
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    const depth = stack.length;
    childCounts.length = depth + 1;
    childCounts[depth] = (childCounts[depth] ?? 0) + 1;
    stack.push({ level, text, n: childCounts[depth] });
    childCounts[depth + 1] = 0;

    if (current.lastLine >= current.firstLine) out.push(current);
    current = {
      key: stack.map((s) => s.n).join("."),
      headingPath: stack.map((s) => s.text).join(BREADCRUMB_SEP),
      firstLine: i,
      lastLine: i,
    };
  }
  if (current.lastLine >= current.firstLine) out.push(current);
  return out;
}

function sliceLines(lines: Line[], first: number, last: number): string {
  return lines.slice(first, last + 1).map((l) => l.text).join("\n");
}

/** Merge sections under MIN tokens into the section that follows them; a trailing small one joins the previous. */
function mergeSmall(lines: Line[], secs: RawSection[], count: CountTokens): RawSection[] {
  if (secs.length <= 1) return secs;
  const out: RawSection[] = [];
  let pendingFirst: number | null = null;
  for (let i = 0; i < secs.length; i++) {
    const s = secs[i];
    const first: number = pendingFirst ?? s.firstLine;
    const isLast = i === secs.length - 1;
    const small = count(sliceLines(lines, first, s.lastLine)) < MIN_SECTION_TOKENS;
    if (small && !isLast) {
      pendingFirst = first;
      continue;
    }
    if (small && isLast && out.length > 0) {
      out[out.length - 1] = { ...out[out.length - 1], lastLine: s.lastLine };
      pendingFirst = null;
      continue;
    }
    out.push({ ...s, firstLine: first });
    pendingFirst = null;
  }
  return out;
}

type Block = { first: number; last: number };

/** Blocks a section can be cut between: paragraph, list item, whole table, whole fence. */
function blocks(lines: Line[], first: number, last: number): Block[] {
  const out: Block[] = [];
  let i = first;
  while (i <= last) {
    const start = i;
    const t = lines[i].text;
    if (FENCE.test(t)) {
      i++;
      while (i <= last && !FENCE.test(lines[i].text)) i++;
      i++; // closing fence
    } else if (TABLE.test(t)) {
      while (i <= last && TABLE.test(lines[i].text)) i++;
    } else if (LIST_ITEM.test(t)) {
      i++;
      while (i <= last && lines[i].text.trim() !== "" && !LIST_ITEM.test(lines[i].text) && /^\s/.test(lines[i].text)) i++;
    } else if (t.trim() === "") {
      i++;
    } else {
      i++;
      while (i <= last && lines[i].text.trim() !== "" && !FENCE.test(lines[i].text) && !TABLE.test(lines[i].text) && !LIST_ITEM.test(lines[i].text)) i++;
    }
    // trailing blank lines belong to the block before them
    while (i <= last && lines[i].text.trim() === "") i++;
    out.push({ first: start, last: Math.min(i - 1, last) });
  }
  return out;
}

function splitLarge(lines: Line[], s: RawSection, count: CountTokens): RawSection[] {
  if (count(sliceLines(lines, s.firstLine, s.lastLine)) <= MAX_SECTION_TOKENS) return [s];
  const parts: RawSection[] = [];
  let partFirst = s.firstLine;
  let partLast = -1;
  for (const b of blocks(lines, s.firstLine, s.lastLine)) {
    if (partLast < partFirst) {
      partLast = b.last;
      continue;
    }
    if (count(sliceLines(lines, partFirst, b.last)) > MAX_SECTION_TOKENS) {
      parts.push({ ...s, firstLine: partFirst, lastLine: partLast });
      partFirst = b.first;
    }
    partLast = b.last;
  }
  parts.push({ ...s, firstLine: partFirst, lastLine: Math.max(partLast, partFirst) });
  return parts.map((p, i) => ({ ...p, key: i === 0 ? s.key : `${s.key}~${i + 1}` }));
}

function finish(lines: Line[], secs: RawSection[]): Section[] {
  return secs.map((s, ord) => {
    const start_char = lines[s.firstLine].start;
    const end_char = lines[s.lastLine].end;
    return {
      chunk_key: s.key,
      heading_path: s.headingPath,
      ord,
      start_char,
      end_char,
      start_line: s.firstLine + 1,
      end_line: s.lastLine + 1,
      chunk_sha: sha256(sliceLines(lines, s.firstLine, s.lastLine)),
    };
  });
}

/** Split a markdown body into sections (headings #–####; deeper headings stay inside their #### parent). */
export function chunkMarkdown(body: string, countTokens: CountTokens): Section[] {
  const lines = splitLines(body);
  let secs = rawSections(lines);
  if (secs.length === 0) secs = [{ key: "0", headingPath: "", firstLine: 0, lastLine: lines.length - 1 }];
  secs = mergeSmall(lines, secs, countTokens);
  secs = secs.flatMap((s) => splitLarge(lines, s, countTokens));
  return finish(lines, secs);
}

/** Split non-markdown text into line windows cut at blank lines; keys are 0, 0~2, 0~3, … */
export function chunkLines(text: string, countTokens: CountTokens): Section[] {
  const lines = splitLines(text);
  const whole: RawSection = { key: "0", headingPath: "", firstLine: 0, lastLine: lines.length - 1 };
  if (countTokens(text) <= MAX_SECTION_TOKENS) return finish(lines, [whole]);
  const parts: RawSection[] = [];
  let first = 0;
  let lastBlank = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].text.trim() === "") lastBlank = i;
    if (i > first && countTokens(sliceLines(lines, first, i)) > MAX_SECTION_TOKENS) {
      const cut = lastBlank >= first && lastBlank < i ? lastBlank : i - 1;
      parts.push({ ...whole, firstLine: first, lastLine: cut });
      first = cut + 1;
    }
  }
  if (first <= lines.length - 1) parts.push({ ...whole, firstLine: first, lastLine: lines.length - 1 });
  return finish(lines, parts.map((p, i) => ({ ...p, key: i === 0 ? "0" : `0~${i + 1}` })));
}

/** Embedding input prefix: `<title> › H1 › … › Hn`. Never stored. */
export function breadcrumb(title: string | null | undefined, headingPath: string): string {
  return [title ?? "", headingPath].filter((s) => s.trim() !== "").join(BREADCRUMB_SEP);
}

/** The lines start..end (1-based inclusive) of a text joined with "\n" — the unit chunk_sha hashes. */
export function sliceByLines(text: string, startLine: number, endLine: number): string {
  return text.split("\n").slice(startLine - 1, endLine).join("\n");
}
