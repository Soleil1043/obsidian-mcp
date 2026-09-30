import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect } from "vitest";

import { VaultError, type VaultErrorCode } from "../src/errors";
import { Vault } from "../src/vault";

const tempRoots: string[] = [];

function trackTempRoot(root: string): string {
  tempRoots.push(root);
  return root;
}

/** 删除本轮测试创建的所有临时 vault（各测试文件在 afterEach 中调用）。 */
export function cleanupTempVaults(): void {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
}

/** 通用 fixture vault：note.md / README.MD / image.png / journal（3 篇）/ .obsidian / .trash / empty。 */
export function makeFixtureVault(): Vault {
  const root = trackTempRoot(mkdtempSync(path.join(tmpdir(), "obsidian-mcp-tools-")));
  writeFileSync(path.join(root, "note.md"), "# hello\n");
  writeFileSync(path.join(root, "README.MD"), "readme\n");
  writeFileSync(path.join(root, "image.png"), "binary");
  mkdirSync(path.join(root, "journal"));
  writeFileSync(path.join(root, "journal", "2.md"), "a");
  writeFileSync(path.join(root, "journal", "10.md"), "b");
  writeFileSync(path.join(root, "journal", "2026-09-30.md"), "c");
  mkdirSync(path.join(root, ".obsidian"));
  writeFileSync(path.join(root, ".obsidian", "app.json"), "{}");
  mkdirSync(path.join(root, ".trash"));
  writeFileSync(path.join(root, ".trash", "deleted.md"), "x");
  mkdirSync(path.join(root, "empty"));
  return new Vault(root);
}

/** 搜索 fixture vault：alpha.md 与 sub/beta.md 各两处 world，另有隐藏目录与附件。 */
export function makeSearchVault(): Vault {
  const root = trackTempRoot(mkdtempSync(path.join(tmpdir(), "obsidian-mcp-search-")));
  writeFileSync(path.join(root, "alpha.md"), "Hello World\nworld peace\nbye\n");
  mkdirSync(path.join(root, "sub"));
  writeFileSync(path.join(root, "sub", "beta.md"), "WORLD tour\nnothing\nhello again world\n");
  mkdirSync(path.join(root, "hidden"));
  writeFileSync(path.join(root, "hidden", ".secret.md"), "world\n");
  writeFileSync(path.join(root, "image.png"), "world");
  return new Vault(root);
}

/** 被移动笔记的内容：含自身锚点、wikilink 与两条相对 Markdown 链接。 */
export const MOVED_NOTE_CONTENT =
  "self [[#head]]\n[[a]] stays\n[rel](other.md)\n[up](../a.md)\n";

/** 链接维护 fixture：a.md 集中各类引用形态，journal/note.md 为被移动笔记，dup 双胞胎制造歧义。 */
export function makeLinksVault(): Vault {
  const root = trackTempRoot(mkdtempSync(path.join(tmpdir(), "obsidian-mcp-links-")));
  writeFileSync(
    path.join(root, "a.md"),
    "see [[note]] and [[note|alias]] plus [[note#head]] embed ![[note]]\n" +
      "path [[journal/note]] and [[journal/note.md]]\n" +
      "other [[other]] missing [[missing]] dup [[dup]]\n" +
      "```\ncode [[journal/note]]\n```\n" +
      "[t](journal/note.md)\n",
  );
  mkdirSync(path.join(root, "journal"));
  writeFileSync(path.join(root, "journal", "note.md"), MOVED_NOTE_CONTENT);
  writeFileSync(path.join(root, "journal", "other.md"), "x\n");
  writeFileSync(path.join(root, "journal", "dup.md"), "d1\n");
  writeFileSync(path.join(root, "dup.md"), "d2\n");
  return new Vault(root);
}

/** 歧义 fixture：journal/note.md 与 folder2/note.md 同名，[[note]] 无法唯一解析。 */
export function makeLinksVaultAmbiguous(): Vault {
  const root = trackTempRoot(mkdtempSync(path.join(tmpdir(), "obsidian-mcp-linksamb-")));
  writeFileSync(path.join(root, "a.md"), "see [[note]]\n");
  mkdirSync(path.join(root, "journal"));
  writeFileSync(path.join(root, "journal", "note.md"), "moved\n");
  mkdirSync(path.join(root, "folder2"));
  writeFileSync(path.join(root, "folder2", "note.md"), "x\n");
  return new Vault(root);
}

export async function expectVaultError(
  fn: () => unknown | Promise<unknown>,
  code: VaultErrorCode,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(VaultError);
    expect((error as VaultError).code).toBe(code);
    return;
  }
  expect.fail(`expected VaultError with code ${code}`);
}
