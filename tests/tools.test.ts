import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { VaultError, type VaultErrorCode } from "../src/errors";
import { Vault } from "../src/vault";
import { listNotes } from "../src/tools/list";
import { readNote } from "../src/tools/read";

const tempRoots: string[] = [];

/** 构造测试 fixture vault，目录布局固定，供断言引用。 */
function makeFixtureVault(): Vault {
  const root = mkdtempSync(path.join(tmpdir(), "obsidian-mcp-tools-"));
  tempRoots.push(root);
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

async function expectVaultError(
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

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("list_notes（F01）", () => {
  it("列出根目录：文件夹在前按名称排序，只含 .md 笔记，跳过隐藏条目与附件", async () => {
    const vault = makeFixtureVault();
    const entries = await listNotes(vault, {});
    expect(entries).toEqual([
      { path: "empty", name: "empty", type: "folder" },
      { path: "journal", name: "journal", type: "folder" },
      { path: "note.md", name: "note.md", type: "note" },
      { path: "README.MD", name: "README.MD", type: "note" },
    ]);
  });

  it("列出子目录，路径带目录前缀，文件名按数值感知排序", async () => {
    const vault = makeFixtureVault();
    const entries = await listNotes(vault, { folder: "journal" });
    expect(entries.map((entry) => entry.path)).toEqual([
      "journal/2.md",
      "journal/10.md",
      "journal/2026-09-30.md",
    ]);
  });

  it("空目录返回空列表", async () => {
    const vault = makeFixtureVault();
    expect(await listNotes(vault, { folder: "empty" })).toEqual([]);
  });

  it("folder 省略与留空等价，均列出根目录", async () => {
    const vault = makeFixtureVault();
    const omitted = await listNotes(vault, {});
    const empty = await listNotes(vault, { folder: "" });
    expect(empty).toEqual(omitted);
  });

  it("目录不存在时报 NOT_FOUND", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(
      () => listNotes(vault, { folder: "no-such-folder" }),
      "NOT_FOUND",
    );
  });

  it("目标是文件时报 NOT_A_DIRECTORY", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(
      () => listNotes(vault, { folder: "note.md" }),
      "NOT_A_DIRECTORY",
    );
  });

  it("越界目录路径被 Vault 校验拒绝（E05）", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(
      () => listNotes(vault, { folder: "../outside" }),
      "PATH_ESCAPES_VAULT",
    );
  });
});

describe("read_note（F02）", () => {
  it("返回内容与磁盘逐字一致（含 frontmatter）及大小、修改时间", async () => {
    const vault = makeFixtureVault();
    const raw = "---\ntitle: hello\n---\n\n# hi\n正文\n";
    writeFileSync(path.join(vault.root, "frontmatter.md"), raw);
    const note = await readNote(vault, { path: "frontmatter.md" });
    expect(note.path).toBe("frontmatter.md");
    expect(note.content).toBe(raw);
    expect(note.size_bytes).toBe(Buffer.byteLength(raw, "utf8"));
    expect(() => new Date(note.modified_at).toISOString()).not.toThrow();
  });

  it("子目录笔记返回归一化 POSIX 路径", async () => {
    const vault = makeFixtureVault();
    const note = await readNote(vault, { path: "journal/2026-09-30.md" });
    expect(note.path).toBe("journal/2026-09-30.md");
    expect(note.content).toBe("c");
  });

  it.runIf(process.platform === "win32")(
    "Windows 反斜杠路径可读，返回 POSIX 路径",
    async () => {
      const vault = makeFixtureVault();
      const note = await readNote(vault, { path: "journal\\2026-09-30.md" });
      expect(note.path).toBe("journal/2026-09-30.md");
    },
  );

  it("E02: 笔记不存在时报 NOT_FOUND，且不创建文件", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(
      () => readNote(vault, { path: "ghost.md" }),
      "NOT_FOUND",
    );
    expect(existsSync(path.join(vault.root, "ghost.md"))).toBe(false);
  });

  it("E06: 非 .md 目标被拒绝", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(() => readNote(vault, { path: "image.png" }), "NOT_MARKDOWN");
  });

  it("目标是以 .md 结尾的目录时报 NOT_A_FILE", async () => {
    const vault = makeFixtureVault();
    mkdirSync(path.join(vault.root, "folder.md"));
    await expectVaultError(
      () => readNote(vault, { path: "folder.md" }),
      "NOT_A_FILE",
    );
  });
});
