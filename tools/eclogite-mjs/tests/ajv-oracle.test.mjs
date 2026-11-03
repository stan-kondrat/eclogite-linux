// The small validator (src/validator.mjs) must agree with Ajv, the reference
// JSON Schema implementation, on whether a document is valid: every catalog
// document, every invalid fixture that parses, and mutations of both.

import { test } from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseJsonc } from "../src/jsonc.mjs";
import { Validator, loadSchemas } from "../src/validator.mjs";
import { KINDS } from "../src/catalog.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMAS = resolve(HERE, "../../../schemas");
const docs = loadSchemas(SCHEMAS);
const mine = new Validator(docs);
const ajv = new Ajv2020({ strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true, allErrors: true });
ajv.addKeyword({ keyword: "tsType", schemaType: "string" });
for (const [name, schema] of docs) ajv.addSchema({ ...schema, $id: pathToFileURL(join(SCHEMAS, name)).href });

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.jsonc?$/.test(n) ? [p] : [];
  });
}

function agree(file, value) {
  const info = KINDS[value.schema];
  if (!info) return;
  const validate = ajv.getSchema(pathToFileURL(join(SCHEMAS, info.schema)).href);
  const theirs = validate(value);
  const ours = mine.validate(value, info.schema).length === 0;
  assert.equal(ours, theirs, `${file}: eclogite-mjs says ${ours ? "valid" : "invalid"}, Ajv says ${theirs ? "valid" : "invalid"}`);
}

test("validator agrees with Ajv on the catalog and the fixtures", () => {
  const files = [...walk(resolve(HERE, "../../../catalog")), ...walk(join(HERE, "fixtures"))];
  let n = 0;
  for (const f of files) {
    let value;
    try { value = parseJsonc(readFileSync(f), f, { jsonc: f.endsWith(".jsonc") }).value; } catch { continue; }
    if (value && typeof value === "object") { agree(f, value); n++; }
  }
  assert.ok(n > 60);
});

test("validator agrees with Ajv on mutated catalog documents", () => {
  const files = walk(resolve(HERE, "../../../catalog"));
  let n = 0;
  for (const f of files) {
    const value = parseJsonc(readFileSync(f), f).value;
    // drop each top-level key in turn, and add an unknown one
    for (const k of Object.keys(value)) {
      const copy = { ...value };
      delete copy[k];
      agree(`${f} without ${k}`, copy);
      n++;
    }
    agree(`${f} with extra`, { ...value, zz_extra: 1 });
    // replace each top-level value by a string and by an empty object
    for (const k of Object.keys(value)) {
      agree(`${f} ${k}=string`, { ...value, [k]: "x" });
      agree(`${f} ${k}={}`, { ...value, [k]: {} });
      n += 2;
    }
  }
  assert.ok(n > 500);
});
