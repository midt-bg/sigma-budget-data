# Registered TypeScript production import

`budget-ts build` now assembles the registered current sources, executes the existing `wave13bStages` graph, runs all 26 domain groups plus REGISTRY, and packages the actual outputs through the release-build lifecycle. `./budget` is the normal Node dispatcher, keeping compiled workspace tools current through Turbo.

```sh
pnpm install --frozen-lockfile
pnpm --filter @sigma-budget/etl... build
./budget build --commit HEAD --inputs /acquired-snapshot \
  --out /owned/new-candidate --build-date 2026-11-10
./budget validate --release /owned/new-candidate --inputs /acquired-snapshot
./budget reproduce --manifest /owned/new-candidate/manifest.json \
  --originals /acquired-snapshot --out /owned/new-replay
BUDGET_CANDIDATE=/owned/new-candidate pnpm --filter @sigma-budget/web... build
```

Every candidate/replay destination must be new and outside the checkout and source/dependency trees. Build dates are explicit UTC dates. `validate` authenticates and numerically rebuilds the recorded candidate through local reproduction; it does not merely trust its stored report. Source roots contain `data/originals` and `data/cache`, optionally an authenticated source-client snapshot. Committed authored inputs come from the recorded Git commit. No acquisition occurs during a build.
