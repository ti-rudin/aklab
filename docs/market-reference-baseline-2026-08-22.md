# MarketReference baseline — 2026-08-22

## Решение

Для отсутствующих `apartment`/`land` используются медианы текущего production-каталога AKLAB.
Решение подтверждено владельцем 2026-08-22.

| city | property_type | price_per_sqm, ₽ | n |
|---|---|---:|---:|
| moscow | apartment | 319700 | 24 |
| moscow | land | 121300 | 7 |
| mo | apartment | 110200 | 76 |
| mo | land | 1000 | 124 |
| other | apartment | 57700 | 389 |
| other | land | 2400 | 878 |

## Provenance

- Production snapshot SHA: `5612451a6f842b00f72163ca303886d0981d78d7`.
- Snapshot time: 2026-08-22.
- Input: `properties.price_per_sqm` for the exact `city/property_type` pair.
- Filter: `price_per_sqm IS NOT NULL AND price_per_sqm > 0`.
- Median: middle value for odd `n`; arithmetic mean of two middle values for even `n`.
- Persisted value rounded to the nearest 100 ₽/м², matching the existing 18-reference convention.
- `effective_from`: `2026-08-22`.
- `is_active`: `true`.
- `created_by`: `AKLAB production snapshot median`.

These are source-mix auction/listing baselines, not independent completed-sale market data. Circularity and source concentration are accepted for this baseline; existing references use the same `Авто (медиана из city/type)` convention.

## Release/apply boundary

Production v1.1.98 rejects `apartment` and `land` in both the MarketReference schema and internal lookup allowlist. Apply only after the enum/controller release is deployed and verified.

Create rows through the authenticated AKLAB Admin `POST /api/market-references` route. Before writes, require no existing active row for each exact pair. After writes, read back all six exact rows and verify the internal service-token lookup returns them; do not use raw SQL.

Suggested notes format:

`Авто (медиана из <city>/<property_type>; snapshot 2026-08-22; n=<N>; runtime 5612451)`

Adding references affects future analyzer jobs. Existing rows already persisted with `deviation_percent=0` are not automatically reanalyzed; a separate controlled reanalysis operation is required if historical recalculation is desired.
