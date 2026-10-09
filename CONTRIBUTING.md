# Contributing

Use Node.js 24 LTS and `npm ci --ignore-scripts`. Write a failing behavior test first, implement the smallest coherent change, then run focused tests. Before submitting, run `npm run typecheck`, `npm test`, `npm run build`, `npm run verify:package`, and `git diff --check`.

Keep the five-tool contract, bounded queries/bootstrap, explicit project binding and evidence/hypothesis distinction intact. Test storage, recovery, concurrent writers, path containment and config approval carefully. Add synthetic fixtures only: no private source, raw host sessions, credentials or unrelated config values. Tests must configure temporary projects, never actual user/global/employer settings.

Built `plugin/dist/`, the generated `codex-plugin/` distribution, plugin license copies, local release output and `.feature-network/` are ignored. A public source archive includes the code, tests, dependencies lockfile and compact public contracts; local AGENTS instructions and planning history are excluded. Runtime dependencies are pinned and bundled; actual bundled package licenses are collected from the build metafile, including transitive packages. Review license changes rather than assuming our MIT license covers dependencies.

CI specifies Node 24 on Linux, macOS and Windows. Platform-specific tests must state their limits; passing contract tests do not replace real host or OS checks. Package metadata uses Agent Plugins 1.0 with client-specific namespaces; verify new host fields against current primary documentation. Keep setup additions-only, require exact receipt approval, and preserve project data/manual configuration during updates.

`npm run release:prepare -- --version 0.1.0` is local preparation from a clean validated Git revision. It creates a source/plugin archive, checksum manifest and report. Publishing, pushing, creating a release tag or changing user host settings requires a separate explicit instruction. No CI workflow publishes this project automatically.
