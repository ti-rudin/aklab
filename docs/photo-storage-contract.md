# Контракт persistent private photo-root

## Назначение

API reader и `photo-fetcher` writer используют один и тот же приватный корень
фотографий. Корень находится вне immutable release и web root и передаётся
явным окружением процесса.

Каноническая переменная:

```text
PRIVATE_PHOTO_ROOT=/absolute/path/to/persistent/private-photos
```

`PRIVATE_PHOTO_ROOT` должен быть непустым абсолютным путём. Использование
`process.cwd()`, пути относительно release или любого другого неявного
fallback запрещено.

## Переходный alias

`PHOTOS_BASE_DIR` сохранён только как временный deprecated alias для поэтапного
cutover старого storage-контракта:

- если задан только `PRIVATE_PHOTO_ROOT`, используется он;
- если canonical отсутствует, но `PHOTOS_BASE_DIR` задан как абсолютный путь,
  он временно принимается;
- если заданы обе переменные, их нормализованные значения должны совпадать;
  конфликт останавливает storage fail-closed;
- пустое, относительное или отсутствующее значение не является допустимым
  корнем; при отсутствии обеих переменных storage не инициализируется и не
  используется.

После отдельной миграции alias должен быть удалён из server env и шаблонов.

## Layout и URL

Оба процесса разрешают физический путь только в layout:

```text
<PRIVATE_PHOTO_ROOT>/<documentId>/<filename>
```

Публичный URL, сохраняемый в `Property.photos`, остаётся совместимым с текущим
контрактом базы данных:

```text
/photos/<documentId>/<filename>
```

URL не должен содержать абсолютный filesystem root.

## Path safety

До разрешения физического пути проверяются `documentId` и `filename`:

- каждый является одним непустым path segment;
- запрещены `/`, `\\`, `.`, `..`, NUL, абсолютные POSIX/Windows paths и
  traversal;
- итоговый `path.resolve()` дополнительно проверяется на lexical containment
  внутри нормализованного root.

API controller сначала выполняет положительную property-scope проверку. При
отказе возвращается неразличимый `404`, и до проверки path/root и до любого
`fs.access`/`fs.readFile` дело не доходит. MIME allowlist (`jpg`, `jpeg`, `png`,
`webp`, `gif`) и private cache headers сохраняются.

Worker получает property до записи, затем создаёт только каталог объекта в
настроенном root и пишет валидированные изображения через тот же resolver.

## Rollout boundary

Этот slice не выполняет runtime/deploy side effects и не переносит существующие
файлы. Отдельной управляемой операцией должны быть:

1. выбор и создание persistent root на целевом сервере;
2. серверная настройка `PRIVATE_PHOTO_ROOT` для API и photo-fetcher;
3. временная публикация `PHOTOS_BASE_DIR`, если она нужна для transitional
   периода, с доказательством, что оба пути совпадают;
4. копирование/миграция существующих `api/data/photos` с counts и checksums;
5. проверка private permissions, загрузки и scope denial;
6. удаление public/static originals и symlink — только после acceptance.

Создание symlink, перенос/удаление фотографий, chown/chmod, изменение реальных
server env и PM2 restart не входят в этот commit. Symlink не считается заменой
контракту и является отдельным cutover-решением.

## Rollback risk

Rollback этого slice — откат одного commit. Однако rollback после отдельной
физической миграции не является автоматически безопасным: старый код ожидает
legacy layout, а новый код — `PRIVATE_PHOTO_ROOT`. До cutover нужно сохранить
исходники, manifest/counts/checksums и предыдущие server env. При аварии сначала
вернуть совместимый env/alias и приложение на exact предыдущий SHA, а затем
разбираться с физическими копиями; не удалять данные во время rollback.
