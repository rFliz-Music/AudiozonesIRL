// zone-tracker.js
// Decides which zones the player is inside, with hysteresis against GPS jitter.

/** Ray-casting point-in-ring test. Coordinates are [lng, lat]. */
function inRing([x, y], ring) {
    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];

        if ((yi > y) !== (yj > y) &&
            x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }

    return inside;
}


export function containsPoint(geometry, point) {
    if (geometry?.type !== "Polygon") return false;

    const [outer, ...holes] = geometry.coordinates;

    return inRing(point, outer) && !holes.some(hole => inRing(point, hole));
}


/**
 * @param {object} options
 * @param {number} options.enterAfter  consecutive "inside" fixes needed to enter
 * @param {number} options.exitAfter   consecutive "outside" fixes needed to exit
 * @param {number} options.maxAccuracy fixes less accurate than this (metres) are ignored
 * @param {(feature) => void} options.onEnter
 * @param {(id: string) => void} options.onExit
 */
export function createZoneTracker({
    enterAfter = 2,
    exitAfter = 3,
    maxAccuracy = 35,
    onEnter = () => {},
    onExit = () => {}
} = {}) {

    const state = new Map();  // zone id -> { inside, streak }


    /**
     * @param {{lat, lng, accuracy}} position
     * @param {object[]} features GeoJSON features
     * @param {{immediate?: boolean}} options immediate skips hysteresis (simulator, edits)
     * @returns {boolean} false if the fix was ignored for poor accuracy
     */
    function update(position, features, { immediate = false } = {}) {

        const seen = new Set(features.map(f => f.properties.id));

        // Zones that were deleted while we were inside them.
        for (const [id, s] of state) {
            if (!seen.has(id)) {
                state.delete(id);
                if (s.inside) onExit(id);
            }
        }

        if (!immediate && position.accuracy > maxAccuracy) return false;

        const point = [position.lng, position.lat];

        for (const feature of features) {

            const id = feature.properties.id;
            const s = state.get(id) ?? { inside: false, streak: 0 };
            state.set(id, s);

            const inside = containsPoint(feature.geometry, point);

            if (inside === s.inside) {
                s.streak = 0;
                continue;
            }

            s.streak++;

            const needed = inside ? enterAfter : exitAfter;

            if (immediate || s.streak >= needed) {
                s.inside = inside;
                s.streak = 0;
                inside ? onEnter(feature) : onExit(id);
            }
        }

        return true;
    }


    /** Exits every zone (e.g. when tracking stops). */
    function reset() {
        const exited = activeIds();
        state.clear();
        exited.forEach(id => onExit(id));
    }


    function setMaxAccuracy(metres) {
        maxAccuracy = metres;
    }


    function activeIds() {
        return [...state].filter(([, s]) => s.inside).map(([id]) => id);
    }


    return { update, reset, activeIds, setMaxAccuracy };
}
