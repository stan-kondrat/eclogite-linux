// The golden projection of a resolution (tests/reference/README.md): what the
// reference results record, in a fixed order, and the error text of a failure.

import { sortedMap } from "./canonical.mjs";

export function goldenResult(r) {
  const choices = {};
  for (const [cap, c] of r.choices) choices[cap] = { provider: c.provider, reason: c.reason.endsWith("override") ? "override" : c.reason };
  const config = {};
  for (const [pkg, opts] of r.config) {
    config[pkg] = {};
    for (const [o, { value, source }] of opts) {
      config[pkg][o] = {
        value,
        source: source.kind === "dependency" ? source.package : source.kind === "software" ? "software" : source.kind === "device" ? `device ${source.model}` : `implied by ${source.option}`,
      };
    }
  }
  const sortConfig = Object.fromEntries(Object.keys(config).sort().map((p) => [p, sortedMap(config[p])]));
  return {
    machine: r.machine.name,
    software: r.software.name,
    abi: r.abi.name,
    triplet: r.triplet,
    closure: [...r.closure],
    choices: sortedMap(choices),
    compilers: sortedMap(Object.fromEntries([...r.compilers].map(([n, c]) => [n, c.name]))),
    config: sortConfig,
    owned_files: sortedMap(Object.fromEntries([...r.owned].map(([path, o]) => [path, `${o.provider}:${o.capability}`]))),
    tests: r.tests.map((t) => t.id),
  };
}

export function goldenFailure(machine, software, error) {
  return { machine, software, error: error.message };
}
