# @shetty4l/core

Shared infrastructure primitives for Bun/TypeScript services. Zero external dependencies.

## Modules

| Module | Purpose |
|--------|---------|
| `result` | `Result<T, E>` type, `ok`/`err` constructors, `Port` branded type |
| `version` | Read VERSION file from project root with fallback |
| `config` | XDG directory resolution, path expansion, env var interpolation, JSON config loading |
| `cli` | Argument parsing, command dispatch, uptime formatting |
| `daemon` | PID-file daemon management (start/stop/restart/status) |
| `http` | Bun.serve wrapper with CORS, health endpoint, JSON response helpers |
| `signals` | Graceful shutdown handler (SIGINT/SIGTERM) |

## Install

Configure GitHub Packages registry:

```toml
# bunfig.toml
[install.scopes]
"@shetty4l" = "https://npm.pkg.github.com"
```

Then:

```bash
bun add @shetty4l/core
```

## Usage

### Namespace imports (recommended)

```typescript
import { config, http, cli, daemon, readVersion, onShutdown } from "@shetty4l/core";

const version = readVersion(import.meta.dir);
const port = config.parsePort(process.env.PORT!, "PORT");
const cfg = config.loadJsonConfig({ name: "myservice", defaults: { port: 3000 } });

const server = http.createServer({
  port: 3000,
  version,
  onRequest: (req, url) => {
    if (url.pathname === "/echo") return http.jsonOk({ ok: true });
    return null; // 404
  },
});

onShutdown(() => server.stop());
```

### Sub-path imports

```typescript
import { parsePort, loadJsonConfig } from "@shetty4l/core/config";
import { createServer, jsonOk } from "@shetty4l/core/http";
import { createDaemonManager } from "@shetty4l/core/daemon";
```

## Result type

Functions that can fail with expected errors return `Result<T, E>` instead of throwing:

```typescript
import { config } from "@shetty4l/core";

const result = config.parsePort("abc", "PORT");
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}
// result.value is a branded Port type — validated once, trusted downstream
```

**Convention:** `Result` for expected failures (invalid input, missing files). `throw` for programmer errors (bugs, invariant violations).

## Development

```bash
bun install
bun run validate    # typecheck + lint + format:check + test
bun run format      # auto-fix formatting
bun test            # run tests only
```
