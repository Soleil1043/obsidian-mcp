import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { VaultError, type VaultErrorCode } from "../src/errors";
import { Vault } from "../src/vault";

const tempRoots: string[] = [];

function makeTempVault(): string {
  const root = mkdtempSync(path.join(tmpdir(), "obsidian-mcp-test-"));
  tempRoots.push(root);
  writeFileSync(path.join(root, "note.md"), "# hello\n");
  mkdirSync(path.join(root, "journal"));
  writeFileSync(path.join(root, "journal", "2026-09-30.md"), "diary");
  return root;
}

function expectVaultError(fn: () => unknown, code: VaultErrorCode): void {
  try {
    fn();
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

describe("Vault.fromEnv（E01 前置）", () => {
  it("未设置 OBSIDIAN_VAULT_PATH 时报 VAULT_PATH_NOT_SET", () => {
    expectVaultError(() => Vault.fromEnv({}), "VAULT_PATH_NOT_SET");
  });

  it("路径不存在时报 VAULT_NOT_FOUND", () => {
    const missing = path.join(tmpdir(), "obsidian-mcp-nonexistent-vault");
    expectVaultError(
      () => Vault.fromEnv({ OBSIDIAN_VAULT_PATH: missing }),
      "VAULT_NOT_FOUND",
    );
  });

  it("路径是文件时报 VAULT_NOT_A_DIRECTORY", () => {
    const root = makeTempVault();
    expectVaultError(
      () => Vault.fromEnv({ OBSIDIAN_VAULT_PATH: path.join(root, "note.md") }),
      "VAULT_NOT_A_DIRECTORY",
    );
  });

  it("合法路径时构造成功，root 为绝对路径", () => {
    const root = makeTempVault();
    const vault = Vault.fromEnv({ OBSIDIAN_VAULT_PATH: root });
    expect(vault.root).toBe(path.resolve(root));
  });

  it('支持 "~" 展开为用户主目录', () => {
    const vault = Vault.fromEnv({ OBSIDIAN_VAULT_PATH: "~" });
    expect(vault.root).toBe(path.resolve(homedir()));
  });
});

describe("Vault.resolvePath", () => {
  it("解析根内相对路径为绝对平台路径", () => {
    const vault = new Vault(makeTempVault());
    expect(vault.resolvePath("note.md")).toBe(path.join(vault.root, "note.md"));
    expect(vault.resolvePath("journal/2026-09-30.md")).toBe(
      path.join(vault.root, "journal", "2026-09-30.md"),
    );
  });

  it("归一化重复分隔符、'.' 段与尾随分隔符", () => {
    const vault = new Vault(makeTempVault());
    expect(vault.resolvePath("journal//sub/./x.md")).toBe(
      path.join(vault.root, "journal", "sub", "x.md"),
    );
    expect(vault.resolvePath("journal/")).toBe(path.join(vault.root, "journal"));
    expect(vault.resolvePath(".")).toBe(vault.root);
  });

  it.runIf(process.platform === "win32")(
    "Windows 上反斜杠视为路径分隔符",
    () => {
      const vault = new Vault(makeTempVault());
      expect(vault.resolvePath("journal\\2026-09-30.md")).toBe(
        path.join(vault.root, "journal", "2026-09-30.md"),
      );
    },
  );

  it("E05: 任何 '..' 段都被拒绝，即使结果仍在根内", () => {
    const vault = new Vault(makeTempVault());
    expectVaultError(() => vault.resolvePath("../outside.md"), "PATH_ESCAPES_VAULT");
    expectVaultError(() => vault.resolvePath("journal/../../x.md"), "PATH_ESCAPES_VAULT");
    expectVaultError(() => vault.resolvePath("a/../b.md"), "PATH_ESCAPES_VAULT");
  });

  it("E05: 绝对路径（根路径与盘符）被拒绝", () => {
    const vault = new Vault(makeTempVault());
    expectVaultError(() => vault.resolvePath("/etc/passwd"), "PATH_NOT_RELATIVE");
    expectVaultError(() => vault.resolvePath("C:/Users/note.md"), "PATH_NOT_RELATIVE");
    expectVaultError(() => vault.resolvePath("C:\\Users\\note.md"), "PATH_NOT_RELATIVE");
  });

  it("包含 '..' 字样的普通文件名不误伤，结果必在根内", () => {
    const vault = new Vault(makeTempVault());
    for (const safe of ["..x.md", "a..b/x.md", "%2e%2e/x.md", "…/x.md"]) {
      expect(vault.resolvePath(safe).startsWith(vault.root + path.sep)).toBe(true);
    }
  });

  it("空字节被拒绝", () => {
    const vault = new Vault(makeTempVault());
    expectVaultError(() => vault.resolvePath("note\0.md"), "INVALID_PATH");
  });
});

describe("Vault.resolveMarkdownPath（E06）", () => {
  it("接受 .md 与大写 .MD（不区分大小写）", () => {
    const vault = new Vault(makeTempVault());
    expect(vault.resolveMarkdownPath("note.md")).toBe(path.join(vault.root, "note.md"));
    expect(vault.resolveMarkdownPath("NOTE.MD")).toBe(path.join(vault.root, "NOTE.MD"));
  });

  it("拒绝非 Markdown 目标", () => {
    const vault = new Vault(makeTempVault());
    expectVaultError(() => vault.resolveMarkdownPath("image.png"), "NOT_MARKDOWN");
    expectVaultError(() => vault.resolveMarkdownPath("note"), "NOT_MARKDOWN");
    expectVaultError(() => vault.resolveMarkdownPath("board.canvas"), "NOT_MARKDOWN");
  });
});

describe("VaultError", () => {
  it("携带错误码且是标准 Error", () => {
    const error = new VaultError("INVALID_PATH", "boom");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("INVALID_PATH");
    expect(error.message).toBe("boom");
  });
});
