// storage.js
// Zone persistence (localStorage) and uploaded audio files (IndexedDB).

const ZONES_KEY = "audiozones.zones.v1";
const SETTINGS_KEY = "audiozones.settings.v1";

const DB_NAME = "audiozones";
const DB_STORE = "audio";


// --------------------------------------------------
// ZONES
// --------------------------------------------------

export function loadZones() {
    try {
        const raw = localStorage.getItem(ZONES_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}


export function saveZones(featureCollection) {
    try {
        localStorage.setItem(ZONES_KEY, JSON.stringify(featureCollection));
    } catch (error) {
        console.warn("Could not save zones:", error);
    }
}


export function loadSettings(defaults) {
    try {
        return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) };
    } catch {
        return { ...defaults };
    }
}


export function saveSettings(settings) {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch { /* non-essential */ }
}


export function downloadJSON(data, filename) {
    const blob = new Blob(
        [JSON.stringify(data, null, 2)],
        { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
}


export async function readJSONFile(file) {
    return JSON.parse(await file.text());
}


// --------------------------------------------------
// AUDIO FILES (IndexedDB)
// --------------------------------------------------

let dbPromise = null;

function openDB() {
    dbPromise ??= new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);

        request.onupgradeneeded = () => {
            request.result.createObjectStore(DB_STORE, { keyPath: "id" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    return dbPromise;
}


async function withStore(mode, fn) {
    const db = await openDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, mode);
        const request = fn(tx.objectStore(DB_STORE));

        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => reject(tx.error);
    });
}


/** Stores an uploaded file and returns an audio reference for a zone. */
export async function putAudioFile(file) {
    const id = crypto.randomUUID();

    await withStore("readwrite", store =>
        store.put({ id, name: file.name, blob: file })
    );

    return { kind: "file", id, name: file.name };
}


export async function getAudioBlob(id) {
    const record = await withStore("readonly", store => store.get(id));

    if (!record) throw new Error("Audio file not found on this device.");

    return record.blob;
}


export async function deleteAudioFile(id) {
    await withStore("readwrite", store => store.delete(id));
}
