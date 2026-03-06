/**
 * Engine core — pure logic, no DOM.
 *
 * Defines the GameState interface, Screen contract, and batch tick
 * processing with boundary event registry.
 *
 * @module engine.core
 */
import { advanceTick } from "./tick.core.js";
export function createBoundaryRegistry() {
    const registry = {
        _handlers: {},
        on(event, handler) {
            if (!this._handlers[event])
                this._handlers[event] = [];
            this._handlers[event].push(handler);
        },
        fire(event) {
            const handlers = this._handlers[event];
            if (!handlers)
                return;
            for (const handler of handlers) {
                try {
                    handler();
                }
                catch (err) {
                    console.error("Boundary handler error (" + event + "):", err);
                }
            }
        },
    };
    return registry;
}
/** Safety cap: 10 in-game days. */
const MAX_ADVANCE_TICKS = 2400;
/**
 * Advance time by n ticks, firing boundary event handlers in chronological
 * order. Pure with respect to its own state — handlers are closures that
 * may mutate external state.
 */
export function processTime(tickState, n, registry) {
    const clamped = Math.min(Math.max(1, n), MAX_ADVANCE_TICKS);
    const result = advanceTick(tickState, clamped);
    for (const event of result.events) {
        registry.fire(event);
    }
    return {
        tickEvents: result.events,
        days: result.state.day - tickState.day,
        finalTick: result.state.tick,
        finalDay: result.state.day,
    };
}
