// Canonical JSON and SHA-256 (docs/configuration.md, "Lock file").
//
// Canonical form, used for every hash: object keys in byte order of their
// UTF-8 encoding, no whitespace, integers in decimal, strings escaped only
// where JSON requires it (`"`, `\`, and U+0000..U+001F as \b \f \n \r \t or
// \u00xx with lower-case hex), everything else as UTF-8. Floating-point
// numbers, null and undefined do not exist in the model.
//
// Pretty form, used for files written for review: JSON.stringify(v, null, 2)
// plus a final newline, over values whose key order the producer fixes.

import { createHash } from "node:crypto";

function compareBytes(a, b) {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

function str(s) {
  return JSON.stringify(s);
}

export function canonicalJson(v, at = "") {
  if (v === null || v === undefined) throw new Error(`canonical form has no null or undefined (at ${at || "/"})`);
  if (typeof v === "string") return str(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error(`canonical form has integers only, got ${v} (at ${at || "/"})`);
    return String(v);
  }
  if (Array.isArray(v)) return `[${v.map((x, i) => canonicalJson(x, `${at}/${i}`)).join(",")}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort(compareBytes);
  return `{${keys.map((k) => `${str(k)}:${canonicalJson(v[k], `${at}/${k}`)}`).join(",")}}`;
}

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

export const hashOf = (v) => sha256(canonicalJson(v));

export function prettyJson(v) {
  return `${JSON.stringify(v, null, 2)}\n`;
}

/** Copy of an object with its keys in byte order, recursively. */
export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort(compareBytes).map((k) => [k, sortKeys(v[k])]));
  }
  return v;
}

/** A shallow copy of an object with its keys in byte order. */
export function sortedMap(o) {
  return Object.fromEntries(Object.keys(o).sort(compareBytes).map((k) => [k, o[k]]));
}
