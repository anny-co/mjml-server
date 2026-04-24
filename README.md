# mjml-server

A self-hosted alternative to the mjml API. Built with [Fastify](https://fastify.dev/) and MJML 5.

The API is compatible with https://mjml.io/api in that it only exposes one
endpoint - `/v1/render`, but doesn't require authentication. You should probably
run this within your own private network.

## Features

- MJML 5 with htmlnano + cssnano minification
- In-process LRU response cache (sha256-keyed)
- Optional cluster mode using all CPU cores
- HTTP basic auth or shared-token auth
- Structured JSON logs (pino) with auth-header redaction
- Prometheus metrics at `/metrics` (render histogram, counters, cache size, default Node metrics)
- Healthcheck endpoints for k8s: `/healthz`, `/livez`, `/readyz`

## Why?

You're writing an app in another language than Javascript and need to interop
with MJML. Instead of embedding NodeJS in your Python image you can call MJML
compilation over HTTP.

You can alternatively use the [MJML API](https://mjml.io/api), but it's
currently invite only and has privacy implications (do you want your emails to
be sent to yet another third party?).

For an elaborate discussion see: https://github.com/mjmlio/mjml/issues/340

## Usage

```
docker run -p 8080:80 ghcr.io/anny-co/mjml-server
```

```
$ http POST localhost:8080/v1/render
HTTP/1.1 200 OK
Connection: keep-alive
Content-Length: 2141
Content-Type: application/json; charset=utf-8
Date: Mon, 15 Jul 2019 12:26:48 GMT
ETag: W/"85d-hn49R397DBvYcOi5/4cb+gcoi/I"
X-Powered-By: Express

{
    "html": "\n    <!doctype html>\n    ..."
}
```

## Configuration

Configure the server either with environment variables or with a `.env` file in the server's root directory:

```sh
HOST=0.0.0.0
PORT=80
WORKERS=auto                 # number of cluster workers; "auto" = CPU count, 1 = no clustering

# mjml configuration (mjml v5)
KEEP_COMMENTS=true
BEAUTIFY=false               # output beautification (htmlnano-driven in v5)
MINIFY=false                 # output minification (htmlnano + cssnano in v5)
SANITIZE_STYLES=false        # sanitize template variables in CSS before PostCSS/minification
VALIDATION_LEVEL=soft        # "strict", "soft", "skip"
MAX_BODY_BYTES=1048576       # request body limit in bytes (Fastify uses bytes, not "1mb")

# response cache (in-memory LRU keyed by sha256(mjml + config))
CACHE_ENABLED=true           # set to false to disable
CACHE_MAX=500                # max entries
CACHE_TTL_MS=0               # 0 = no TTL

# observability
METRICS_ENABLED=true         # exposes Prometheus metrics at GET /metrics

# authentication configuration
AUTH_ENABLED=false
AUTH_TYPE=none # "basic", "token", "none"
BASIC_AUTH_PASSWORD=
BASIC_AUTH_USERNAME=
AUTH_TOKEN=
```

Responses include an `X-Cache: HIT|MISS` header when caching is enabled.

## Development

```sh
yarn install
yarn test    # node --test
yarn lint    # eslint (flat config, neostandard)
yarn start   # node index.js
```

Requires Node.js ≥20. CI matrix runs on Node 20, 22, and 24.

## Authentication

When exposing the mjml API server to the web, you can opt-in to use authentication.

Available options are

- (a) HTTP basic auth
- (b) Predefined token in query parameter `?token` or as HTTP header `X-Authentication-Token`

See the above section for required configuration values.
