# СИГМА Бюджет - данни

Това хранилище съдържа официалните входове, регистрите, TypeScript обработката, независимите проверки и неизменните издания на СИГМА Бюджет. Кодът на сайта се поддържа в midt-bg/sigma-budget.

Необходими са Node 24 и pnpm 10.33.0. Входовете са в Git; не са нужни тайни или отделен входен архив.

```sh
pnpm install --frozen-lockfile
pnpm build
# Историята удостоверява историческите производители от предишното хранилище.
git -c credential.helper= fetch --no-tags --filter=blob:none https://github.com/midt-bg/sigma-budget main:refs/remotes/source/main
node packages/ingest/dist/validate/cli.js --live --only REGISTRY
./budget check-site --inputs .
./budget build --commit HEAD --inputs . --out /tmp/new-budget-candidate --build-date 2026-11-16
./budget validate --release /tmp/new-budget-candidate --inputs .
```

Изходната директория трябва да е нова и извън хранилището. Датата е изричен параметър. Процедурата за обновяване е в [docs/release.md](docs/release.md), а форматът на данните е в [docs/data-spec.md](docs/data-spec.md).

Сайтът получава проверено издание с `pnpm data:pull --commit <пълен-sha>` в собственото си хранилище. Без `--commit` се взема текущият `main` на това хранилище. Командата изтегля анонимно, проверява формата, манифеста, разписката, размерите и SHA-256 преди приемане и записва избрания commit и `release_id` в `data/release.lock.json`.

След сливане на data PR обновеното копие и lock файлът се предлагат с PR в сайта. Merge там публикува staging; production следва отделното изрично одобрение и версия на сайта. Това хранилище не изпраща данни към сайта и не зависи от неговия код.

```sh
pnpm format:check
pnpm typecheck
pnpm test -- --coverage
pnpm check:coverage
node --test scripts/ci-gates.test.mjs
```

Приносът следва [AGENTS.md](AGENTS.md). Release PR се слива с merge commit. Официалните оригинали и изтеглените входове остават байт по байт. Публикуването в продукция изисква изрично одобрение от собственика.
