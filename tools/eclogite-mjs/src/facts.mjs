// Facts and predicates (docs/build-model.md, "Compatibility").
//
// A fact does not store a value; catalog/facts.jsonc says where to read it in
// each scope's document. Scopes: `target` (the platform merged with the ABI),
// `machine` (the merged machine) and `builder` (the toolchain's builder).
//
// Evaluation is two-valued for target, machine and `when` predicates; a fact
// the environment does not provide is an error that names it. Build
// predicates are evaluated three-valued at lock time (see buildAllows).

export class FactError extends Error {}

function pointer(doc, ptr) {
  let node = doc;
  for (const part of ptr.split("/").slice(1)) {
    if (node === null || typeof node !== "object" || !Object.hasOwn(node, part)) return undefined;
    node = node[part];
  }
  return node;
}

/** The target scope's document: the platform merged with the ABI. */
export function targetDocument(platform, abi) {
  return { ...platform, os: abi.os, libc: abi.libc, abi: abi.name };
}

function readFact(fact, scope, doc) {
  for (const ptr of fact.from?.[scope] ?? []) {
    if (ptr.startsWith("@")) return undefined;
    const raw = pointer(doc, ptr);
    if (raw === undefined) continue;
    const d = fact.derive;
    if (!d) return raw;
    if (d.collect) return [...new Set(raw.map((e) => e[d.collect]))].sort();
    if (d.sum) {
      let total = 0;
      for (const e of raw) {
        if (!Object.entries(d.sum.where).every(([k, v]) => e[k] === v)) continue;
        if (e[d.sum.field] === undefined) {
          if (d.sum.missing === "unbounded") return "unbounded";
          continue;
        }
        total += e[d.sum.field];
      }
      return total;
    }
  }
  return undefined;
}

/** Fact values of one scope, in fact-name order. */
export function scopeFacts(facts, scope, doc) {
  const out = {};
  for (const name of Object.keys(facts).sort()) {
    const v = readFact(facts[name], scope, doc);
    if (v !== undefined) out[name] = v;
  }
  return out;
}

/** An environment: fact values by name and the fact vocabulary. */
export function makeEnv(facts, ...valueSets) {
  const values = Object.assign({}, ...valueSets);
  return { facts, values };
}

function operandValue(op, env) {
  if (op !== null && typeof op === "object" && !Array.isArray(op)) {
    if (!(op.fact in env.values)) throw new FactError(`fact ${op.fact} is not provided here`);
    return env.values[op.fact];
  }
  return op;
}

function ordered(env, name, a, b) {
  const fact = env.facts[name];
  const family = env.values[fact.order_by];
  const list = fact.order?.[family];
  if (!list) throw new FactError(`fact ${name} has no order for ${fact.order_by} ${family}`);
  const ia = list.indexOf(a);
  const ib = list.indexOf(b);
  if (ia < 0 || ib < 0) throw new FactError(`${ia < 0 ? a : b} is not in the order of ${name} for ${family}`);
  return ia - ib;
}

function compare(env, name, op, have, want) {
  const type = env.facts[name].type;
  if (have === "unbounded") return op === "ge" || op === "gt" || op === "ne";
  switch (op) {
    case "eq": return have === want;
    case "ne": return have !== want;
    case "in": return want.includes(have);
    case "has": return have.includes(want);
    case "has_any": return want.some((w) => have.includes(w));
    default: {
      const c = type === "ordered" ? ordered(env, name, have, want) : have - want;
      return op === "ge" ? c >= 0 : op === "gt" ? c > 0 : op === "le" ? c <= 0 : c < 0;
    }
  }
}

export function evalPredicate(p, env) {
  const [key] = Object.keys(p);
  if (key === "all") return p.all.every((s) => evalPredicate(s, env));
  if (key === "any") return p.any.some((s) => evalPredicate(s, env));
  if (key === "not") return !evalPredicate(p.not, env);
  if (!(key in env.values)) throw new FactError(`fact ${key} is not provided here`);
  const have = env.values[key];
  return Object.entries(p[key]).every(([op, operand]) => compare(env, key, op, have, op === "in" || op === "has_any" ? operand : operandValue(operand, env)));
}

/**
 * Three-valued evaluation for build constraints at lock time: a fact the
 * environment cannot know yet (builder memory, the build host) is unknown.
 * Returns true, false or null (unknown).
 */
export function evalKnown(p, env) {
  const [key] = Object.keys(p);
  if (key === "all") {
    const r = p.all.map((s) => evalKnown(s, env));
    return r.includes(false) ? false : r.includes(null) ? null : true;
  }
  if (key === "any") {
    const r = p.any.map((s) => evalKnown(s, env));
    return r.includes(true) ? true : r.includes(null) ? null : false;
  }
  if (key === "not") {
    const r = evalKnown(p.not, env);
    return r === null ? null : !r;
  }
  if (!(key in env.values)) return null;
  const test = p[key];
  for (const operand of Object.values(test)) {
    if (operand && typeof operand === "object" && !Array.isArray(operand) && !(operand.fact in env.values)) return null;
  }
  return evalPredicate(p, env);
}

export const compactJson = (v) => JSON.stringify(v);
