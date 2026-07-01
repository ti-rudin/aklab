# Infrastructure — Traefik

## Prod (213.184.136.221)

Traefik v2.10 в Docker, конфиги на хосте:
- Static: `/etc/traefik/static.yml`
- Dynamic: `/etc/traefik/dynamic.yml`
- Docker compose: `/opt/traefik/docker-compose.yml`

## Маршруты

| Домен | Backend |
|---|---|
| `aklab.tirobots.ru` | `192.168.31.147:5174` (frontend) |
| `api-aklab.tirobots.ru` | `192.168.31.147:1338` (API) |

## Управление

```bash
# Перезапустить Traefik
ssh rudin@213.184.136.221 -p 5733 "cd /opt/traefik && docker compose restart"

# Проверить логи
ssh rudin@213.184.136.221 -p 5733 "cd /opt/traefik && docker compose logs --tail 50"

# Dashboard (с сервера)
curl http://localhost:8080
```

## Обновление конфигов

1. Отредактировать файлы на сервере
2. Скопировать обновлённые версии сюда (без секретов)
3. `docker compose restart traefik`
