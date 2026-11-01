#!/usr/bin/env node
// The JSON Schemas in schemas/ are the source of truth for every Eclogite
// document format. This script writes everything in generated/ from the
// repository and checks the examples written with it:
//
//   generated/schema/input.ts      types of the documents the CLI reads
//   generated/schema/compiled.ts   types of the compiled lock
//   generated/catalog/*.ts         every catalog/ document as a typed constant
//   generated/examples.ts          the system files in examples/
//
//   npm run types    rewrite generated/
//   npm run check    fail if generated/ is stale, a schema does not compile in
//                    strict mode, a catalog document is invalid, or an example
//                    does not type-check or validate
//
// Validating the catalog is the C host tool's job (tools/eclogite/).
//
// Generation rules:
// - every schema file's root and every entry of its `$defs` that has a
//   `title` becomes an exported type of that name; everything else is inlined;
// - `tsType` gives the TypeScript type of a schema directly, for what JSON
//   Schema cannot say (template literal types such as `/${string}`);
// - an object is closed: properties become fields, `additionalProperties`
//   becomes an index signature keyed by `propertyNames` when that has a
//   `tsType`;
// - `oneOf` and `anyOf` become unions, `allOf` intersections, `false` never;
// - `description` becomes the type's or field's doc comment.
// lock.schema.json makes compiled.ts; every other schema makes input.ts.

import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import Ajv2020 from "ajv/dist/2020.js";
import ts from "typescript";

const TYPES = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TYPES, "../..");
const SCHEMAS = join(ROOT, "schemas");
const GENERATED = join(TYPES, "generated");

// Output files, and the schema files in the order their types are written
const OUTPUTS = {
  input: {
    file: join(GENERATED, "schema/input.ts"),
    header: [
      "Eclogite input formats: the documents a person writes and the CLI reads.",
      "",
      "Conventions of the strict JSONC profile (docs/configuration.md):",
      "- every document is one object with a versioned `schema` string;",
      "- unknown keys, duplicate keys, `null` and floating-point numbers are",
      "  rejected, so no field is `| null` and every number is an integer;",
      "- an optional field (`?`) that is absent means the documented default.",
      "",
      "`OPEN(n)` marks a field that depends on open decision n in docs/formats.md.",
    ],
    schemas: [
      "common.schema.json",
      "package.schema.json",
      "builders/common.schema.json",
      "builders/configure.schema.json",
      "builders/make.schema.json",
      "builders/cmake.schema.json",
      "builders/linux-kernel.schema.json",
      "builders/files.schema.json",
      "builders/source-tree.schema.json",
      "builders/npm-workspace.schema.json",
      "machine.schema.json",
      "software.schema.json",
      "system.schema.json",
      "platform.schema.json",
      "abi.schema.json",
      "toolchain.schema.json",
      "facts.schema.json",
      "devices.schema.json",
      "defaults.schema.json",
      "eclogite.schema.json",
    ],
  },
  compiled: {
    file: join(GENERATED, "schema/compiled.ts"),
    header: [
      "Eclogite compiled format: what `eclogite lock` writes after resolving a",
      "system against the catalog (state/<system>/system.lock.json).",
      "",
      "Compiling a system merges the machine's `extends`; picks the platform, ABI,",
      "triplet, toolchain and compiler; expands meta-packages and follows",
      "dependencies into a closure; chooses a provider for every capability, with",
      "a reason; applies variants and parameters; merges the config required of",
      "configurable packages; and collects owned files, services, accounts,",
      "mounts, tests and the runner's start-time contract. Nothing in the result",
      "is a reference to resolve any more, and builds read only this.",
      "",
      "Keys and content hashes are written by the lock and plan commands",
      "(docs/cli.md).",
    ],
    schemas: ["lock.schema.json"],
  },
};

// ---------------------------------------------------------------------------
// Loading

/** Every file under `dir` whose name ends with `suffix`, in directory order. */
function walkFiles(dir, suffix) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walkFiles(join(dir, e.name), suffix) : e.name.endsWith(suffix) ? [join(dir, e.name)] : [],
  );
}

/** Every schema file by its file URL, which is also its base URI. */
function loadSchemas() {
  const docs = new Map();
  for (const path of walkFiles(SCHEMAS, ".schema.json")) {
    docs.set(pathToFileURL(path).href, { path, schema: JSON.parse(readFileSync(path, "utf8")) });
  }
  return docs;
}

function newAjv(docs) {
  const ajv = new Ajv2020({ strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true, allErrors: true });
  ajv.addKeyword({ keyword: "tsType", schemaType: "string" });
  for (const [uri, { schema }] of docs) ajv.addSchema({ ...schema, $id: uri });
  return ajv;
}

/** The kind a document's `schema` string names, such as `package`. */
function kindOf(document) {
  return document.schema.split(".")[1].split("/")[0];
}

/** JSONC to JSON: drops line and block comments outside strings. */
function stripComments(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
    } else out += c;
  }
  return out;
}

/** Error messages of `document` against the schema its `schema` string selects. */
function errorsOf(ajv, document) {
  const kind = kindOf(document);
  // the combined configuration is eclogite.config/v0.1 in eclogite.schema.json
  const file = `${kind === "config" ? "eclogite" : kind}.schema.json`;
  const validate = ajv.getSchema(pathToFileURL(join(SCHEMAS, file)).href);
  return validate(document) ? [] : validate.errors.map((e) => `${e.instancePath || "/"} ${e.message}`);
}

// ---------------------------------------------------------------------------
// Schema types

function pointerGet(schema, pointer) {
  if (!pointer || pointer === "/") return schema;
  return pointer
    .slice(1)
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((s, p) => {
      if (s === undefined) throw new Error(`bad pointer ${pointer}`);
      return s[p];
    }, schema);
}

class Generator {
  constructor(docs) {
    this.docs = docs;
    // "uri#pointer" of every named schema → { name, output }
    this.named = new Map();
    for (const [output, { schemas }] of Object.entries(OUTPUTS)) {
      for (const rel of schemas) {
        const uri = pathToFileURL(join(SCHEMAS, rel)).href;
        const doc = docs.get(uri);
        if (!doc) throw new Error(`missing schema ${rel}`);
        if (doc.schema.title) this.addName(`${uri}#`, doc.schema.title, output);
        for (const [key, def] of Object.entries(doc.schema.$defs ?? {})) {
          if (def.title) this.addName(`${uri}#/$defs/${key}`, def.title, output);
        }
      }
    }
  }

  addName(key, name, output) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error(`${key}: title "${name}" is not a type name`);
    for (const n of this.named.values()) {
      if (n.name === name && n.output === output) throw new Error(`type ${name} is defined twice`);
    }
    this.named.set(key, { name, output });
  }

  resolve(ref, base) {
    const url = new URL(ref, base);
    const pointer = decodeURIComponent(url.hash.slice(1));
    url.hash = "";
    const doc = this.docs.get(url.href);
    if (!doc) throw new Error(`unresolved $ref ${ref} from ${base}`);
    return { key: `${url.href}#${pointer}`, base: url.href, schema: pointerGet(doc.schema, pointer) };
  }

  /** The TypeScript type of a schema. */
  type(s, base, ind) {
    if (s === false) return "never";
    if (s === true || s === undefined) return "unknown";
    if (s.tsType) return s.tsType;
    if (s.$ref) {
      const target = this.resolve(s.$ref, base);
      const named = this.named.get(target.key);
      const ref = named ? this.qualify(named) : this.type(target.schema, target.base, ind);
      const rest = { ...s };
      delete rest.$ref;
      delete rest.description;
      delete rest.title;
      return this.hasShape(rest) ? `${paren(ref)} & ${paren(this.type(rest, base, ind))}` : ref;
    }
    const parts = [];
    const own = this.ownType(s, base, ind);
    if (own) parts.push(own);
    // members that only constrain (`required`, `not`, …) add nothing to the type
    const typed = (m) => this.typed(m);
    for (const sub of (s.allOf ?? []).filter(typed)) parts.push(this.type(sub, base, ind));
    const alternatives = (s.oneOf ?? s.anyOf ?? []).filter(typed);
    if (alternatives.length) parts.push(this.union(alternatives, base, ind));
    if (parts.length === 0) return "unknown";
    if (parts.length === 1) return parts[0];
    return parts.map(paren).join(" & ");
  }

  /** Whether a subschema adds to the type, rather than only constraining. */
  typed(m) {
    return typeof m === "boolean" || Boolean(m.$ref || m.tsType) || this.hasShape(m);
  }

  hasShape(s) {
    return ["type", "properties", "additionalProperties", "items", "const", "enum", "allOf", "oneOf", "anyOf"].some(
      (k) => k in s,
    );
  }

  union(members, base, ind) {
    const types = members.map((m) => {
      const t = this.type(m, base, ind + "  ");
      const doc = m && typeof m === "object" && m.description ? docComment(m.description, ind + "  ") : "";
      return { t, doc };
    });
    const flat = types.every((x) => !x.doc) && types.map((x) => x.t).join(" | ");
    if (flat && flat.length < 70 && !flat.includes("\n")) return flat;
    return types.map(({ t, doc }) => `\n${doc}${ind}  | ${t}`).join("");
  }

  /** The type from `const`, `enum` and `type` alone, or null. */
  ownType(s, base, ind) {
    if ("const" in s) return JSON.stringify(s.const);
    if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
    const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
    const objectLike = s.properties || s.additionalProperties !== undefined || s.patternProperties;
    if (types.length === 0) return objectLike ? this.objectType(s, base, ind) : null;
    return types
      .map((t) => {
        switch (t) {
          case "string":
            return "string";
          case "integer":
          case "number":
            return "number";
          case "boolean":
            return "boolean";
          case "null":
            return "null";
          case "array":
            return `${paren(this.type(s.items, base, ind))}[]`;
          case "object":
            // an object described only by allOf/oneOf has no shape of its own
            if (!objectLike && (s.allOf || s.oneOf || s.anyOf)) return null;
            return this.objectType(s, base, ind);
          default:
            throw new Error(`unknown type ${t}`);
        }
      })
      .filter(Boolean)
      .join(" | ") || null;
  }

  objectType(s, base, ind) {
    const inner = ind + "  ";
    const lines = [];
    const required = new Set(s.required ?? []);
    for (const [key, prop] of Object.entries(s.properties ?? {})) {
      if (prop && typeof prop === "object" && prop.description) lines.push(docComment(prop.description, inner).trimEnd());
      lines.push(`${inner}${propertyKey(key)}${required.has(key) ? "" : "?"}: ${this.type(prop, base, inner)};`);
    }
    const extra = s.additionalProperties;
    if (extra !== undefined && extra !== false) {
      const keyType = s.propertyNames ? this.keyType(s.propertyNames, base) : "string";
      lines.push(`${inner}[key: ${keyType}]: ${this.type(extra, base, inner)};`);
    } else if (!s.properties && extra === undefined) {
      lines.push(`${inner}[key: string]: unknown;`);
    }
    if (lines.length === 0) return "{}";
    return `{\n${lines.join("\n")}\n${ind}}`;
  }

  keyType(s, base) {
    if (s.tsType) return s.tsType;
    if (s.$ref) {
      const target = this.resolve(s.$ref, base);
      return this.keyType(target.schema, target.base);
    }
    return "string";
  }

  qualify({ name, output }) {
    if (output !== this.output) {
      this.imports.add(output);
      return `Input.${name}`;
    }
    return name;
  }

  isInterface(s) {
    return (
      s &&
      typeof s === "object" &&
      !s.tsType &&
      !s.$ref &&
      ![s.allOf, s.oneOf, s.anyOf].some((list) => list?.some((m) => this.typed(m))) &&
      !("const" in s) &&
      !s.enum &&
      (s.type === "object" || (!s.type && s.properties)) &&
      s.properties &&
      (s.additionalProperties === false || s.additionalProperties === undefined)
    );
  }

  render(output) {
    this.output = output;
    this.imports = new Set();
    const chunks = [];
    for (const [key, { name, output: o }] of this.named) {
      if (o !== output) continue;
      const [uri, pointer] = key.split("#");
      const schema = pointerGet(this.docs.get(uri).schema, pointer);
      const doc = schema.description ? docComment(schema.description, "") : "";
      if (this.isInterface(schema)) {
        chunks.push(`${doc}export interface ${name} ${this.objectType(schema, uri, "")}\n`);
      } else {
        chunks.push(`${doc}export type ${name} = ${this.type(schema, uri, "")};\n`);
      }
    }
    const header = [
      ...OUTPUTS[output].header.map((l) => (l ? `// ${l}` : "//")),
      "//",
      "// Generated from schemas/ by site/types/generate.mjs. Do not edit: change",
      "// the schema and run `npm run types` in site/types.",
      "",
    ];
    if (this.imports.size) header.push(`import type * as Input from "./input";`, "");
    return header.join("\n") + "\n" + chunks.join("\n");
  }
}

function paren(t) {
  const trimmed = t.trim();
  if (/^[\w.]+(\[\])*$/.test(trimmed) || /^"[^"]*"$/.test(trimmed) || /^`[^`]*`$/.test(trimmed)) return t;
  if (trimmed.startsWith("{") && matchingBrace(trimmed) === trimmed.length - 1) return t;
  return `(${t})`;
}

function matchingBrace(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

function propertyKey(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function docComment(text, ind) {
  const lines = text.replace(/\*\//g, "*\\/").split("\n");
  if (lines.length === 1 && lines[0].length + ind.length < 90) return `${ind}/** ${lines[0]} */\n`;
  return `${ind}/**\n${lines.map((l) => `${ind} *${l ? " " + l : ""}`).join("\n")}\n${ind} */\n`;
}

/** Every file of generated/, by path: the schema types, the catalog and the examples. */
function generate(docs, ajv) {
  const generator = new Generator(docs);
  const files = new Map(Object.keys(OUTPUTS).map((o) => [OUTPUTS[o].file, generator.render(o)]));
  for (const [file, text] of generateDocuments(ajv)) files.set(file, text);
  return files;
}

// ---------------------------------------------------------------------------
// Catalog and examples

/** The catalog/ kinds with many documents: the module each is written to, and its type. */
const LISTS = {
  machine: { module: "machines", type: "Machine" },
  software: { module: "software", type: "Software" },
  system: { module: "systems", type: "System" },
  platform: { module: "platforms", type: "Platform" },
  abi: { module: "abis", type: "Abi" },
  toolchain: { module: "toolchains", type: "Toolchain" },
  package: { module: "packages", type: "Package" },
};
/** The catalog/ kinds with exactly one document, and their types. */
const SINGLES = { facts: "Facts", devices: "Devices", defaults: "Defaults" };

const RESERVED = new Set(
  ("all await break case catch class const continue debugger default delete do else enum export extends false " +
    "finally for function if implements import in instanceof interface let new null package private protected " +
    "public return static super switch this throw true try typeof var void while with yield").split(" "),
);

/** A document name as a TypeScript identifier: `utm-virt-arm64` is `utmVirtArm64`. */
function identifier(name) {
  const id = name.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""));
  return /^[0-9]/.test(id) || RESERVED.has(id) ? `_${id}` : id;
}

/** A JSON value as a TypeScript literal: unquoted keys, short values on one line. */
function literal(value, ind) {
  const short = (text) => !text.includes("\n") && text.length + ind.length < 90;
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const inline = `[${value.map((v) => literal(v, "")).join(", ")}]`;
    if (short(inline)) return inline;
    return `[\n${value.map((v) => `${ind}  ${literal(v, `${ind}  `)},`).join("\n")}\n${ind}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return "{}";
    const inline = `{ ${entries.map(([k, v]) => `${propertyKey(k)}: ${literal(v, "")}`).join(", ")} }`;
    if (short(inline) && entries.length <= 4) return inline;
    return `{\n${entries.map(([k, v]) => `${ind}  ${propertyKey(k)}: ${literal(v, `${ind}  `)},`).join("\n")}\n${ind}}`;
  }
  return JSON.stringify(value);
}

function documentsHeader(lines) {
  return [
    ...lines.map((l) => (l ? `// ${l}` : "//")),
    "//",
    "// Generated by site/types/generate.mjs. Do not edit: change the document",
    "// and run `npm run types` in site/types.",
    "",
  ].join("\n");
}

/** One document as an exported constant, typed with `satisfies` so its fields stay precise. */
function constant({ path, document }, name, type) {
  return `/** ${relative(ROOT, path)} */\nexport const ${name} = ${literal(document, "")} satisfies ${type};\n`;
}

/** A module of documents of one type, by name, and `all` of them in that order. */
function listModule(header, type, schemaPath, entries) {
  const sorted = [...entries].sort((a, b) => (a.document.name < b.document.name ? -1 : 1));
  const names = sorted.map((e) => identifier(e.document.name));
  const seen = new Set();
  for (const n of names) {
    if (seen.has(n)) throw new Error(`two ${type} documents are both ${n}`);
    seen.add(n);
  }
  return [
    documentsHeader(header),
    `import type { ${type} } from "${schemaPath}";`,
    "",
    ...sorted.map((e, i) => constant(e, names[i], type)),
    "/** Every document above, in name order. */",
    `export const all: ${type}[] = [${names.join(", ")}];`,
    "",
  ].join("\n");
}

/** catalog/ and examples/, validated against the schemas, as typed modules. */
function generateDocuments(ajv) {
  const byKind = new Map();
  const sources = [...walkFiles(join(ROOT, "catalog"), ".jsonc"), ...walkFiles(join(ROOT, "examples"), ".json")];
  for (const path of sources.sort()) {
    const document = JSON.parse(stripComments(readFileSync(path, "utf8")));
    const errors = errorsOf(ajv, document);
    if (errors.length) throw new Error(`${relative(ROOT, path)} is invalid:\n  ${errors.join("\n  ")}`);
    const kind = relative(ROOT, path).startsWith(`examples${sep}`) ? "example" : kindOf(document);
    if (!LISTS[kind] && !SINGLES[kind] && kind !== "example") throw new Error(`${relative(ROOT, path)}: no module for ${kind}`);
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push({ path, document });
  }

  const files = new Map();
  const index = [
    documentsHeader([
      "Every catalog/ document as a typed constant. Kinds with many documents",
      "are namespaces: `packages.theia` is catalog/packages/theia/package.jsonc,",
      "and each namespace's `all` lists its documents.",
    ]),
  ];
  for (const [kind, { module, type }] of Object.entries(LISTS)) {
    const header = [`The catalog/ ${kind} documents.`];
    files.set(join(GENERATED, `catalog/${module}.ts`), listModule(header, type, "../schema/input", byKind.get(kind) ?? []));
    index.push(`export * as ${module} from "./${module}";`);
  }
  index.push("");
  for (const [kind, type] of Object.entries(SINGLES)) {
    const entries = byKind.get(kind) ?? [];
    if (entries.length !== 1) throw new Error(`catalog/ must hold exactly one ${kind} document`);
    files.set(join(GENERATED, `catalog/${kind}.ts`), [
      documentsHeader([`The catalog/ ${kind} document.`]),
      `import type { ${type} } from "../schema/input";`,
      "",
      constant(entries[0], identifier(kind), type),
    ].join("\n"));
    index.push(`export { ${identifier(kind)} } from "./${kind}";`);
  }
  files.set(join(GENERATED, "catalog/index.ts"), `${index.join("\n")}\n`);
  files.set(
    join(GENERATED, "examples.ts"),
    listModule(["The system files in examples/."], "System", "./schema/input", byKind.get("example") ?? []),
  );
  return files;
}

// ---------------------------------------------------------------------------
// TypeScript checks

function typecheck(files, label) {
  const program = ts.createProgram(files, {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  for (const d of diagnostics) {
    const where = d.file ? `${relative(ROOT, d.file.fileName)}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}` : "";
    console.error(`${label}: ${where} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
  }
  return diagnostics.length;
}

// ---------------------------------------------------------------------------
// Checking

/** The examples' data, by transpiling generated/ and examples/ to JavaScript and importing them. */
async function exampleData() {
  const out = mkdtempSync(join(tmpdir(), "eclogite-examples-"));
  try {
    for (const file of [...walkFiles(GENERATED, ".ts"), ...walkFiles(join(TYPES, "examples"), ".ts")]) {
      const js = ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      const target = join(out, relative(TYPES, file)).replace(/\.ts$/, ".js");
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, js.replace(/from "(\.\.?\/[^"]+)"/g, 'from "$1.js"'));
    }
    const input = await import(pathToFileURL(join(out, "examples/linux-devbox-vm-input.js")).href);
    const compiled = await import(pathToFileURL(join(out, "examples/linux-devbox-vm-compiled.js")).href);
    return {
      configuration: JSON.parse(JSON.stringify(input.configuration)),
      compiled: JSON.parse(JSON.stringify(compiled.compiled)),
    };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

async function check(docs) {
  let failures = 0;
  const fail = (message) => {
    console.error(`check: ${message}`);
    failures++;
  };

  // 1. the schemas compile in strict mode
  let ajv;
  try {
    ajv = newAjv(docs);
    for (const uri of docs.keys()) ajv.getSchema(uri);
  } catch (e) {
    fail(`schemas: ${e.message}`);
    return failures;
  }

  // 2. generated/ is what the schemas and documents generate now; this also
  //    validates every catalog/ and examples/ document
  let generated;
  try {
    generated = generate(docs, ajv);
  } catch (e) {
    fail(e.message);
    return failures;
  }
  for (const [file, text] of generated) {
    if (!existsSync(file) || readFileSync(file, "utf8") !== text) {
      fail(`${relative(ROOT, file)} is stale: run npm run types in site/types`);
    }
  }
  for (const file of existsSync(GENERATED) ? walkFiles(GENERATED, "") : []) {
    if (!generated.has(file)) fail(`${relative(ROOT, file)} is not generated: run npm run types in site/types`);
  }

  // 3. generated/ and the examples type-check, and the examples' data is valid
  const sources = [...walkFiles(GENERATED, ".ts"), ...walkFiles(join(TYPES, "examples"), ".ts")];
  if (typecheck(sources, "types")) fail("generated/ or the examples do not type-check");
  const data = await exampleData();
  for (const e of errorsOf(ajv, data.configuration)) fail(`example configuration: ${e}`);
  for (const e of errorsOf(ajv, data.compiled)) fail(`example compiled system: ${e}`);
  console.log(`types: ${generated.size} generated files and the examples type-check; their data is valid`);

  return failures;
}

// ---------------------------------------------------------------------------

const command = process.argv[2] ?? "check";
const docs = loadSchemas();
if (command === "generate") {
  const files = generate(docs, newAjv(docs));
  rmSync(GENERATED, { recursive: true, force: true });
  for (const [file, text] of files) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  console.log(`wrote ${files.size} files in ${relative(ROOT, GENERATED)}`);
} else if (command === "check") {
  const failures = await check(docs);
  if (failures) {
    console.error(`${failures} problems`);
    process.exit(1);
  }
  console.log("ok");
} else {
  console.error("usage: generate.mjs generate | check");
  process.exit(2);
}
