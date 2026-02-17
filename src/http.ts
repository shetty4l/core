/**
 * HTTP server infrastructure.
 *
 * Shared Bun.serve wrapper with automatic CORS handling,
 * health endpoint, and JSON response utilities.
 */

// --- Constants ---

const CORS_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// --- Response utilities ---

/**
 * Standard CORS headers for local-first services.
 * Returns a fresh copy to prevent mutation.
 */
export function corsHeaders(): Record<string, string> {
  return { ...CORS_HEADERS };
}

/**
 * CORS preflight response (204 No Content).
 */
export function corsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/**
 * JSON success response with CORS headers.
 */
export function jsonOk(body: unknown, status: number = 200): Response {
  return Response.json(body, { status, headers: corsHeaders() });
}

/**
 * JSON error response with CORS headers.
 */
export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: corsHeaders() });
}

/**
 * Health endpoint response with standard fields.
 * Pass `extra` to include service-specific health data.
 */
export function healthResponse(
  version: string,
  startTime: number,
  extra?: Record<string, unknown>,
): Response {
  return jsonOk({
    status: "healthy",
    version,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    ...extra,
  });
}

// --- Server ---

export interface ServerOpts {
  /** Service name used as log prefix (e.g. "synapse"). */
  name?: string;
  /** Port to listen on. */
  port: number;
  /** Hostname to bind to. Defaults to "127.0.0.1". */
  host?: string;
  /** Service version string (included in /health response). */
  version: string;
  /**
   * Application request handler.
   * Called for all requests that are NOT OPTIONS preflight or GET /health.
   * Return `null` to signal "not found" (server will return 404).
   */
  onRequest: (
    req: Request,
    url: URL,
  ) => Response | Promise<Response> | null | Promise<Response | null>;
}

export interface HttpServer {
  /** Actual port the server is listening on. */
  port: number;
  /** Stop the server. */
  stop: () => void;
}

/**
 * Create and start an HTTP server with automatic CORS and /health handling.
 *
 * Request handling order:
 *   1. OPTIONS -> CORS preflight response
 *   2. GET /health -> standard health response
 *   3. Everything else -> `opts.onRequest()`
 *   4. If onRequest returns null -> 404
 */
export function createServer(opts: ServerOpts): HttpServer {
  const { port, host = "127.0.0.1", version, onRequest, name } = opts;
  const startTime = Date.now();
  const prefix = name ? `${name}: ` : "";

  const server = Bun.serve({
    port,
    hostname: host,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      if (req.method === "OPTIONS") {
        return corsPreflightResponse();
      }

      if (url.pathname === "/health" && req.method === "GET") {
        return healthResponse(version, startTime);
      }

      try {
        const result = await onRequest(req, url);
        if (result === null) {
          return jsonError(404, `Not found: ${url.pathname}`);
        }
        return result;
      } catch (error) {
        console.error(`${prefix}HTTP request error:`, error);
        return jsonError(
          500,
          error instanceof Error ? error.message : "Internal server error",
        );
      }
    },
  });

  return {
    port: server.port ?? port,
    stop: () => server.stop(),
  };
}
