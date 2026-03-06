export const TICKS_PER_HOUR: number;
export const HOURS_PER_DAY: number;
export const TICKS_PER_DAY: number;
export const DAY_START_HOUR: number;
export const LIGHTS_OFF_HOUR: number;
export const LIGHTS_ON_TICKS: number;
export const RESET_HOUR_TICK: number;

export function defaultTickState(): { tick: number; day: number };

export function advanceTick(
    state: { tick: number; day: number },
    n: number,
): { state: { tick: number; day: number }; events: string[] };

export function isLightsOn(tick: number): boolean;
export function isResetHour(tick: number): boolean;
export function tickToTimeString(tick: number): string;
export function ticksUntilDawn(tick: number): number;
export function hoursUntilDawn(tick: number): number;
