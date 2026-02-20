import { afterAll, describe, expect, test } from "bun:test";
import {
  corsHeaders,
  corsPreflightResponse,
  createServer,
  healthResponse,
  jsonError,
  jsonOk,
} from "../src/http";

// --- corsHeaders ---

describe("corsHeaders", () => {
  test("returns CORS headers", () => {
    const headers = corsHeaders();
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(headers["Access-Control-Allow-Methods"]).toContain("GET");
    expect(headers["Access-Control-Allow-Headers"]).toContain("Content-Type");
  });

  test("returns a fresh copy each time", () => {
    const a = corsHeaders();
    const b = corsHeaders();
    expect(a).toEqual(b);
    a["X-Custom"] = "mutated";
    expect(b["X-Custom"]).toBeUndefined();
  });
});

// --- corsPreflightResponse ---

describe("corsPreflightResponse", () => {
  test("returns 204 with CORS headers", () => {
    const res = corsPreflightResponse();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

// --- jsonOk ---

describe("jsonOk", () => {
  test("returns JSON with 200 by default", async () => {
    const res = jsonOk({ message: "hello" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ message: "hello" });
  });

  test("supports custom status code", () => {
    const res = jsonOk({ id: 1 }, 201);
    expect(res.status).toBe(201);
  });

  test("includes CORS headers", () => {
    const res = jsonOk({});
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

// --- jsonError ---

describe("jsonError", () => {
  test("returns error JSON", async () => {
    const res = jsonError(400, "bad request");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "bad request" });
  });

  test("includes CORS headers", () => {
    const res = jsonError(500, "oops");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

// --- healthResponse ---

describe("healthResponse", () => {
  test("returns standard health fields", async () => {
    const startTime = Date.now() - 5000;
    const res = healthResponse("1.0.0", startTime);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("healthy");
    expect(body.version).toBe("1.0.0");
    expect(typeof body.uptime).toBe("number");
    expect((body.uptime as number) >= 4).toBe(true);
  });

  test("includes extra fields when provided", async () => {
    const res = healthResponse("1.0.0", Date.now(), {
      memories: 42,
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.memories).toBe(42);
  });
});

// --- createServer ---

describe("createServer", () => {
  let server: ReturnType<typeof createServer> | null = null;

  afterAll(() => {
    if (server) server.stop();
  });

  test("starts server and responds to /health", async () => {
    server = createServer({
      port: 0, // random available port
      version: "0.1.0-test",
      onRequest: () => null,
    });

    const res = await fetch(`http://localhost:${server.port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("healthy");
    expect(body.version).toBe("0.1.0-test");
  });

  test("handles OPTIONS preflight", async () => {
    const res = await fetch(`http://localhost:${server!.port}/anything`, {
      method: "OPTIONS",
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("routes to onRequest for custom paths", async () => {
    server!.stop();
    server = createServer({
      port: 0,
      version: "0.1.0-test",
      onRequest: (_req, url) => {
        if (url.pathname === "/echo") return jsonOk({ path: "/echo" });
        return null;
      },
    });

    const res = await fetch(`http://localhost:${server.port}/echo`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.path).toBe("/echo");
  });

  test("returns 404 when onRequest returns null", async () => {
    const res = await fetch(`http://localhost:${server!.port}/nonexistent`);
    expect(res.status).toBe(404);
  });

  test("uses custom onHealth handler when provided", async () => {
    server!.stop();
    server = createServer({
      port: 0,
      version: "0.1.0-test",
      onRequest: () => null,
      onHealth: (version, startTime) =>
        jsonOk(
          {
            status: "degraded",
            version,
            uptime: Math.floor((Date.now() - startTime) / 1000),
            providers: { openai: "down" },
          },
          503,
        ),
    });

    const res = await fetch(`http://localhost:${server.port}/health`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("degraded");
    expect(body.version).toBe("0.1.0-test");
    expect(body.providers).toEqual({ openai: "down" });
  });

  test("supports async onHealth handler", async () => {
    server!.stop();
    server = createServer({
      port: 0,
      version: "0.1.0-test",
      onRequest: () => null,
      onHealth: async (version, startTime) => {
        await Promise.resolve(); // simulate async work
        return healthResponse(version, startTime, { db: "ok" });
      },
    });

    const res = await fetch(`http://localhost:${server.port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("healthy");
    expect(body.db).toBe("ok");
  });
});
