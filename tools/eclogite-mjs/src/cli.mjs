// Command line: `eclogite-mjs [OPTIONS] COMMAND [ARGUMENT...]`.
//
// Exit codes follow docs/cli.md: 0 success, 2 usage, 10 validation failure,
// 11 resolution or stale-lock failure, 22 comparison mismatch (verify),
// 30 filesystem or internal failure.

import { EXIT, ExitError } from "./project.mjs";
import { formatDiagnostic } from "./jsonc.mjs";

const OPTIONS = {
  "--catalog": { key: "catalog", arg: true, repeat: true },
  "--project": { key: "project", arg: true },
  "--schemas": { key: "schemas", arg: true },
  "-c": { key: "config", arg: true },
  "--config": { key: "config", arg: true },
  "--machine": { key: "machine", arg: true },
  "--software": { key: "software", arg: true },
  "--lock": { key: "lock", arg: true },
  "-o": { key: "output", arg: true },
  "--output": { key: "output", arg: true },
  "--format": { key: "format", arg: true },
  "--kind": { key: "kind", arg: true },
  "--root": { key: "root", arg: true },
  "--source-date-epoch": { key: "sourceDateEpoch", arg: true },
  "--host": { key: "host", arg: true },
  "--reverse": { key: "reverse" },
  "--all": { key: "all" },
  "--locked": { key: "locked" },
  "--update": { key: "update" },
  "--allow-unpinned": { key: "allowUnpinned" },
  "-h": { key: "help" },
  "--help": { key: "help" },
};

const COMMANDS = {
  validate: ["./cmd-validate.mjs", "validate [PATH...]"],
  resolve: ["./cmd-lock.mjs", "resolve (--config SYSTEM | --machine M --software S)"],
  lock: ["./cmd-lock.mjs", "lock (--config SYSTEM | --machine M --software S) [--output FILE] [--allow-unpinned]"],
  plan: ["./cmd-lock.mjs", "plan (--config SYSTEM | --machine M --software S) [--lock FILE]"],
  graph: ["./cmd-lock.mjs", "graph (--config SYSTEM | ...) [--kind full|packages] [--format tree|dot|json] [--root NODE] [--reverse]"],
  why: ["./cmd-lock.mjs", "why (--config SYSTEM | ...) NODE [--all]"],
  explain: ["./cmd-lock.mjs", "explain (--config SYSTEM | ...) [--lock FILE]"],
  verify: ["./cmd-verify.mjs", "verify [--update]"],
  canonical: ["./cmd-validate.mjs", "canonical FILE"],
};

export function usage() {
  return `usage: eclogite-mjs [OPTIONS] COMMAND [ARGUMENT...]

commands:
${Object.values(COMMANDS).map(([, u]) => `  ${u}`).join("\n")}

options: --catalog DIR (repeatable)  --project DIR  -c/--config FILE  -o/--output FILE
         --machine NAME --software NAME  --lock FILE  --format F  --update
         --source-date-epoch N  --host ARCH  --allow-unpinned  -h/--help
`;
}

export function parseArgs(argv) {
  const opts = { catalog: [] };
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.startsWith("--") ? a.indexOf("=") : -1;
    const name = eq > 0 ? a.slice(0, eq) : a;
    const spec = OPTIONS[name];
    if (a.startsWith("-") && a !== "-") {
      if (!spec) throw new ExitError(EXIT.usage, `unknown option ${name}`);
      if (spec.arg) {
        const value = eq > 0 ? a.slice(eq + 1) : argv[++i];
        if (value === undefined) throw new ExitError(EXIT.usage, `${name} needs a value`);
        if (spec.repeat) opts[spec.key].push(value);
        else opts[spec.key] = value;
      } else opts[spec.key] = true;
    } else args.push(a);
  }
  return { opts, args };
}

export async function main(argv) {
  try {
    const { opts, args } = parseArgs(argv);
    const [command, ...rest] = args;
    if (opts.help || !command) {
      process.stdout.write(usage());
      return command || opts.help ? EXIT.ok : EXIT.usage;
    }
    const entry = COMMANDS[command];
    if (!entry) throw new ExitError(EXIT.usage, `unknown command ${command}`);
    const mod = await import(entry[0]);
    return await mod.run(command, rest, opts);
  } catch (e) {
    if (e instanceof ExitError) {
      process.stderr.write(`eclogite-mjs: ${e.message}\n`);
      return e.code;
    }
    if (e && e.file !== undefined && e.line !== undefined) {
      process.stderr.write(`${formatDiagnostic(e)}\n`);
      return EXIT.invalid;
    }
    process.stderr.write(`eclogite-mjs: internal error: ${e && e.stack ? e.stack : e}\n`);
    return EXIT.internal;
  }
}
