import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { Vault } from "../src/vault";
import { createNote } from "../src/tools/create";
import { editNote } from "../src/tools/edit";
import { listNotes } from "../src/tools/list";
import { moveNote, deleteNote } from "../src/tools/organize";
import { readNote } from "../src/tools/read";
import { searchNotes } from "../src/tools/search";
import {
  cleanupTempVaults,
  expectVaultError,
  makeFixtureVault,
  makeSearchVault,
} from "./helpers";

afterEach(() => {
  cleanupTempVaults();
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

describe("move_note（F06）", () => {
  it("同目录重命名：旧路径不存在，新路径内容一致", async () => {
    const vault = makeFixtureVault();
    const result = await moveNote(vault, { from: "note.md", to: "renamed.md" });
    expect(result).toEqual({ from: "note.md", to: "renamed.md" });
    expect(existsSync(path.join(vault.root, "note.md"))).toBe(false);
    expect(readFileSync(path.join(vault.root, "renamed.md"), "utf8")).toBe("# hello\n");
  });

  it("跨目录移动：目标父目录自动创建", async () => {
    const vault = makeFixtureVault();
    await moveNote(vault, { from: "note.md", to: "archive/2026/note.md" });
    expect(existsSync(path.join(vault.root, "note.md"))).toBe(false);
    expect(readFileSync(path.join(vault.root, "archive", "2026", "note.md"), "utf8")).toBe(
      "# hello\n",
    );
  });

  it("E08: 目标已存在时报错，源文件保持原位", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(
      () => moveNote(vault, { from: "note.md", to: "README.MD" }),
      "ALREADY_EXISTS",
    );
    expect(readFileSync(path.join(vault.root, "note.md"), "utf8")).toBe("# hello\n");
    expect(readFileSync(path.join(vault.root, "README.MD"), "utf8")).toBe("readme\n");
  });

  it("源不存在、源是目录、源等于目标时报对应错误", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(
      () => moveNote(vault, { from: "ghost.md", to: "x.md" }),
      "NOT_FOUND",
    );
    mkdirSync(path.join(vault.root, "folder.md"));
    await expectVaultError(
      () => moveNote(vault, { from: "folder.md", to: "x.md" }),
      "NOT_A_FILE",
    );
    await expectVaultError(
      () => moveNote(vault, { from: "note.md", to: "note.md" }),
      "INVALID_INPUT",
    );
  });

  it("E05/E06: 目标越界或非 .md 被拒绝，源文件不受影响", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(
      () => moveNote(vault, { from: "note.md", to: "../outside.md" }),
      "PATH_ESCAPES_VAULT",
    );
    await expectVaultError(
      () => moveNote(vault, { from: "note.md", to: "file.txt" }),
      "NOT_MARKDOWN",
    );
    expect(readFileSync(path.join(vault.root, "note.md"), "utf8")).toBe("# hello\n");
  });
});

describe("delete_note（F06/E07）", () => {
  it("默认移入 vault 根 .trash/，原路径消失，内容保留", async () => {
    const vault = makeFixtureVault();
    const result = await deleteNote(vault, { path: "journal/2026-09-30.md" });
    expect(result).toEqual({
      path: "journal/2026-09-30.md",
      permanent: false,
      trash_path: ".trash/2026-09-30.md",
    });
    expect(existsSync(path.join(vault.root, "journal", "2026-09-30.md"))).toBe(false);
    expect(readFileSync(path.join(vault.root, ".trash", "2026-09-30.md"), "utf8")).toBe("c");
  });

  it("trash 内同名冲突时自动加时间戳后缀，且不覆盖已有文件", async () => {
    const vault = makeFixtureVault();
    writeFileSync(path.join(vault.root, ".trash", "2026-09-30.md"), "previous");
    const result = await deleteNote(vault, { path: "journal/2026-09-30.md" });
    expect(result.trash_path).toMatch(/^\.trash\/2026-09-30\.\d{8}T\d{9}\.md$/);
    expect(readFileSync(path.join(vault.root, ".trash", "2026-09-30.md"), "utf8")).toBe(
      "previous",
    );
    const trashed = readdirSync(path.join(vault.root, ".trash")).find((name) =>
      /^2026-09-30\.\d{8}T\d{9}\.md$/.test(name),
    );
    expect(trashed).toBeDefined();
    expect(readFileSync(path.join(vault.root, ".trash", trashed!), "utf8")).toBe("c");
  });

  it("permanent=true 永久删除", async () => {
    const vault = makeFixtureVault();
    const result = await deleteNote(vault, { path: "note.md", permanent: true });
    expect(result).toEqual({ path: "note.md", permanent: true });
    expect(existsSync(path.join(vault.root, "note.md"))).toBe(false);
    expect(existsSync(path.join(vault.root, ".trash", "note.md"))).toBe(false);
  });

  it(".trash 内的文件默认删除时报 INVALID_INPUT，提示用 permanent", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(
      () => deleteNote(vault, { path: ".trash/deleted.md" }),
      "INVALID_INPUT",
    );
    await deleteNote(vault, { path: ".trash/deleted.md", permanent: true });
    expect(existsSync(path.join(vault.root, ".trash", "deleted.md"))).toBe(false);
  });

  it("E02: 删除不存在的笔记报 NOT_FOUND", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(() => deleteNote(vault, { path: "ghost.md" }), "NOT_FOUND");
  });

  it("E05/E06: 越界与非 .md 被拒绝", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(
      () => deleteNote(vault, { path: "../outside.md" }),
      "PATH_ESCAPES_VAULT",
    );
    await expectVaultError(() => deleteNote(vault, { path: "image.png" }), "NOT_MARKDOWN");
  });
});
