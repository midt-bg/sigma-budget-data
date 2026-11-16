# Offline импорт и candidate пакет

`./budget` използва Node 24 и фиксираните workspace зависимости. Новите издания изпълняват реалните четци, общия TypeScript граф и всичките 26 групи + REGISTRY. Нужни са вече придобити оригинали и кешове според регистрите; offline build не сваля източници.

От корена на хранилището:

```bash
pnpm install --frozen-lockfile
./budget build --commit HEAD --inputs /absolute/path/to/acquired-inputs \
  --out /absolute/new/candidate --build-date 2026-11-10
./budget validate --release /absolute/new/candidate --inputs /absolute/path/to/acquired-inputs
```

Входната директория съдържа `data/originals/` и `data/cache/`. Изходът е нова директория извън checkout-а с `data/`, `manifest.json`, `validation.json` и `receipt.json`. Няма запис в checkout `data/release/`, remote pointer или публикуване. Само изричното `build --site` записва локалните checkout данни. Launcher-ът използва Turbo, за да построи променения код и да използва кешираните workspace инструменти; не инсталира зависимости.

## Извличане и свежест

Build експортира посочения commit и автентикира цялата входна верига. Реалните PDF/XLS/XLSX/DOCX/HTML и API readers проверяват наличните intermediates срещу източниците; разлика спира изпълнението, без да заменя входа. Регистрираните възстановими липсващи intermediates се генерират само в собствен scratch. ZIP архивите, acquisition записите и членовете се сверяват с pins. Манифестът разграничава прочетени източници, извлечения и новогенерирани intermediates.

Кодът, pins и `data/inputs/` идват от commit-а. Неприключена редакция в `--inputs/data/inputs/` не е нов release input; копирането на променен ZIP не го прави доверен. Нова публикация изисква преглед на acquisition метаданните и pins. Отделна подготовка на физическите документи може да се изпълни в нова директория:

```bash
./budget prepare --inputs /absolute/path/to/acquired-inputs --out /absolute/new/prepared --build-date 2026-11-10
```

За изолиран candidate се използва `budget build`, без ръчна последователност от readers. `budget validate` взима build датата от манифеста и възпроизвежда пакета с реалните числови проверки. Подробните договори и команди са в [production-typescript-import.md](production-typescript-import.md).
