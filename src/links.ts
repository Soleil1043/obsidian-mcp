import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Vault } from "./vault.js";

/**
 * Obsidian 链接扫描与移动后的链接维护（F12）。
 * 覆盖 [[path]]、[[path|alias]]、[[path#heading]]、[[path#^block]]、![[embed]] 与
 * [text](relative.md)；fenced code block 内的链接一律不动。
 * 解析语义：wikilink 无路径段时按文件名全 vault 唯一解析，歧义不改并报告（E11）。
 */

export interface VaultNote {
  /** vault 内相对路径（POSIX） */
  rel: string;
  abs: string;
}

/** 递归收集 vault 全部 .md 笔记（跳过点开头隐藏目录；供链接维护与后续标签索引复用）。 */
export async function listVaultNotes(vault: Vault): Promise<VaultNote[]> {
  const dirents = await readdir(vault.root, { recursive: true, withFileTypes: true });
  const notes: VaultNote[] = [];
  for (const dirent of dirents) {
    if (!dirent.isFile()) continue;
    const abs = path.join(dirent.parentPath, dirent.name);
    const rel = path.relative(vault.root, abs).split(path.sep).join("/");
    const segments = rel.split("/");
    if (segments.some((segment) => segment.startsWith("."))) continue;
    if (!dirent.name.toLowerCase().endsWith(".md")) continue;
    notes.push({ rel, abs });
  }
  return notes;
}

export interface MoveLinkUpdate {
  /** 因移动而更新了链接的文件（vault 相对路径，含被移动文件自身的相对链接修正） */
  updated: string[];
  /** 无法唯一解析、保持原样的链接（E11） */
  ambiguous: Array<{ path: string; link: string }>;
}

interface MoveContext {
  oldRel: string;
  newRel: string;
  /** 移动前的全量路径与文件名计数，用于解析与唯一性判断 */
  paths: Set<string>;
  basenameCount: Map<string, number>;
}

const WIKI_LINK = /(!?)\[\[([^\][\n]+?)\]\]/g;
const MD_LINK = /\[([^\]\n]*)\]\(([^()\n]+)\)/g;

/**
 * 移动笔记后更新引用。必须在 rename 之前调用 listVaultNotes 拿到移动前的全量笔记列表，
 * rename 之后再调用本函数（被移动文件按新路径读写）。
 */
export async function updateLinksAfterMove(
  vault: Vault,
  notes: VaultNote[],
  oldRel: string,
  newRel: string,
): Promise<MoveLinkUpdate> {
  const context: MoveContext = {
    oldRel,
    newRel,
    paths: new Set(notes.map((note) => note.rel)),
    basenameCount: new Map<string, number>(),
  };
  for (const note of notes) {
    const base = basename(note.rel);
    context.basenameCount.set(base, (context.basenameCount.get(base) ?? 0) + 1);
  }

  const updated: string[] = [];
  const ambiguous: Array<{ path: string; link: string }> = [];

  for (const note of notes) {
    if (note.rel === oldRel) continue;
    const content = await readFile(note.abs, "utf8");
    const result = rewriteLinks(content, note.rel, context, "backlink");
    if (result.changed) {
      await writeFile(note.abs, result.content, "utf8");
      updated.push(note.rel);
    }
    ambiguous.push(...result.ambiguous);
  }

  const movedAbs = path.join(vault.root, newRel);
  const movedContent = await readFile(movedAbs, "utf8");
  const movedResult = rewriteLinks(movedContent, newRel, context, "moved");
  if (movedResult.changed) {
    await writeFile(movedAbs, movedResult.content, "utf8");
    updated.push(newRel);
  }
  ambiguous.push(...movedResult.ambiguous);

  return { updated: updated.sort(), ambiguous };
}

function rewriteLinks(
  content: string,
  containerRel: string,
  context: MoveContext,
  mode: "backlink" | "moved",
): { content: string; changed: boolean; ambiguous: Array<{ path: string; link: string }> } {
  const ambiguous: Array<{ path: string; link: string }> = [];
  const rewritten = splitCodeFences(content)
    .map(({ text, code }) => {
      if (code) return text;
      const afterWiki = text.replace(WIKI_LINK, (raw, bang: string, inner: string) => {
        const pipe = inner.indexOf("|");
        const refPart = pipe === -1 ? inner : inner.slice(0, pipe);
        const aliasPart = pipe === -1 ? "" : inner.slice(pipe);
        // 先拆出 #heading / #^block 锚点，解析只针对路径部分，重建时原样拼回
        const hashIdx = refPart.search(/[#^]/);
        const refTarget = hashIdx === -1 ? refPart : refPart.slice(0, hashIdx);
        const hashPart = hashIdx === -1 ? "" : refPart.slice(hashIdx);
        const resolution = resolveWikiRef(refTarget, context);

        if (resolution.kind === "ambiguous") {
          if (resolution.candidates.includes(context.oldRel)) {
            ambiguous.push({ path: containerRel, link: raw });
          }
          return raw;
        }
        if (mode === "moved") return raw; // wikilink 是 vault 绝对语义，不随容器目录变化
        if (resolution.kind !== "resolved" || resolution.path !== context.oldRel) return raw;

        const hadExt = /\.md$/i.test(refTarget);
        let newRef: string;
        if (refTarget.includes("/")) {
          newRef = hadExt ? context.newRel : stripExt(context.newRel);
        } else {
          if (basename(context.oldRel) === basename(context.newRel)) return raw; // 纯移动，裸链接仍唯一可解析
          const newBase = basename(context.newRel);
          const taken = context.basenameCount.get(newBase) ?? 0;
          const target = taken === 0 ? newBase : context.newRel;
          newRef = hadExt ? target : stripExt(target);
        }
        return `${bang}[[${newRef}${hashPart}${aliasPart}]]`;
      });

      const afterMd = afterWiki.replace(MD_LINK, (raw, _text: string, rawTarget: string) => {
        const newTarget =
          mode === "backlink"
            ? rewriteMdBacklinkTarget(rawTarget, dirname(containerRel), context)
            : rewriteMdMovedTarget(rawTarget, dirname(context.oldRel), context);
        if (newTarget === null) return raw;
        return raw.slice(0, raw.indexOf("](") + 2) + newTarget + ")";
      });
      return afterMd;
    })
    .join("");

  return { content: rewritten, changed: rewritten !== content, ambiguous };
}

/** 反向链接（其他文件指向被移动笔记）：仅当解析结果恰为旧路径时改写为新路径的相对形式。 */
function rewriteMdBacklinkTarget(
  rawTarget: string,
  containerDir: string,
  context: MoveContext,
): string | null {
  const parsed = parseMarkdownTarget(rawTarget);
  if (!parsed) return null;
  const resolved = resolveSegments(containerDir, parsed.decoded);
  if (!resolved || resolved !== context.oldRel) return null;
  const newTarget = relativePosix(containerDir, context.newRel);
  return newTarget === parsed.decoded ? null : emitTarget(newTarget, parsed);
}

/** 被移动文件自身的相对链接：按旧目录解析，重写为从新目录出发的相对形式。 */
function rewriteMdMovedTarget(
  rawTarget: string,
  oldContainerDir: string,
  context: MoveContext,
): string | null {
  const parsed = parseMarkdownTarget(rawTarget);
  if (!parsed) return null;
  const resolved = resolveSegments(oldContainerDir, parsed.decoded);
  if (!resolved || !context.paths.has(resolved) || resolved === context.oldRel) return null;
  const newTarget = relativePosix(dirname(context.newRel), resolved);
  return newTarget === parsed.decoded ? null : emitTarget(newTarget, parsed);
}

interface ParsedTarget {
  decoded: string;
  wrapped: boolean;
  hash: string;
}

function parseMarkdownTarget(rawTarget: string): ParsedTarget | null {
  let tp = rawTarget;
  let hash = "";
  const hashIdx = tp.indexOf("#");
  if (hashIdx !== -1) {
    hash = tp.slice(hashIdx);
    tp = tp.slice(0, hashIdx);
  }
  const wrapped = tp.startsWith("<") && tp.endsWith(">");
  if (wrapped) tp = tp.slice(1, -1);
  let decoded = tp;
  try {
    decoded = decodeURIComponent(tp);
  } catch {
    // 保留原始形式（非法百分号编码）
  }
  if (
    decoded === "" ||
    decoded.startsWith("/") ||
    /^[a-zA-Z]:/.test(decoded) ||
    decoded.includes("\\")
  ) {
    return null;
  }
  return { decoded, wrapped, hash };
}

function emitTarget(newTarget: string, parsed: ParsedTarget): string {
  if (parsed.wrapped) return `<${newTarget}>${parsed.hash}`;
  if (/\s/.test(newTarget)) return `${encodeURI(newTarget)}${parsed.hash}`;
  return `${newTarget}${parsed.hash}`;
}

type WikiResolution =
  | { kind: "same-file" }
  | { kind: "resolved"; path: string }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "unresolved" };

function resolveWikiRef(ref: string, context: MoveContext): WikiResolution {
  const trimmed = ref.trim();
  const hashIdx = trimmed.search(/[#^]/);
  const target = hashIdx === -1 ? trimmed : trimmed.slice(0, hashIdx);
  if (target === "") return { kind: "same-file" };
  if (target.includes("/")) {
    const withExt = target.toLowerCase().endsWith(".md") ? target : `${target}.md`;
    if (context.paths.has(target)) return { kind: "resolved", path: target };
    if (context.paths.has(withExt)) return { kind: "resolved", path: withExt };
    return { kind: "unresolved" };
  }
  const name = target.toLowerCase().endsWith(".md") ? target : `${target}.md`;
  const candidates = [...context.paths].filter((p) => basename(p) === name);
  if (candidates.length === 1) return { kind: "resolved", path: candidates[0] };
  if (candidates.length > 1) return { kind: "ambiguous", candidates };
  return { kind: "unresolved" };
}

/** 将内容切分为代码栅栏内/外的片段，正则处理只作用于非代码片段。 */
function splitCodeFences(content: string): Array<{ text: string; code: boolean }> {
  const lines = content.split(/(?<=\n)/);
  const segments: Array<{ text: string; code: boolean }> = [];
  let inFence = false;
  let bufCode = false;
  let buf = "";
  for (const line of lines) {
    const isFenceLine = /^\s*(```|~~~)/.test(line);
    const lineCode = inFence || isFenceLine;
    if (lineCode !== bufCode) {
      if (buf) segments.push({ text: buf, code: bufCode });
      buf = "";
      bufCode = lineCode;
    }
    buf += line;
    if (isFenceLine) inFence = !inFence;
  }
  if (buf) segments.push({ text: buf, code: bufCode });
  return segments;
}

function resolveSegments(baseDir: string, target: string): string | null {
  const stack = baseDir ? baseDir.split("/") : [];
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return null; // 越出 vault 根
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack.length ? stack.join("/") : null;
}

function relativePosix(fromDir: string, toPath: string): string {
  const from = fromDir ? fromDir.split("/") : [];
  const to = toPath.split("/");
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) {
    common += 1;
  }
  const ups = from.length - common;
  const rest = to.slice(common).join("/");
  return ups ? `${Array(ups).fill("..").join("/")}/${rest}` : rest;
}

function basename(rel: string): string {
  return rel.slice(rel.lastIndexOf("/") + 1);
}

function dirname(rel: string): string {
  const idx = rel.lastIndexOf("/");
  return idx === -1 ? "" : rel.slice(0, idx);
}

function stripExt(name: string): string {
  return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}
