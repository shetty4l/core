/**
 * Lightweight Result type for explicit error handling.
 *
 * Use Result for expected failures (invalid input, missing files, parse errors).
 * Use throw for programmer errors (invariant violations, bugs).
 */

// --- Result type ---

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = string> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

// --- Branded types ---

/**
 * A validated port number (1-65535).
 * Created only via `config.parsePort()`.
 */
export type Port = number & { readonly __brand: "Port" };
