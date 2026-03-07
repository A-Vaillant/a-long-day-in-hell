/**
 * Minimal ECS (Entity-Component-System) framework.
 *
 * Entities are integer IDs. Components are plain objects stored in typed Maps.
 * Systems are external functions that query the world for entities with
 * specific component sets.
 *
 * No inheritance, no classes for components. Data bags only.
 *
 * @module ecs.core
 */

export type Entity = number;

export type ComponentMap<T> = Map<Entity, T>;

export interface World {
    nextId: number;
    components: Map<string, ComponentMap<unknown>>;
}

/** Create a new empty world. */
export function createWorld(): World {
    return {
        nextId: 0,
        components: new Map(),
    };
}

/** Spawn a new entity. Returns its ID. */
export function spawn(world: World): Entity {
    return world.nextId++;
}

/** Get or create a component map for a given component key. */
function getMap<T>(world: World, key: string): ComponentMap<T> {
    let map = world.components.get(key);
    if (!map) {
        map = new Map();
        world.components.set(key, map);
    }
    return map as ComponentMap<T>;
}

/** Attach a component to an entity. Overwrites if already present. */
export function addComponent<T>(world: World, entity: Entity, key: string, data: T): void {
    getMap<T>(world, key).set(entity, data);
}

/** Remove a component from an entity. */
export function removeComponent(world: World, entity: Entity, key: string): void {
    const map = world.components.get(key);
    if (map) map.delete(entity);
}

/** Get a component for an entity, or undefined. */
export function getComponent<T>(world: World, entity: Entity, key: string): T | undefined {
    const map = world.components.get(key);
    return map ? (map as ComponentMap<T>).get(entity) : undefined;
}

/** Check if an entity has a component. */
export function hasComponent(world: World, entity: Entity, key: string): boolean {
    const map = world.components.get(key);
    return map ? map.has(entity) : false;
}

/**
 * Query for all entities that have ALL of the specified components.
 * Returns an iterator of [entity, ...componentValues] tuples.
 *
 * For efficiency, iterates over the smallest component map.
 */
export function query<T extends unknown[]>(
    world: World,
    keys: string[],
): [Entity, ...unknown[]][] {
    if (keys.length === 0) return [];

    const maps = keys.map(k => world.components.get(k));
    // If any component map doesn't exist, no entities match
    if (maps.some(m => !m)) return [];

    // Find smallest map to iterate
    let smallest = 0;
    let smallestSize = maps[0]!.size;
    for (let i = 1; i < maps.length; i++) {
        if (maps[i]!.size < smallestSize) {
            smallest = i;
            smallestSize = maps[i]!.size;
        }
    }

    const results: [Entity, ...unknown[]][] = [];
    const kLen = keys.length;
    for (const [entity] of maps[smallest]!) {
        let hasAll = true;
        const tuple: [Entity, ...unknown[]] = new Array(kLen + 1) as any;
        tuple[0] = entity;
        for (let i = 0; i < kLen; i++) {
            const val = maps[i]!.get(entity);
            if (val === undefined) {
                hasAll = false;
                break;
            }
            tuple[i + 1] = val;
        }
        if (hasAll) {
            results.push(tuple);
        }
    }
    return results;
}

/** Remove an entity and all its components. */
export function destroy(world: World, entity: Entity): void {
    for (const map of world.components.values()) {
        map.delete(entity);
    }
}

/** Get all entities that have a specific component. */
export function entitiesWith(world: World, key: string): Entity[] {
    const map = world.components.get(key);
    return map ? Array.from(map.keys()) : [];
}
