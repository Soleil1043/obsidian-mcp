import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { Vault } from "../src/vault";
import { createNote } from "../src/tools/create";
import { editNote } from "../src/tools/edit";
import { manageFrontmatter } from "../src/tools/frontmatter";
import { listNotes } from "../src/tools/list";
import { manageTags } from "../src/tools/tags";
import { moveNote, deleteNote } from "../src/tools/organize";
import { readNote } from "../src/tools/read";
import { searchNotes } from "../src/tools/search";
import {
  cleanupTempVaults,
  expectVaultError,
  makeFixtureVault,
  makeSearchVault,
} from "./helpers";
import { computeEtag } from "../src/etag";

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
      etag: computeEtag("# Title\nbody\n"),
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
    expect(result).toEqual({
      from: "note.md",
      to: "renamed.md",
      etag: computeEtag("# hello\n"),
      updated: [],
      ambiguous: [],
    });
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

describe("etag 并发控制（F11/E10）", () => {
  it("read_note 返回 64 位 hex etag，内容变化后 etag 随之变化", async () => {
    const vault = makeFixtureVault();
    const first = await readNote(vault, { path: "note.md" });
    expect(first.etag).toMatch(/^[0-9a-f]{64}$/);
    expect(first.etag).toBe(computeEtag("# hello\n"));
    await editNote(vault, { path: "note.md", mode: "append", content: "x" });
    const second = await readNote(vault, { path: "note.md" });
    expect(second.etag).not.toBe(first.etag);
  });

  it("edit_note 传入正确 if_match 成功，返回新内容 etag", async () => {
    const vault = makeFixtureVault();
    const read = await readNote(vault, { path: "note.md" });
    const result = await editNote(vault, {
      path: "note.md",
      mode: "append",
      content: "more\n",
      if_match: read.etag,
    });
    expect(result.etag).toBe(computeEtag("# hello\nmore\n"));
    expect(readFileSync(path.join(vault.root, "note.md"), "utf8")).toBe("# hello\nmore\n");
  });

  it("E10: edit_note 传入过期 if_match 时报 ETAG_MISMATCH 且文件不变", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(
      () =>
        editNote(vault, {
          path: "note.md",
          mode: "overwrite",
          content: "clobber",
          if_match: computeEtag("stale content"),
        }),
      "ETAG_MISMATCH",
    );
    expect(readFileSync(path.join(vault.root, "note.md"), "utf8")).toBe("# hello\n");
  });

  it("E10: create(overwrite) 过期 if_match 拒绝覆盖，正确 if_match 成功", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(
      () =>
        createNote(vault, {
          path: "note.md",
          content: "clobber",
          overwrite: true,
          if_match: computeEtag("stale"),
        }),
      "ETAG_MISMATCH",
    );
    expect(readFileSync(path.join(vault.root, "note.md"), "utf8")).toBe("# hello\n");

    const read = await readNote(vault, { path: "note.md" });
    await createNote(vault, {
      path: "note.md",
      content: "replaced",
      overwrite: true,
      if_match: read.etag,
    });
    expect(readFileSync(path.join(vault.root, "note.md"), "utf8")).toBe("replaced");
  });

  it("E10: create(overwrite) 目标已消失时报 ETAG_MISMATCH", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(
      () =>
        createNote(vault, {
          path: "ghost.md",
          content: "x",
          overwrite: true,
          if_match: computeEtag("whatever"),
        }),
      "ETAG_MISMATCH",
    );
    expect(existsSync(path.join(vault.root, "ghost.md"))).toBe(false);
  });

  it("E10: move_note 过期 if_match 拒绝移动且源不动，正确 if_match 成功", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(
      () =>
        moveNote(vault, { from: "note.md", to: "moved.md", if_match: computeEtag("stale") }),
      "ETAG_MISMATCH",
    );
    expect(existsSync(path.join(vault.root, "note.md"))).toBe(true);

    const read = await readNote(vault, { path: "note.md" });
    const result = await moveNote(vault, {
      from: "note.md",
      to: "moved.md",
      if_match: read.etag,
    });
    expect(result.etag).toBe(read.etag);
    expect(existsSync(path.join(vault.root, "note.md"))).toBe(false);
    expect(existsSync(path.join(vault.root, "moved.md"))).toBe(true);
  });

  it("E10: delete_note 过期 if_match 拒绝删除，正确 if_match 删除成功", async () => {
    const vault = makeFixtureVault();
    await expectVaultError(
      () => deleteNote(vault, { path: "note.md", if_match: computeEtag("stale") }),
      "ETAG_MISMATCH",
    );
    expect(existsSync(path.join(vault.root, "note.md"))).toBe(true);

    const read = await readNote(vault, { path: "note.md" });
    await deleteNote(vault, { path: "note.md", if_match: read.etag });
    expect(existsSync(path.join(vault.root, "note.md"))).toBe(false);
  });
});

describe("manage_frontmatter（F07/E12）", () => {
  const FM_NOTE = "---\ntitle: Hello\nstatus: active\ncount: 3\ntags:\n  - a\n  - b\n---\n\n# 正文\n\n内容\n";

  function writeFrontmatterNote(vault: Vault, raw: string): void {
    writeFileSync(path.join(vault.root, "fm.md"), raw);
  }

  it("get：无 frontmatter 返回 null，有则返回完整对象", async () => {
    const vault = makeFixtureVault();
    expect(await manageFrontmatter(vault, { action: "get", path: "note.md" })).toEqual({
      path: "note.md",
      frontmatter: null,
    });

    writeFrontmatterNote(vault, FM_NOTE);
    const result = await manageFrontmatter(vault, { action: "get", path: "fm.md" });
    expect(result).toEqual({
      path: "fm.md",
      frontmatter: { title: "Hello", status: "active", count: 3, tags: ["a", "b"] },
    });
  });

  it("get 指定 key：命中返回 found+value，未命中 found=false", async () => {
    const vault = makeFixtureVault();
    writeFrontmatterNote(vault, FM_NOTE);
    expect(
      await manageFrontmatter(vault, { action: "get", path: "fm.md", key: "title" }),
    ).toEqual({ path: "fm.md", frontmatter: expect.anything(), found: true, value: "Hello" });
    expect(
      await manageFrontmatter(vault, { action: "get", path: "fm.md", key: "ghost" }),
    ).toEqual({ path: "fm.md", frontmatter: expect.anything(), found: false, value: null });
  });

  it("set：写入新字段落盘正确，正文逐字节不变", async () => {
    const vault = makeFixtureVault();
    writeFrontmatterNote(vault, FM_NOTE);
    const result = await manageFrontmatter(vault, {
      action: "set",
      path: "fm.md",
      key: "priority",
      value: 5,
    });
    expect(result.frontmatter).toMatchObject({ title: "Hello", priority: 5 });

    const onDisk = readFileSync(path.join(vault.root, "fm.md"), "utf8");
    expect(onDisk.endsWith(FM_NOTE.slice(FM_NOTE.indexOf("---\n\n# 正文")))).toBe(true);
    expect(onDisk).toContain("priority: 5");
  });

  it("set：无 frontmatter 时自动创建，嵌套对象值正确序列化", async () => {
    const vault = makeFixtureVault();
    const result = await manageFrontmatter(vault, {
      action: "set",
      path: "note.md",
      key: "meta",
      value: { author: "me", roles: ["a", "b"] },
    });
    expect(result.frontmatter).toEqual({ meta: { author: "me", roles: ["a", "b"] } });
    const onDisk = readFileSync(path.join(vault.root, "note.md"), "utf8");
    expect(onDisk).toContain("meta:");
    expect(onDisk).toContain("author: me");
    expect(onDisk.endsWith("# hello\n")).toBe(true);
  });

  it("E12: YAML 损坏时 get/set/delete 均报错且文件不变", async () => {
    const vault = makeFixtureVault();
    const broken = "---\ntitle: [unclosed\n---\nbody\n";
    writeFrontmatterNote(vault, broken);
    for (const action of ["get", "set", "delete"] as const) {
      await expectVaultError(
        () => manageFrontmatter(vault, { action, path: "fm.md", key: "title", value: "x" }),
        "FRONTMATTER_INVALID",
      );
    }
    expect(readFileSync(path.join(vault.root, "fm.md"), "utf8")).toBe(broken);
  });

  it("delete：移除字段；删到空时整块 frontmatter 移除", async () => {
    const vault = makeFixtureVault();
    writeFrontmatterNote(vault, FM_NOTE);
    await manageFrontmatter(vault, { action: "delete", path: "fm.md", key: "count" });
    const partial = readFileSync(path.join(vault.root, "fm.md"), "utf8");
    expect(partial).not.toContain("count");
    expect(partial).toContain("title: Hello");

    const onlyTitle = "---\ntitle: solo\n---\nbody here\n";
    writeFrontmatterNote(vault, onlyTitle);
    const result = await manageFrontmatter(vault, { action: "delete", path: "fm.md", key: "title" });
    expect(result.frontmatter).toBeNull();
    expect(readFileSync(path.join(vault.root, "fm.md"), "utf8")).toBe("body here\n");
  });

  it("delete 不存在的 key 报 KEY_NOT_FOUND", async () => {
    const vault = makeFixtureVault();
    writeFrontmatterNote(vault, FM_NOTE);
    await expectVaultError(
      () => manageFrontmatter(vault, { action: "delete", path: "fm.md", key: "ghost" }),
      "KEY_NOT_FOUND",
    );
  });

  it("E10: set/delete 过期 if_match 报 ETAG_MISMATCH 且文件不变，set 返回新 etag", async () => {
    const vault = makeFixtureVault();
    writeFrontmatterNote(vault, FM_NOTE);
    await expectVaultError(
      () =>
        manageFrontmatter(vault, {
          action: "set",
          path: "fm.md",
          key: "title",
          value: "x",
          if_match: computeEtag("stale"),
        }),
      "ETAG_MISMATCH",
    );
    expect(readFileSync(path.join(vault.root, "fm.md"), "utf8")).toBe(FM_NOTE);

    const read = await readNote(vault, { path: "fm.md" });
    const result = await manageFrontmatter(vault, {
      action: "set",
      path: "fm.md",
      key: "title",
      value: "Changed",
      if_match: read.etag,
    });
    expect(result.etag).toBeDefined();
    expect(readFileSync(path.join(vault.root, "fm.md"), "utf8")).toContain("title: Changed");
  });

  it("set 缺 value、delete 缺 key 报 INVALID_INPUT", async () => {
    const vault = makeFixtureVault();
    writeFrontmatterNote(vault, FM_NOTE);
    await expectVaultError(
      () => manageFrontmatter(vault, { action: "set", path: "fm.md", key: "k" }),
      "INVALID_INPUT",
    );
    await expectVaultError(
      () => manageFrontmatter(vault, { action: "delete", path: "fm.md" }),
      "INVALID_INPUT",
    );
  });
});

describe("manage_tags（F08）", () => {
  /** 标签 fixture：fm.md 覆盖 frontmatter+行内双来源与去重，inline.md 只有行内标签，code.md 有代码块。 */
  function makeTagsVault(): Vault {
    const vault = makeFixtureVault();
    writeFileSync(
      path.join(vault.root, "fm.md"),
      "---\ntags: [work, project/x]\n---\n\n记录 #daily 与重复的 #work\n",
    );
    writeFileSync(path.join(vault.root, "inline.md"), "今天 #daily 打卡\n嵌套 #area/deep\n");
    writeFileSync(path.join(vault.root, "code.md"), "```\n#fake 标签\n```\n正文 #real\n");
    return vault;
  }

  it("list：统计两种来源并按笔记去重，计数降序、同名按字典序", async () => {
    const vault = makeTagsVault();
    const result = await manageTags(vault, { action: "list" });
    expect(result).toEqual({
      scanned: 8, // fixture vault 全部 8 篇 .md（含无标签的）
      tags: [
        { tag: "daily", note_count: 2 },
        { tag: "area/deep", note_count: 1 },
        { tag: "project/x", note_count: 1 },
        { tag: "real", note_count: 1 },
        { tag: "work", note_count: 1 },
      ],
    });
  });

  it("list：folder 限定统计范围", async () => {
    const vault = makeTagsVault();
    const result = await manageTags(vault, { action: "list", folder: "journal" });
    expect(result).toEqual({ scanned: 3, tags: [] }); // journal 下 3 篇 .md，均无标签
  });

  it("add：写入 frontmatter tags，行内已存在的报告 already_present 不重复写", async () => {
    const vault = makeTagsVault();
    const result = await manageTags(vault, {
      action: "add",
      path: "fm.md",
      tags: ["urgent", "work"],
    });
    expect(result.added).toEqual(["urgent"]);
    expect(result.already_present).toEqual(["work"]);
    const onDisk = readFileSync(path.join(vault.root, "fm.md"), "utf8");
    expect(onDisk).toContain("urgent");
    expect(onDisk).toContain("project/x"); // 既有标签保留
    expect(onDisk.endsWith("记录 #daily 与重复的 #work\n")).toBe(true);
  });

  it("add：无 frontmatter 的笔记自动创建 tags 字段", async () => {
    const vault = makeTagsVault();
    const result = await manageTags(vault, { action: "add", path: "inline.md", tags: "inbox" });
    expect(result.added).toEqual(["inbox"]);
    const onDisk = readFileSync(path.join(vault.root, "inline.md"), "utf8");
    expect(onDisk).toContain("tags:");
    expect(onDisk).toContain("今天 #daily 打卡");
  });

  it("add：带 # 前缀自动去除，非法标签报 INVALID_INPUT", async () => {
    const vault = makeTagsVault();
    const result = await manageTags(vault, { action: "add", path: "inline.md", tags: "#pinned" });
    expect(result.added).toEqual(["pinned"]);
    await expectVaultError(
      () => manageTags(vault, { action: "add", path: "inline.md", tags: "bad tag" }),
      "INVALID_INPUT",
    );
    await expectVaultError(
      () => manageTags(vault, { action: "add", path: "inline.md", tags: "123" }),
      "INVALID_INPUT",
    );
  });

  it("remove：frontmatter 与行内一并清除，不影响嵌套子标签与代码块", async () => {
    const vault = makeTagsVault();
    writeFileSync(
      path.join(vault.root, "mix.md"),
      "---\ntags: [work, work/sub]\n---\n正文 #work 和 #work/sub\n```\n#work 代码\n```\n",
    );
    const result = await manageTags(vault, { action: "remove", path: "mix.md", tags: "work" });
    expect(result.removed_from_frontmatter).toEqual(["work"]);
    expect(result.removed_inline).toEqual([{ tag: "work", count: 1 }]);
    expect(result.found).toBe(true);

    const onDisk = readFileSync(path.join(vault.root, "mix.md"), "utf8");
    // 嵌套子标签与代码块里的 #work 都保留，只有正文中的独立 #work 被移除
    expect(onDisk).toBe(
      "---\ntags:\n  - work/sub\n---\n正文  和 #work/sub\n```\n#work 代码\n```\n",
    );
  });

  it("remove：标签不存在时 found=false 且文件不变", async () => {
    const vault = makeTagsVault();
    const before = readFileSync(path.join(vault.root, "inline.md"), "utf8");
    const result = await manageTags(vault, { action: "remove", path: "inline.md", tags: "ghost" });
    expect(result.found).toBe(false);
    expect(readFileSync(path.join(vault.root, "inline.md"), "utf8")).toBe(before);
  });

  it("E10: add 过期 if_match 报 ETAG_MISMATCH 且文件不变", async () => {
    const vault = makeTagsVault();
    await expectVaultError(
      () =>
        manageTags(vault, {
          action: "add",
          path: "inline.md",
          tags: "x",
          if_match: computeEtag("stale"),
        }),
      "ETAG_MISMATCH",
    );
    expect(readFileSync(path.join(vault.root, "inline.md"), "utf8")).toBe(
      "今天 #daily 打卡\n嵌套 #area/deep\n",
    );
  });

  it("add/remove 缺 path 或 tags 报 INVALID_INPUT", async () => {
    const vault = makeTagsVault();
    await expectVaultError(() => manageTags(vault, { action: "add", tags: "x" }), "INVALID_INPUT");
    await expectVaultError(
      () => manageTags(vault, { action: "remove", path: "inline.md" }),
      "INVALID_INPUT",
    );
  });
});
