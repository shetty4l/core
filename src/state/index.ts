/**
 * State persistence module.
 *
 * Provides decorator-based state persistence with auto-save to SQLite.
 *
 * @example
 * ```ts
 * import { Persisted, Field, StateLoader } from '@shetty4l/core/state';
 *
 * @Persisted('my_state')
 * class MyState {
 *   @Field() counter: number = 0;
 *   @Field({ type: 'date' }) lastUpdated: Date | null = null;
 * }
 *
 * const loader = new StateLoader(db);
 * const state = loader.load(MyState, 'my-key');
 * state.counter += 1;  // Auto-saves after 100ms
 * await loader.flush(); // Force immediate save
 * ```
 */

export type { FieldOptions } from "./decorators";
// Decorators
export { Field, Persisted } from "./decorators";

// Loader
export { StateLoader } from "./loader";

// Types
export type { ClassMeta, FieldMeta, FieldType } from "./types";
