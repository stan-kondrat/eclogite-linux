// Strict JSONC parser (docs/configuration.md, "Strict JSONC profile").
//
// Accepted: one JSON value per document, `//` and `/* */` comments (JSONC
// only; a `.json` file may not have them), integers within +-(2^53-1).
// Rejected, each with file:line:column: duplicate keys, trailing commas,
// `null`, numbers with a fraction or exponent, leading zeros, integer
// overflow, malformed escapes, lone surrogates, control characters in
// strings, invalid UTF-8, a byte order mark, text after the value.
//
// Line and column are 1-based; the column counts UTF-8 bytes from the start
// of the line, so the C tool reports the same position.
//
// parseJsonc() returns the value and a position table: for every JSON Pointer
// in the document, where its value starts (and, for object members, where its
// key starts).

export class Diagnostic extends Error {
  constructor(file, line, column, message, path = "") {
    super(message);
    this.file = file;
    this.line = line;
    this.column = column;
    this.path = path;
  }
  toString() {
    return formatDiagnostic(this);
  }
}

export function formatDiagnostic(d) {
  const where = d.line ? `${d.file}:${d.line}:${d.column}` : d.file;
  return `${where}: ${d.message}${d.path ? ` (${d.path})` : ""}`;
}

const MAX_INT = BigInt(Number.MAX_SAFE_INTEGER);

/** Offset of the first invalid UTF-8 byte, or -1. */
function invalidUtf8(buf) {
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    let n = 0;
    let min = 0;
    if (b < 0x80) { i++; continue; }
    else if (b >= 0xc2 && b <= 0xdf) { n = 1; min = 0x80; }
    else if (b >= 0xe0 && b <= 0xef) { n = 2; min = 0x800; }
    else if (b >= 0xf0 && b <= 0xf4) { n = 3; min = 0x10000; }
    else return i;
    if (i + n >= buf.length) return i;
    let cp = b & (0xff >> (n + 2));
    for (let k = 1; k <= n; k++) {
      const c = buf[i + k];
      if ((c & 0xc0) !== 0x80) return i;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return i;
    i += n + 1;
  }
  return -1;
}

/** Line and byte column of a UTF-16 offset in `text`. */
function position(text, offset) {
  let line = 1;
  let start = 0;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) { line++; start = i + 1; }
  }
  return { line, column: Buffer.byteLength(text.slice(start, offset)) + 1 };
}

export function pointerEscape(key) {
  return String(key).replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Parse `buffer` (a Buffer) read from `file`. `jsonc: false` rejects comments.
 * Throws a Diagnostic. Returns { value, positions } where positions is a Map
 * pointer -> { line, column, keyLine?, keyColumn? }.
 */
export function parseJsonc(buffer, file, { jsonc = true } = {}) {
  const bad = invalidUtf8(buffer);
  if (bad >= 0) {
    const before = buffer.subarray(0, bad).toString("utf8");
    const p = position(before, before.length);
    throw new Diagnostic(file, p.line, p.column, "invalid UTF-8");
  }
  const text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) throw new Diagnostic(file, 1, 1, "byte order mark is not allowed");
  const positions = new Map();
  let i = 0;

  function fail(message, at = i, path = "") {
    const p = position(text, at);
    throw new Diagnostic(file, p.line, p.column, message, path);
  }

  function skip() {
    for (;;) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") i++;
      else if (c === "/" && text[i + 1] === "/") {
        if (!jsonc) fail("comments are not allowed in .json");
        while (i < text.length && text[i] !== "\n") i++;
      } else if (c === "/" && text[i + 1] === "*") {
        if (!jsonc) fail("comments are not allowed in .json");
        const end = text.indexOf("*/", i + 2);
        if (end < 0) fail("unterminated comment");
        i = end + 2;
      } else return;
    }
  }

  function parseString(path) {
    const start = i;
    i++; // opening quote
    let out = "";
    for (;;) {
      if (i >= text.length) fail("unterminated string", start, path);
      const c = text[i];
      const code = text.charCodeAt(i);
      if (c === '"') { i++; return out; }
      if (code === 10 || code === 13) fail("unterminated string", start, path);
      if (code < 0x20) fail("control character in string", i, path);
      if (c === "\\") {
        const e = text[i + 1];
        const simple = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (e in simple) { out += simple[e]; i += 2; continue; }
        if (e === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("malformed \\u escape", i, path);
          const unit = parseInt(hex, 16);
          if (unit >= 0xd800 && unit <= 0xdbff) {
            const lo = /^\\u([dD][c-fC-F][0-9a-fA-F]{2})/.exec(text.slice(i + 6, i + 12));
            if (!lo) fail("unpaired surrogate in \\u escape", i, path);
            out += String.fromCharCode(unit, parseInt(lo[1], 16));
            i += 12;
          } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            fail("unpaired surrogate in \\u escape", i, path);
          } else {
            out += String.fromCharCode(unit);
            i += 6;
          }
          continue;
        }
        fail(`invalid escape \\${e === undefined ? "" : e}`, i, path);
      }
      // surrogate pairs in the source are copied as they are
      out += c;
      i++;
    }
  }

  function parseNumber(path) {
    const m = /^-?[0-9]+/.exec(text.slice(i, i + 400));
    if (!m) fail("invalid number", i, path);
    const next = text[i + m[0].length];
    if (next === "." || next === "e" || next === "E") fail("floating-point numbers are not allowed", i, path);
    const digits = m[0].replace("-", "");
    if (digits.length > 1 && digits[0] === "0") fail("leading zero in number", i, path);
    const n = BigInt(m[0]);
    if (n > MAX_INT || n < -MAX_INT) fail("integer out of range (beyond +-9007199254740991)", i, path);
    i += m[0].length;
    return Number(n);
  }

  function parseValue(path) {
    skip();
    const at = i;
    const c = text[i];
    const pos = position(text, at);
    const entry = { line: pos.line, column: pos.column };
    positions.set(path, entry);
    if (c === "{") return parseObject(path);
    if (c === "[") return parseArray(path);
    if (c === '"') return parseString(path);
    if (c === "-" || (c >= "0" && c <= "9")) return parseNumber(path);
    for (const [word, value] of [["true", true], ["false", false]]) {
      if (text.startsWith(word, i) && !/[A-Za-z0-9_]/.test(text[i + word.length] ?? "")) { i += word.length; return value; }
    }
    if (text.startsWith("null", i)) fail("null is not allowed", i, path);
    if (i >= text.length) fail("unexpected end of input", i, path);
    fail(`unexpected character ${JSON.stringify(c)}`, i, path);
  }

  function parseObject(path) {
    i++;
    const obj = {};
    const seen = new Set();
    skip();
    if (text[i] === "}") { i++; return obj; }
    for (;;) {
      skip();
      if (text[i] === "}") fail("trailing comma", i, path);
      if (text[i] !== '"') fail("expected a string key", i, path);
      const keyAt = i;
      const key = parseString(path);
      const childPath = `${path}/${pointerEscape(key)}`;
      if (seen.has(key)) fail(`duplicate key ${JSON.stringify(key)}`, keyAt, childPath);
      seen.add(key);
      skip();
      if (text[i] !== ":") fail("expected ':'", i, childPath);
      i++;
      const value = parseValue(childPath);
      const kp = position(text, keyAt);
      Object.assign(positions.get(childPath), { keyLine: kp.line, keyColumn: kp.column });
      Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
      skip();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === "}") { i++; return obj; }
      fail("expected ',' or '}'", i, path);
    }
  }

  function parseArray(path) {
    i++;
    const arr = [];
    skip();
    if (text[i] === "]") { i++; return arr; }
    for (;;) {
      skip();
      if (text[i] === "]") fail("trailing comma", i, path);
      arr.push(parseValue(`${path}/${arr.length}`));
      skip();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === "]") { i++; return arr; }
      fail("expected ',' or ']'", i, path);
    }
  }

  const value = parseValue("");
  skip();
  if (i < text.length) fail("unexpected text after the document");
  return { value, positions };
}
