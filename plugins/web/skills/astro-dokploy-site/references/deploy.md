# Deploy: Dockerfile, Dokploy and nginx

Take Node, nginx and pnpm versions from the project's `package.json` and existing Dockerfile; the `<...>` below are those values.

## Dockerfile

Two stages, at the repo root. Build with pnpm through `corepack` pinned to the `packageManager` version, then copy `dist` and the conf into nginx.

```dockerfile
FROM node:<major>-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@<version from packageManager> --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Monorepo: copy each workspace package.json by hand, and add a line for every new package.
COPY packages/ui/package.json packages/ui/
COPY packages/icons/package.json packages/icons/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:<version>-alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
```

A single-package site drops the workspace lines. In a monorepo, the Dockerfile still lives at the root of the repo, not in the app folder.

## Dokploy

In the application's build settings:

- **Dockerfile path:** `Dockerfile`
- **Docker Context Path:** `.`

Set both even though they look like defaults. With the context field empty, Dokploy uses the Dockerfile's own folder as the context (Dokploy issue 5417), so a Dockerfile outside the root cannot see the lockfile or the workspace packages, and the build "cannot find its files".

CI proves the image builds before Dokploy does: add a `docker build .` step after `pnpm build` and before Lighthouse.

## nginx

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  absolute_redirect off;          # behind Dokploy's proxy, redirects must stay relative
  gzip on;
  gzip_static on;
  gzip_types text/css application/javascript application/json image/svg+xml;   # no application/wasm
  error_page 404 /404.html;

  include /etc/nginx/security-headers.conf;

  location ~* \.mjs$ {
    default_type text/javascript;   # nginx's mime.types has no mjs; with nosniff, import() fails
    include /etc/nginx/security-headers.conf;
  }
  location ~* \.wasm$ {
    default_type application/wasm;
    include /etc/nginx/security-headers.conf;
  }
  location /_astro/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    include /etc/nginx/security-headers.conf;
  }
  location / {
    try_files $uri $uri/index.html =404;
    include /etc/nginx/security-headers.conf;
  }
}
```

`security-headers.conf`:

```nginx
add_header Content-Security-Policy "frame-ancestors 'none'" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
```

Why every `location` repeats them: an `add_header` inside a `location` replaces all the `add_header` lines inherited from the `server`. Either repeat the headers or `include` the same file in each one, as above; the `/_astro/` block keeps its own `Cache-Control` next to the include.

Why `frame-ancestors 'none'` comes from nginx: a CSP delivered in a `<meta>` cannot carry `frame-ancestors`. nginx's CSP header holds only that directive; the page's own policy stays in the generated `<meta>`.
