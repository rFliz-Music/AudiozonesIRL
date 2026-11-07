// panel.js
// Side panel: mode controls, zone list, zone editor, import/export.

const $ = id => document.getElementById(id);


function audioLabel(audio) {
    if (!audio) return "No audio assigned";
    return audio.kind === "file"
        ? `File: ${audio.name}`
        : `URL: ${audio.name ?? audio.url}`;
}


export function createPanel(handlers) {

    const els = {
        btnSim: $("btn-sim"),
        btnGps: $("btn-gps"),
        btnStop: $("btn-stop"),
        statusDot: $("status-dot"),
        statusText: $("status-text"),
        statusDetail: $("status-detail"),
        statusActive: $("status-active"),

        zoneList: $("zone-list"),
        zoneEmpty: $("zone-empty"),

        editor: $("zone-editor"),
        name: $("zone-name"),
        audioLabel: $("zone-audio-label"),
        audioFile: $("zone-audio-file"),
        audioUrl: $("zone-audio-url"),
        audioUrlBtn: $("zone-audio-url-btn"),
        volume: $("zone-volume"),
        volumeOut: $("zone-volume-out"),
        loop: $("zone-loop"),
        fadeIn: $("zone-fade-in"),
        fadeOut: $("zone-fade-out"),
        preview: $("zone-preview"),
        del: $("zone-delete"),

        gpsMaxAccuracy: $("gps-max-accuracy"),

        btnExport: $("btn-export"),
        btnExample: $("btn-example"),
        fileImport: $("file-import")
    };

    let currentId = null;


    // --------------------------------------------------
    // MODE CONTROLS
    // --------------------------------------------------

    els.btnSim.addEventListener("click", handlers.onStartSim);
    els.btnGps.addEventListener("click", handlers.onStartGps);
    els.btnStop.addEventListener("click", handlers.onStop);

    function setMode(mode) {
        const running = mode !== "stopped";

        els.btnSim.hidden = running;
        els.btnGps.hidden = running;
        els.btnStop.hidden = !running;
        els.statusDot.classList.toggle("live", running);
        els.statusText.textContent = {
            stopped: "Stopped",
            sim: "Simulating",
            gps: "Tracking GPS"
        }[mode];
    }

    function setMaxAccuracy(metres) {
        els.gpsMaxAccuracy.value = metres;
    }

    els.gpsMaxAccuracy.addEventListener("change", () => {
        const metres = parseFloat(els.gpsMaxAccuracy.value);
        if (Number.isFinite(metres) && metres > 0) handlers.onMaxAccuracy(metres);
    });

    function setDetail(text) {
        els.statusDetail.textContent = text ?? "";
    }

    function setActiveNames(names) {
        els.statusActive.textContent = names.length ? names.join(", ") : "—";
    }


    // --------------------------------------------------
    // ZONE LIST
    // --------------------------------------------------

    function renderList(features, selectedId, activeIds) {

        els.zoneList.replaceChildren();
        els.zoneEmpty.hidden = features.length > 0;

        const active = new Set(activeIds);

        for (const { properties: p } of features) {

            const li = document.createElement("li");
            li.classList.toggle("selected", p.id === selectedId);
            li.classList.toggle("active", active.has(p.id));

            const name = document.createElement("span");
            name.textContent = p.name;

            const tag = document.createElement("span");
            tag.className = "tag";
            tag.textContent = active.has(p.id)
                ? "▶ playing"
                : p.audio ? "♪" : "no audio";

            li.append(name, tag);
            li.addEventListener("click", () => handlers.onSelect(p.id));

            els.zoneList.append(li);
        }
    }


    // --------------------------------------------------
    // ZONE EDITOR
    // --------------------------------------------------

    function showZone(feature) {

        currentId = feature?.properties.id ?? null;
        els.editor.hidden = !feature;

        if (!feature) return;

        const p = feature.properties;

        els.name.value = p.name ?? "";
        els.audioLabel.textContent = audioLabel(p.audio);
        els.audioUrl.value = p.audio?.kind === "url" ? p.audio.url : "";
        els.volume.value = p.volume;
        els.volumeOut.textContent = `${Math.round(p.volume * 100)}%`;
        els.loop.checked = !!p.loop;
        els.fadeIn.value = p.fadeIn;
        els.fadeOut.value = p.fadeOut;
        els.preview.disabled = !p.audio;
        setPreviewing(false);
    }

    function setPreviewing(on) {
        els.preview.textContent = on ? "■ Stop preview" : "▶ Preview";
    }

    const update = patch => currentId && handlers.onUpdate(currentId, patch);

    const seconds = input => {
        const n = parseFloat(input.value);
        return Number.isFinite(n) && n >= 0 ? n : 0;
    };

    els.name.addEventListener("input", () => update({ name: els.name.value }));

    els.volume.addEventListener("input", () => {
        const volume = parseFloat(els.volume.value);
        els.volumeOut.textContent = `${Math.round(volume * 100)}%`;
        update({ volume });
    });

    els.loop.addEventListener("change", () => update({ loop: els.loop.checked }));
    els.fadeIn.addEventListener("change", () => update({ fadeIn: seconds(els.fadeIn) }));
    els.fadeOut.addEventListener("change", () => update({ fadeOut: seconds(els.fadeOut) }));

    els.audioFile.addEventListener("change", () => {
        const file = els.audioFile.files[0];
        els.audioFile.value = "";
        if (file && currentId) handlers.onAudioFile(currentId, file);
    });

    els.audioUrlBtn.addEventListener("click", () => {
        const url = els.audioUrl.value.trim();
        if (url && currentId) handlers.onAudioUrl(currentId, url);
    });

    els.preview.addEventListener("click", () => currentId && handlers.onPreview(currentId));

    els.del.addEventListener("click", () => {
        if (currentId && confirm("Delete this zone?")) handlers.onDelete(currentId);
    });


    // --------------------------------------------------
    // IMPORT / EXPORT
    // --------------------------------------------------

    els.btnExport.addEventListener("click", handlers.onExport);
    els.btnExample.addEventListener("click", handlers.onLoadExample);

    els.fileImport.addEventListener("change", () => {
        const file = els.fileImport.files[0];
        els.fileImport.value = "";
        if (file) handlers.onImport(file);
    });


    return {
        setMode,
        setMaxAccuracy,
        setDetail,
        setActiveNames,
        renderList,
        showZone,
        setPreviewing
    };
}
