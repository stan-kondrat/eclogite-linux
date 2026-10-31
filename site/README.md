# Website

This directory is the dependency-free static website source. It uses plain
HTML, CSS, SVG, and browser JavaScript—no framework, package manager, external
font, CDN, or runtime library.

Maintained files:

```text
site/
  index.html                 project overview
  packages.html              software catalog and dependency graph viewer
  machines.html              machine profile catalog and JSON definition builder
  docs.html                  documentation hub and single-file quick start
  getting-started.html       compatibility redirect to the overview section
  assets/styles.css          complete responsive visual system
  assets/site.js             shared navigation and catalog statistics
  assets/graph.js            SVG graph interaction and package inspector
  assets/machines.js         machine filters, profile cards, and JSON builder
  assets/catalog-data.js     temporary generated-data snapshot
  types/                     TypeScript types of every document format
```

`types/` is development tooling, not part of the published site. It is the
only place that uses Node: its own `package.json` pins Ajv and TypeScript,
and `generate.mjs` writes everything in `types/generated/`, never edited by
hand:

```text
types/generated/
  schema/input.ts       types of the documents the CLI reads, from ../schemas/
  schema/compiled.ts    types of the compiled lock, from ../schemas/lock.schema.json
  catalog/index.ts      every ../catalog/ document as a typed constant:
                        packages.theia, machines.utmVirtArm64, facts, ...
  catalog/<kind>.ts     one module per kind, each with `all` of its documents
  examples.ts           the system files in ../examples/
```

Generating validates every catalog document against the schemas first.
`types/examples/` is hand-written: a complete system on top of the generated
catalog, and its compiled form, which only the C tool's `eclogite lock` will
be able to produce. The Pages workflow leaves `types/` out of the staged site.

```sh
cd site/types
npm install
npm run types   # regenerate after a schema or catalog change
npm run check   # stale or invalid input, strict schema compile, everything type-checks, examples validate
```

The checked-in `catalog-data.js` is a temporary snapshot for this design phase;
it is not a second authoritative package database. Once the host tool exists,
`eclogite site` will parse the catalog's JSONC or JSON, validate every object
against versioned JSON Schema, resolve the selected graphs, and regenerate all
website data and package pages from that resolved model. The graph keeps
machine profiles, software profiles, and the system compositions that join
them as distinct node types.

The final static build contains:

```text
_site/
  index.html
  packages.html
  machines.html
  docs.html
  getting-started.html       compatibility redirect
  assets/
  data/catalog.json
  data/graph.json
  data/search-index.json
  packages/<name>/index.html
  machines/<name>/index.html
  systems/<name>/index.html
  docs/
  build-manifest.json
```

Machine statistics include profiles that are not yet selected by a buildable
system. The graph viewer shows only nodes reachable from its selected resolved
system, so a `profile-only` physical board does not appear as falsely buildable.

The graph viewer supports system and view filters, node-type filters, search,
transitive dependency/dependent tracing, pan, zoom, keyboard node selection,
node dragging, and a detailed relationship inspector. Rendering is entirely
client-side, but all graph data is validated and generated ahead of time.

The overview contains the first-machine workflow, while the Documentation page
collects the system-file reference rules and routes readers into the detailed
engineering documents. The overview's Nix, Guix, Docker/BuildKit, Yocto, and
Buildroot comparison is a
short presentation of the findings preserved under
`../docs/research/package-build-dsl/`. It compares design boundaries rather
than claiming feature parity or universal superiority. The overview also shows
the chosen build-runtime and remote-layer trust boundaries; those are design
contracts, not claims that the host executable is already implemented.

The GitHub Pages workflow in `../.github/workflows/pages.yml` validates the
checked-in site and publishes it as ordinary static files without Jekyll or a
site framework. The future generated build is described in `../docs/ci.md`.
