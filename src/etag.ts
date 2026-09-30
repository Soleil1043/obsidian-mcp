import { createHash } from "node:crypto";

import { VaultError } from "./errors.js";

/** 内容的 SHA-256 etag（64 位 hex），随内容变化而变化。 */
export function computeEtag(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * F11/E10 乐观锁：调用方提供 if_match 时，与当前内容 etag 比对；
 * 不符则拒绝写入（在写盘之前调用，保证失败路径上文件不变）。
 */
export function assertEtagMatches(
  currentContent: string,
  ifMatch: string | undefined,
  relativePath: string,
): void {
  if (ifMatch === undefined) return;
  const actual = computeEtag(currentContent);
  if (actual !== ifMatch) {
    throw new VaultError(
      "ETAG_MISMATCH",
      `${relativePath} 在读取后被修改过（etag 不匹配，期望 ${short(ifMatch)}，实际 ${short(actual)}）；文件未做任何改动，请重新 read_note 获取最新内容与 etag`,
    );
  }
}

function short(etag: string): string {
  return etag.length > 12 ? `${etag.slice(0, 12)}…` : etag;
}
