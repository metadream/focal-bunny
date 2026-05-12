# Bunny — Agent Guide

## Runtime & Package Manager

- **Bun only.** This is a [Bun](https://bun.sh) project. Never use `node`, `npm`, `npx`, `yarn`, or `pnpm`.
- The only `package.json` devDependency is `@types/bun`. Install with `bun install`.
- Lockfile is `bun.lock` (gitignored). No `package-lock.json` or `yarn.lock` exists.
- Published to [JSR](https://jsr.io) as `@bunny/bunny`, not npm. Import via `jsr:@bunny/bunny`.

## Project Structure

- `bunny.ts` — Framework core (exports `Bunny`, `Context`, `HttpError`). The app entrypoint.
- `stache.ts` — Standalone Stache template engine (custom syntax, not Handlebars/Mustache).
- `examples/` — Working example app. Import framework via relative path `"../bunny"`.
- No tests, no CI, no linter, no formatter configured anywhere.

## Running

```bash
bun run examples/server.ts
```

The framework relies on `Bun.file()` and `Bun.serve` compatibility. Apps export `default app` (a `Bunny` instance with a `.fetch()` method) for Bun to serve.

## Template Engine (Stache)

Custom syntax in `stache.ts`. Key differences from common engines:

| Syntax | Meaning |
|--------|---------|
| `{{=expr}}` | Output expression |
| `{{? condition}}` / `{{?? condition}}` / `{{?}}` | if / else if / endif |
| `{{~ arr: val : idx}}` / `{{~}}` | for loop / endfor |
| `{{@ file}}` | Include partial |

Configured via `app.engine(tmplRoot, globalVars?)`.

## Key Conventions

- Route handler can return: `Response`, `string` (rendered as HTML), `object` (rendered as JSON), or `null`/`undefined` (204 No Content).
- Route priority: static paths > `:param` paths > `*` wildcards (sorted automatically).
- `c.status()` and `c.header()` are chainable setters, not final — they accumulate until the handler returns.
- `app.route(prefix, sub)` merges routes, middlewares, and (if not already set) the error handler from the sub-instance.
- `HttpError` is the only built-in error class. Unhandled non-HttpError exceptions get status 500.
- Static file handler (`app.static`) automatically protects against path traversal (`..` and `~` blocked).

## TypeScript

- `tsconfig.json`: `strict: true`, `noEmit: true`, `moduleResolution: bundler`, `types: ["bun"]`.
- Framework is plain TS with no build step — Bun runs `.ts` directly.
