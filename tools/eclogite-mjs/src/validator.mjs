// A small JSON Schema (draft 2020-12) validator for exactly the vocabulary the
// schemas in schemas/ use. It exists so the C tool can mirror it: every
// keyword is a few lines, and the selection of which errors to report is
// defined here rather than left to a library.
//
// Keywords: $ref, $defs, type, const, enum, pattern, minLength, maxLength,
// minimum, maximum, minItems, uniqueItems, items, properties, required,
// additionalProperties, unevaluatedProperties, propertyNames, minProperties,
// maxProperties, allOf, anyOf, oneOf, not. Annotation keywords ($schema, title,
// description, tsType, ...) are ignored. `format` is not used.
//
// Reported errors (see README, "Diagnostics"):
// - a failed keyword is one error { pointer, onKey, message };
// - an unknown property is reported at the property's key;
// - when no alternative of oneOf/anyOf matches, only the errors of the best
//   alternative are reported: alternatives that fail the `type` of the value or
//   a `const` or `enum` on a direct property (the discriminator, such as
//   `builder`) are discarded
//   unless all fail one, then the fewest errors wins, then the first.
// Errors are de-duplicated and sorted by position by the caller.

import { readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";

export function loadSchemas(dir) {
  const docs = new Map();
  const walk = (rel) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.name.endsWith(".schema.json")) docs.set(r, JSON.parse(readFileSync(join(dir, r), "utf8")));
    }
  };
  walk("");
  return docs;
}

const KNOWN = new Set([
  "$schema", "$ref", "$defs", "title", "description", "tsType", "type", "const", "enum", "pattern", "minLength",
  "maxLength", "minimum", "maximum", "minItems", "uniqueItems", "items", "properties", "required",
  "additionalProperties", "unevaluatedProperties", "propertyNames", "minProperties", "maxProperties", "allOf",
  "anyOf", "oneOf", "not",
]);

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function typeMatches(want, v) {
  const t = typeOf(v);
  return want === t || (want === "number" && t === "integer");
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

const child = (ptr, key) => `${ptr}/${String(key).replace(/~/g, "~0").replace(/\//g, "~1")}`;
const show = (v) => JSON.stringify(v);

export class Validator {
  constructor(docs) {
    this.docs = docs;
    this.regex = new Map();
    // every keyword used anywhere must be known: a new keyword is a decision
    for (const [name, doc] of docs) this.#audit(doc, name);
  }

  #audit(node, name) {
    if (Array.isArray(node)) return node.forEach((n) => this.#audit(n, name));
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (k === "properties" || k === "$defs") for (const sub of Object.values(v)) this.#audit(sub, name);
      else if (k === "const" || k === "enum") continue;
      else {
        if (!KNOWN.has(k)) throw new Error(`${name}: unsupported schema keyword "${k}"`);
        this.#audit(v, name);
      }
    }
  }

  /** Validate `value` against `file#pointer`. Returns an array of errors. */
  validate(value, file, pointer = "") {
    const schema = this.#resolve(file, pointer);
    const r = this.#check(schema.node, schema.doc, value, "");
    const seen = new Set();
    return r.errors.filter((e) => {
      const k = `${e.pointer}|${e.onKey}|${e.message}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  #resolve(file, pointer) {
    let node = this.docs.get(file);
    if (!node) throw new Error(`unknown schema ${file}`);
    for (const part of pointer.split("/").slice(1)) {
      node = node[part.replace(/~1/g, "/").replace(/~0/g, "~")];
      if (node === undefined) throw new Error(`unresolved pointer ${file}#${pointer}`);
    }
    return { node, doc: file };
  }

  #ref(ref, doc) {
    const [file, pointer = ""] = ref.split("#");
    return this.#resolve(file === "" ? doc : posix.normalize(posix.join(posix.dirname(doc), file)), pointer);
  }

  #re(p) {
    if (!this.regex.has(p)) this.regex.set(p, new RegExp(p, "u"));
    return this.regex.get(p);
  }

  #check(schema, doc, v, ptr) {
    const errors = [];
    const props = new Set();
    const err = (message, pointer = ptr, onKey = false, keyword = "") => errors.push({ pointer, onKey, message, keyword });
    if (schema === true) return { errors, props };
    if (schema === false) { err("is not allowed"); return { errors, props }; }

    if (schema.$ref !== undefined) {
      const t = this.#ref(schema.$ref, doc);
      const r = this.#check(t.node, t.doc, v, ptr);
      errors.push(...r.errors);
      r.props.forEach((p) => props.add(p));
    }

    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((t) => typeMatches(t, v))) {
        err(`must be ${types.join(" or ")}`, ptr, false, "type");
        return { errors, props };
      }
    }
    if (schema.const !== undefined && !deepEqual(schema.const, v)) err(`must be ${show(schema.const)}`, ptr, false, "const");
    if (schema.enum !== undefined && !schema.enum.some((e) => deepEqual(e, v))) {
      err(`must be one of ${schema.enum.map(show).join(", ")}`, ptr, false, "enum");
    }

    if (typeof v === "string") {
      const len = [...v].length;
      if (schema.minLength !== undefined && len < schema.minLength) {
        err(schema.minLength === 1 ? "must not be empty" : `must have at least ${schema.minLength} characters`);
      }
      if (schema.maxLength !== undefined && len > schema.maxLength) err(`must have at most ${schema.maxLength} characters`);
      if (schema.pattern !== undefined && !this.#re(schema.pattern).test(v)) err(`must match pattern ${show(schema.pattern)}`);
    }
    if (typeof v === "number") {
      if (schema.minimum !== undefined && v < schema.minimum) err(`must be at least ${schema.minimum}`);
      if (schema.maximum !== undefined && v > schema.maximum) err(`must be at most ${schema.maximum}`);
    }

    if (Array.isArray(v)) {
      if (schema.minItems !== undefined && v.length < schema.minItems) {
        err(schema.minItems === 1 ? "must not be empty" : `must have at least ${schema.minItems} items`);
      }
      if (schema.uniqueItems) {
        for (let i = 1; i < v.length; i++) {
          const j = v.findIndex((x, k) => k < i && deepEqual(x, v[i]));
          if (j >= 0) err(`duplicate of item ${j}`, child(ptr, i));
        }
      }
      if (schema.items !== undefined) {
        v.forEach((item, i) => {
          const r = this.#check(schema.items, doc, item, child(ptr, i));
          errors.push(...r.errors);
        });
      }
    }

    if (typeOf(v) === "object") {
      const keys = Object.keys(v);
      if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
        err(schema.minProperties === 1 ? "must not be empty" : `must have at least ${schema.minProperties} propert${schema.minProperties === 1 ? "y" : "ies"}`);
      }
      if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) err(`must have at most ${schema.maxProperties} propert${schema.maxProperties === 1 ? "y" : "ies"}`);
      for (const k of schema.required ?? []) if (!Object.hasOwn(v, k)) err(`missing required property ${show(k)}`, ptr, false, "required");
      if (schema.propertyNames !== undefined) {
        for (const k of keys) {
          const r = this.#check(schema.propertyNames, doc, k, ptr);
          if (r.errors.length) err(`invalid property name ${show(k)}: ${r.errors[0].message}`, child(ptr, k), true);
        }
      }
      for (const [k, sub] of Object.entries(schema.properties ?? {})) {
        if (!Object.hasOwn(v, k)) continue;
        props.add(k);
        if (sub === false) { err(`property ${show(k)} is not allowed here`, child(ptr, k), true); continue; }
        errors.push(...this.#check(sub, doc, v[k], child(ptr, k)).errors);
      }
      if (schema.additionalProperties !== undefined) {
        for (const k of keys) {
          if (Object.hasOwn(schema.properties ?? {}, k)) continue;
          props.add(k);
          if (schema.additionalProperties === false) err(`unknown property ${show(k)}`, child(ptr, k), true, "unknown");
          else errors.push(...this.#check(schema.additionalProperties, doc, v[k], child(ptr, k)).errors);
        }
      }
    }

    for (const sub of schema.allOf ?? []) {
      const r = this.#check(sub, doc, v, ptr);
      errors.push(...r.errors);
      r.props.forEach((p) => props.add(p));
    }
    if (schema.oneOf !== undefined || schema.anyOf !== undefined) {
      const alts = schema.oneOf ?? schema.anyOf;
      const rs = alts.map((a) => this.#check(a, doc, v, ptr));
      const ok = rs.filter((r) => r.errors.length === 0);
      if (schema.oneOf && ok.length > 1) err("matches more than one alternative");
      if (ok.length > 0) ok.forEach((r) => r.props.forEach((p) => props.add(p)));
      else {
        const best = this.#best(rs, ptr);
        errors.push(...best.errors);
        best.props.forEach((p) => props.add(p));
      }
    }
    if (schema.not !== undefined && this.#check(schema.not, doc, v, ptr).errors.length === 0) err("is not allowed");

    if (schema.unevaluatedProperties !== undefined && typeOf(v) === "object") {
      for (const k of Object.keys(v)) {
        if (props.has(k)) continue;
        props.add(k);
        if (schema.unevaluatedProperties === false) err(`unknown property ${show(k)}`, child(ptr, k), true, "unknown");
        else errors.push(...this.#check(schema.unevaluatedProperties, doc, v[k], child(ptr, k)).errors);
      }
    }
    return { errors, props };
  }

  /** The errors of the alternative the author most likely meant. */
  #best(results, ptr) {
    const scored = results.map((r, index) => {
      const unique = new Set(r.errors.map((e) => `${e.pointer}|${e.message}`)).size;
      const mismatch = r.errors.some(
        (e) =>
          (e.keyword === "type" && e.pointer === ptr) ||
          ((e.keyword === "const" || e.keyword === "enum") && e.pointer.startsWith(`${ptr}/`) && !e.pointer.slice(ptr.length + 1).includes("/")),
      );
      return { r, index, unique, mismatch };
    });
    const candidates = scored.some((s) => !s.mismatch) ? scored.filter((s) => !s.mismatch) : scored;
    candidates.sort((a, b) => a.unique - b.unique || a.index - b.index);
    return candidates[0].r;
  }
}
