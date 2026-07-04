# Changelog

## [1.0.85] — 2026-07-04

### Изменено
- refactor: настройки с табами — Дайджест, Правила, Парсеры, Эталоны (3c24c5a)
- refactor: табы на /properties — Все объекты, В фокусе, В работе (83fe985)

## [1.0.84] — 2026-07-03

### Исправлено
- fix: changelog дублирование — AI prompt + дедупликация
- fix: seeder обновляет пароль test user при каждом запуске
- fix: property-events создаются через ORM вместо raw SQL
- fix: detectCity regex — дефис убран из character class

### Изменено
- chore: remove temp fix script
- docs: обновление compact-doc v1.0.84 — detectCity, parse_depth, таймаут, permissions
