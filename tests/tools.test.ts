import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { VaultError, type VaultErrorCode } from "../src/errors";
import { Vault } from "../src/vault";
import { createNote } from "../src/tools/create";
import { editNote } from "../src/tools/edit";
import { listNotes } from "../src/tools/list";
import { readNote } from "../src/tools/read";
import { searchNotes } from "../src/tools/search";

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

/** 搜索专用 fixture：alpha.md 两处 world（一行大小写混合），sub/beta.md 两处全大写/小写。 */
function makeSearchVault(): Vault {
  const root = mkdtempSync(path.join(tmpdir(), "obsidian-mcp-search-"));
  tempRoots.push(root);
  writeFileSync(path.join(root, "alpha.md"), "Hello World\nworld peace\nbye\n");
  mkdirSync(path.join(root, "sub"));
  writeFileSync(path.join(root, "sub", "beta.md"), "WORLD tour\nnothing\nhello again world\n");
  mkdirSync(path.join(root, "hidden"));
  writeFileSync(path.join(root, "hidden", ".secret.md"), "world\n");
  writeFileSync(path.join(root, "image.png"), "world");
  return new Vault(root);
}

describe("search_notes（F03）", () => {
  it("默认大小写不敏感，按文件分组返回行命中与文件总次数，跳过隐藏目录与附件", async () => {
    const vault = makeSearchVault();
    const hits = await searchNotes(vault, { query: "world", max_results: 1000 });
    expect(hits).toEqual([
      { path: "alpha.md", line_number: 1, line_text: "Hello World", match_count: 2 },
      { path: "alpha.md", line_number: 2, line_text: "world peace", match_count: 2 },
      { path: "sub/beta.md", line_number: 1, line_text: "WORLD tour", match_count: 2 },
      { path: "sub/beta.md", line_number: 3, line_text: "hello again world", match_count: 2 },
    ]);
  });

  it("case_sensitive=true 只匹配精确大小写", async () => {
    const vault = makeSearchVault();
    const hits = await searchNotes(vault, {
      query: "world",
      case_sensitive: true,
      max_results: 1000,
    });
    expect(hits.map((hit) => `${hit.path}:${hit.line_number}`)).toEqual([
      "alpha.md:2",
      "sub/beta.md:3",
    ]);
  });

  it("folder 限定只搜索该子目录", async () => {
    const vault = makeSearchVault();
    const hits = await searchNotes(vault, { query: "world", folder: "sub", max_results: 1000 });
    expect(hits.map((hit) => hit.path)).toEqual(["sub/beta.md", "sub/beta.md"]);
  });

  it("E09: 无匹配返回空列表", async () => {
    const vault = makeSearchVault();
    expect(await searchNotes(vault, { query: "zebra" })).toEqual([]);
  });

  it("max_results 截断命中行数", async () => {
    const vault = makeSearchVault();
    const hits = await searchNotes(vault, { query: "world", max_results: 2 });
    expect(hits).toHaveLength(2);
    expect(hits.every((hit) => hit.path === "alpha.md")).toBe(true);
  });

  it("空关键词与非法 max_results 报 INVALID_INPUT", async () => {
    const vault = makeSearchVault();
    await expectVaultError(() => searchNotes(vault, { query: "" }), "INVALID_INPUT");
    await expectVaultError(
      () => searchNotes(vault, { query: "world", max_results: 0 }),
      "INVALID_INPUT",
    );
  });

  it("目录不存在或目标是文件时报对应错误", async () => {
    const vault = makeSearchVault();
    await expectVaultError(
      () => searchNotes(vault, { query: "world", folder: "no-such" }),
      "NOT_FOUND",
    );
    await expectVaultError(
      () => searchNotes(vault, { query: "world", folder: "alpha.md" }),
      "NOT_A_DIRECTORY",
    );
  });
});

describe("create_note（F04）", () => {
  it("创建新笔记成功，多级父目录自动创建，内容落盘一致", async () => {
    const vault = makeFixtureVault();
    const result = await createNote(vault, {
      path: "notes/2026/deep/new.md",
      content: "# Title\nbody\n",
    });
    expect(result).toEqual({
      path: "notes/2026/deep/new.md",
      size_bytes: Buffer.byteLength("# Title\nbody\n", "utf8"),
    });
    expect(readFileSync(path.join(vault.root, "notes", "2026", "deep", "new.md"), "utf8")).toBe(
      "# Title\nbody\n",
    );
  });

  it("省略 content 时创建空笔记", async () => {
    const vault = makeFixtureVault();
    const result = await createNote(vault, { path: "empty.md" });
    expect(result.size_bytes).toBe(0);
    expect(readFileSync(path.join(vault.root, "empty.md"), "utf8")).toBe("");
  });

  it("E03: 目标已存在且未显式 overwrite 时报错，原文件不变", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(
      () => createNote(vault, { path: "note.md", content: "clobber" }),
      "ALREADY_EXISTS",
    );
    expect(readFileSync(path.join(vault.root, "note.md"), "utf8")).toBe("# hello\n");
  });

  it("overwrite=true 时覆盖成功", async () => {
    const vault = makeFixtureVault();
    const result = await createNote(vault, {
      path: "note.md",
      content: "replaced",
      overwrite: true,
    });
    expect(result.size_bytes).toBe(8);
    expect(readFileSync(path.join(vault.root, "note.md"), "utf8")).toBe("replaced");
  });

  it("E05/E06: 越界与非 .md 路径被拒绝", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(
      () => createNote(vault, { path: "../outside.md" }),
      "PATH_ESCAPES_VAULT",
    );
    await expectVaultError(() => createNote(vault, { path: "file.txt" }), "NOT_MARKDOWN");
  });

  it.runIf(process.platform === "win32")(
    "Windows 反斜杠路径可创建，返回 POSIX 路径",
    async () => {
      const vault = makeFixtureVault();
      const result = await createNote(vault, { path: "sub\\new.md" });
      expect(result.path).toBe("sub/new.md");
      expect(existsSync(path.join(vault.root, "sub", "new.md"))).toBe(true);
    },
  );
});

describe("edit_note（F05）", () => {
  it("overwrite 模式整体覆盖", async () => {
    const vault = makeFixtureVault();
    const result = await editNote(vault, {
      path: "note.md",
      mode: "overwrite",
      content: "new body",
    });
    expect(result.mode).toBe("overwrite");
    expect(readFileSync(path.join(vault.root, "note.md"), "utf8")).toBe("new body");
  });

  it("append 模式在文末追加", async () => {
    const vault = makeFixtureVault();
    await editNote(vault, { path: "note.md", mode: "append", content: "more\n" });
    expect(readFileSync(path.join(vault.root, "note.md"), "utf8")).toBe("# hello\nmore\n");
  });

  it("replace 模式单处字面替换", async () => {
    const vault = makeFixtureVault();
    await editNote(vault, {
      path: "note.md",
      mode: "replace",
      old_string: "hello",
      content: "world",
    });
    expect(readFileSync(path.join(vault.root, "note.md"), "utf8")).toBe("# world\n");
  });

  it("replace 替换文本含 $ 符号时按字面处理", async () => {
    const vault = makeFixtureVault();
    await editNote(vault, {
      path: "note.md",
      mode: "replace",
      old_string: "hello",
      content: "$& and $1",
    });
    expect(readFileSync(path.join(vault.root, "note.md"), "utf8")).toBe("# $& and $1\n");
  });

  it("E04: replace 未找到时报错且文件不变", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(
      () => editNote(vault, {
        path: "note.md",
        mode: "replace",
        old_string: "ghost",
        content: "x",
      }),
      "REPLACE_NOT_FOUND",
    );
    expect(readFileSync(path.join(vault.root, "note.md"), "utf8")).toBe("# hello\n");
  });

  it("E04: replace 多处匹配时报错且文件不变，replace_all=true 全部替换", async () => {
    const vault = makeFixtureVault();
    writeFileSync(path.join(vault.root, "dup.md"), "aXbXc");
    await expectVaultError(
      () => editNote(vault, {
        path: "dup.md",
        mode: "replace",
        old_string: "X",
        content: "-",
      }),
      "REPLACE_AMBIGUOUS",
    );
    expect(readFileSync(path.join(vault.root, "dup.md"), "utf8")).toBe("aXbXc");
    await editNote(vault, {
      path: "dup.md",
      mode: "replace",
      old_string: "X",
      content: "-",
      replace_all: true,
    });
    expect(readFileSync(path.join(vault.root, "dup.md"), "utf8")).toBe("a-b-c");
  });

  it("replace 用空串删除片段", async () => {
    const vault = makeFixtureVault();
    await editNote(vault, {
      path: "note.md",
      mode: "replace",
      old_string: "hello",
      content: "",
    });
    expect(readFileSync(path.join(vault.root, "note.md"), "utf8")).toBe("# \n");
  });

  it("replace 缺少或空 old_string 报 INVALID_INPUT", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(
      () => editNote(vault, { path: "note.md", mode: "replace", content: "x" }),
      "INVALID_INPUT",
    );
    await expectVaultError(
      () => editNote(vault, { path: "note.md", mode: "replace", old_string: "", content: "x" }),
      "INVALID_INPUT",
    );
  });

  it("E02: 编辑不存在的笔记报 NOT_FOUND 且不创建文件", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(
      () => editNote(vault, { path: "ghost.md", mode: "overwrite", content: "x" }),
      "NOT_FOUND",
    );
    expect(existsSync(path.join(vault.root, "ghost.md"))).toBe(false);
  });
});
