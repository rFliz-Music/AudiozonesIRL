import { createMapEditor } from "./map-editor.js";
import { createPanel } from "./panel.js";
import { createAudioEngine } from "./audio-engine.js";
import { createZoneTracker } from "./zone-tracker.js";
import { createGpsSource, createSimSource } from "./location.js";
import {
    loadZones,
    saveZones,
    loadSettings,
    saveSettings,
    downloadJSON,
    readJSONFile,
    putAudioFile,
    getAudioBlob,
    deleteAudioFile
} from "./storage.js";


const PREVIEW_ID = "__preview__";
const EXAMPLE_URL = "./example.json";

const settings = loadSettings({ gpsMaxAccuracy: 50 });

let zones = { type: "FeatureCollection", features: [] };
let mode = "stopped";
let source = null;
let lastPosition = null;


// --------------------------------------------------
// AUDIO
// --------------------------------------------------

const engine = createAudioEngine({
    async resolveAudio(ref) {
        if (ref.kind === "file") {
            return (await getAudioBlob(ref.id)).arrayBuffer();
        }
        const response = await fetch(ref.url);
        if (!response.ok) throw new Error(`HTTP ${response.status} loading ${ref.url}`);
        return response.arrayBuffer();
    }
});


function reportAudioError(zoneName, error) {
    console.error(error);
    panel.setDetail(`Couldn't play "${zoneName}": ${error.message}`);
}


// --------------------------------------------------
// ZONE TRACKING
// --------------------------------------------------

const tracker = createZoneTracker({

    maxAccuracy: settings.gpsMaxAccuracy,

    onEnter(feature) {
        const p = feature.properties;
        engine.start(p.id, p).catch(error => reportAudioError(p.name, error));
        refreshActive();
    },

    onExit(id) {
        engine.stop(id);
        refreshActive();
    }
});


function refreshActive() {
    const ids = tracker.activeIds();

    editor.setActiveZones(ids);
    renderList();

    panel.setActiveNames(
        zones.features
            .filter(f => ids.includes(f.properties.id))
            .map(f => f.properties.name)
    );
}


function handlePosition(position) {
    lastPosition = position;

    const accepted = tracker.update(position, zones.features, {
        immediate: position.simulated
    });

    if (!position.simulated) {
        panel.setDetail(
            accepted
                ? `GPS accuracy ± ${Math.round(position.accuracy)} m`
                : `GPS accuracy ± ${Math.round(position.accuracy)} m — worse than ${settings.gpsMaxAccuracy} m, ignoring`
        );
    }
}


// --------------------------------------------------
// MAP EDITOR
// --------------------------------------------------

const editor = createMapEditor({
    element: document.getElementById("map"),

    onChange(updated) {
        zones = updated;
        saveZones(zones);

        // Push live edits (volume, audio swaps…) to anything playing.
        for (const f of zones.features) {
            engine.update(f.properties.id, f.properties);
        }

        // Re-check containment: geometry may have moved, zones may be gone.
        if (lastPosition) {
            tracker.update(lastPosition, zones.features, { immediate: true });
        }

        renderList();
    },

    onSelect(id) {
        engine.stop(PREVIEW_ID, 0.1);
        panel.showZone(id ? editor.getZone(id) : null);
        renderList();
    }
});


function renderList() {
    panel.renderList(zones.features, editor.getSelectedId(), tracker.activeIds());
}


// --------------------------------------------------
// SCREEN WAKE LOCK (GPS stops when the screen locks)
// --------------------------------------------------

let wakeLock = null;

async function acquireWakeLock() {
    if (!("wakeLock" in navigator) || mode !== "gps") return;
    try {
        wakeLock = await navigator.wakeLock.request("screen");
    } catch (error) {
        console.warn("Wake lock unavailable:", error);
    }
}

function releaseWakeLock() {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
}

// The lock is dropped whenever the page is hidden; take it back on return.
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") acquireWakeLock();
});


// --------------------------------------------------
// MODES
// --------------------------------------------------

function startMode(nextMode) {
    // Must run synchronously inside the click for mobile audio unlock.
    engine.unlock();

    stopMode();

    mode = nextMode;

    source = mode === "sim"
        ? createSimSource({ map: editor.map, onPosition: handlePosition })
        : createGpsSource({
            map: editor.map,
            onPosition: handlePosition,
            onError(error, fatal) {
                panel.setDetail(error.message);
                if (fatal) stopMode();
            }
        });

    panel.setMode(mode);
    panel.setDetail(
        mode === "sim"
            ? "Drag the pink dot around the map to walk through zones."
            : "Waiting for the first GPS fix…"
    );

    if (!source.start()) stopMode();
    else acquireWakeLock();
}


function stopMode() {
    releaseWakeLock();
    source?.stop();
    source = null;
    lastPosition = null;
    tracker.reset();
    engine.stopAll(0.5);

    mode = "stopped";
    panel.setMode(mode);
}


// --------------------------------------------------
// PANEL
// --------------------------------------------------

const panel = createPanel({

    onStartSim: () => startMode("sim"),
    onStartGps: () => startMode("gps"),
    onStop: () => {
        stopMode();
        panel.setDetail("");
    },

    onMaxAccuracy(metres) {
        settings.gpsMaxAccuracy = metres;
        tracker.setMaxAccuracy(metres);
        saveSettings(settings);
    },

    onSelect: id => editor.focusZone(id),

    onUpdate: (id, patch) => editor.updateZone(id, patch),

    async onAudioFile(id, file) {
        const previous = editor.getZone(id)?.properties.audio;
        const audio = await putAudioFile(file);

        editor.updateZone(id, { audio });
        panel.showZone(editor.getZone(id));

        if (previous?.kind === "file") deleteAudioFile(previous.id);
    },

    onAudioUrl(id, url) {
        const previous = editor.getZone(id)?.properties.audio;
        const name = decodeURIComponent(url.split("/").pop().split("?")[0]) || url;

        editor.updateZone(id, { audio: { kind: "url", url, name } });
        panel.showZone(editor.getZone(id));

        if (previous?.kind === "file") deleteAudioFile(previous.id);
    },

    onPreview(id) {
        engine.unlock();

        if (engine.isPlaying(PREVIEW_ID)) {
            engine.stop(PREVIEW_ID, 0.1);
            panel.setPreviewing(false);
            return;
        }

        const p = editor.getZone(id)?.properties;
        if (!p?.audio) return;

        panel.setPreviewing(true);

        engine.start(
            PREVIEW_ID,
            { ...p, loop: false, fadeIn: 0.05, fadeOut: 0.1 },
            { onEnded: () => panel.setPreviewing(false) }
        ).catch(error => {
            panel.setPreviewing(false);
            reportAudioError(p.name, error);
        });
    },

    onDelete(id) {
        const audio = editor.getZone(id)?.properties.audio;
        editor.deleteZone(id);
        if (audio?.kind === "file") deleteAudioFile(audio.id);
    },

    onExport() {
        const project = editor.getZones();

        const local = project.features
            .filter(f => f.properties.audio?.kind === "file")
            .map(f => f.properties.name);

        if (local.length && !confirm(
            `These zones use uploaded files that won't exist on other devices:\n\n` +
            `${local.join(", ")}\n\n` +
            `Put the files in the repo's audio/ folder and use URLs like ` +
            `"audio/song.mp3" instead. Export anyway?`
        )) return;

        downloadJSON(project, "example.json");
    },

    async onImport(file) {
        try {
            loadProject(await readJSONFile(file));
        } catch (error) {
            alert(`Import failed: ${error.message}`);
        }
    },

    async onLoadExample() {
        if (zones.features.length &&
            !confirm("Replace the current zones with the bundled example?")) return;

        try {
            loadProject(await fetchExample());
        } catch (error) {
            alert(`Couldn't load the bundled example: ${error.message}`);
        }
    }
});


// --------------------------------------------------
// PROJECT LOADING
// --------------------------------------------------

function loadProject(data) {
    if (data?.type !== "FeatureCollection") {
        throw new Error("Not a GeoJSON FeatureCollection.");
    }

    tracker.reset();
    editor.setZones(data);
    zones = editor.getZones();
    saveZones(zones);
    editor.fitAll();
    refreshActive();
}


async function fetchExample() {
    const response = await fetch(EXAMPLE_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status} (is example.json in the repo?)`);
    return response.json();
}


// --------------------------------------------------
// INIT
// --------------------------------------------------

panel.setMode(mode);
panel.setMaxAccuracy(settings.gpsMaxAccuracy);

const saved = loadZones();

if (saved?.features?.length) {
    editor.setZones(saved);
    zones = editor.getZones();
    editor.fitAll();
    renderList();
} else {
    // First visit (e.g. on the phone): start from the bundled example, if any.
    renderList();
    fetchExample()
        .then(loadProject)
        .catch(() => { /* no example bundled — start empty */ });
}
