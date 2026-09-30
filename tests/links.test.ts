import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { Vault } from "../src/vault";
import { moveNote } from "../src/tools/organize";
import {
  MOVED_NOTE_CONTENT,
  cleanupTempVaults,
  makeLinksVault,
  makeLinksVaultAmbiguous,
} from "./helpers";

afterEach(() => {
  cleanupTempVaults();
});

describe("move_note 反向链接维护（F12/E11）", () => {
  it("纯移动（basename 不变）：路径式引用改写，裸引用保留，代码块不动，自身相对链接重定位", async () => {
    const vault: Vault = makeLinksVault();
    const result = await moveNote(vault, { from: "journal/note.md", to: "archive/note.md" });

    const a = readFileSync(path.join(vault.root, "a.md"), "utf8");
    expect(a).toBe(
      "see [[note]] and [[note|alias]] plus [[note#head]] embed ![[note]]\n" +
        "path [[archive/note]] and [[archive/note.md]]\n" +
        "other [[other]] missing [[missing]] dup [[dup]]\n" +
        "```\ncode [[journal/note]]\n```\n" +
        "[t](archive/note.md)\n",
    );

    const moved = readFileSync(path.join(vault.root, "archive", "note.md"), "utf8");
    expect(moved).toBe(MOVED_NOTE_CONTENT.replace("[rel](other.md)", "[rel](../journal/other.md)"));

    expect(result.updated).toEqual(["a.md", "archive/note.md"]);
    expect(result.ambiguous).toEqual([]);
  });

  it("重命名（basename 变化）：裸引用与路径式引用都改写为新名", async () => {
    const vault = makeLinksVault();
    const result = await moveNote(vault, { from: "journal/note.md", to: "journal/renamed.md" });

    const a = readFileSync(path.join(vault.root, "a.md"), "utf8");
    expect(a).toContain("[[renamed]]");
    expect(a).toContain("[[renamed|alias]]");
    expect(a).toContain("[[renamed#head]]");
    expect(a).toContain("![[renamed]]");
    expect(a).toContain("[[journal/renamed]] and [[journal/renamed.md]]");
    expect(a).toContain("[t](journal/renamed.md)");
    expect(a).not.toContain("[[note]]");

    const moved = readFileSync(path.join(vault.root, "journal", "renamed.md"), "utf8");
    expect(moved).toBe(MOVED_NOTE_CONTENT); // 同目录移动，自身相对链接不变
    expect(result.updated).toEqual(["a.md"]);
  });

  it("E11: 歧义链接保持原样并在返回中报告", async () => {
    const vault = makeLinksVaultAmbiguous();
    const result = await moveNote(vault, {
      from: "journal/note.md",
      to: "journal/renamed.md",
    });

    const a = readFileSync(path.join(vault.root, "a.md"), "utf8");
    expect(a).toBe("see [[note]]\n"); // 两篇 note.md，[[note]] 无法唯一解析 → 不动
    expect(result.ambiguous).toEqual([{ path: "a.md", link: "[[note]]" }]);
    expect(result.updated).toEqual([]);
  });
});
