# docker-deploy Specification

## Purpose
Ejecutar el juego completo (estáticos, relay WebSocket y API) como un único contenedor accesible por un solo puerto del host.

## Requirements

### Requirement: Un solo puerto
El contenedor SHALL servir `/` (juego), `/wheel/` (volante), `/api/*` y `/ws/*` desde un único proceso y puerto interno. `docker-compose.yml` SHALL publicar solo un puerto del host, tomado de `HOST_PORT` con valor por defecto 28473, enlazado a `0.0.0.0`.

#### Scenario: Arranque
- **WHEN** se ejecuta `docker compose up -d --build`
- **THEN** `GET http://localhost:28473/` y `GET http://localhost:28473/wheel/` devuelven 200 con HTML, y `GET /api/info` devuelve JSON con `lan_ips`

#### Scenario: Relay por el mismo puerto
- **WHEN** un cliente abre `ws://localhost:28473/ws/ABCD?role=host` y otro `?role=wheel`
- **THEN** ambos reciben `{"t":"peer","connected":true}` y un mensaje de uno llega al otro

### Requirement: Operación desatendida
El servicio SHALL reiniciarse con `restart: unless-stopped` y declarar un healthcheck sobre `GET /api/info`. La imagen MUST NOT incluir fastf1, playwright, numpy, scipy, pandas ni matplotlib; solo las dependencias del relay.

#### Scenario: Salud
- **WHEN** el contenedor lleva 30 s en marcha
- **THEN** `docker inspect` reporta `healthy`

### Requirement: URL pública para el QR
Si `PUBLIC_URL` está definida en el entorno, `/api/info` SHALL devolverla en `public_url` y el host SHALL usarla para el QR y el código mostrado.

#### Scenario: Con PUBLIC_URL
- **WHEN** el contenedor arranca con `PUBLIC_URL=https://f1.example.com`
- **THEN** `/api/info` devuelve `public_url` igual a ese valor

### Requirement: Publicación en GitHub
El repositorio SHALL contener Dockerfile, compose y `.dockerignore` versionados y el historial SHALL estar subido a `origin/main` sin force-push. Los archivos no versionados por decisión del usuario (`.claude/`, `CLAUDE.md`, `context.md`, `docs/`, `skills-lock.json`) MUST NOT subirse.

#### Scenario: Push
- **WHEN** termina el change
- **THEN** `git status` está limpio y `git log origin/main -1` coincide con `git log -1`
