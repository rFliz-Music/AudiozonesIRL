// map-editor.js
// Leaflet map interface for creating and editing geographic zones.

import { createZoneTransform } from "./zone-transform.js";

const ZONE_STYLE = {
    color: "#20a987",
    weight: 2,
    opacity: 1,
    fillColor: "#35c7a0",
    fillOpacity: 0.22
};

const ACTIVE_STYLE = {
    ...ZONE_STYLE,
    color: "#7aa2ff",
    fillColor: "#7aa2ff",
    fillOpacity: 0.35
};

const SELECTED_STYLE = {
    color: "#f5c76b",
    weight: 3
};

export const ZONE_DEFAULTS = {
    type: "audiozone",
    audio: null,        // { kind: "file", id, name } | { kind: "url", url, name }
    volume: 0.8,
    loop: true,
    fadeIn: 2,
    fadeOut: 2
};


export function createMapEditor({
    element,
    onChange = () => {},
    onSelect = () => {}
}) {

    // --------------------------------------------------
    // MAP INITIALIZATION
    // --------------------------------------------------

    const map = L.map(element).setView([20, 0], 2);

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }
    ).addTo(map);


    // --------------------------------------------------
    // ZONE LAYERS
    // --------------------------------------------------

    const layers = L.featureGroup().addTo(map);

    let selectedId = null;
    let activeIds = new Set();

    const transform = createZoneTransform({
        map,
        onCommit: () => onChange(getZones())
    });


    // --------------------------------------------------
    // INTERNAL HELPERS
    // --------------------------------------------------

    function findLayer(id) {
        let result = null;

        layers.eachLayer(layer => {
            if (layer.feature?.properties?.id === id) {
                result = layer;
            }
        });

        return result;
    }


    function styleLayer(layer) {
        const id = layer.feature?.properties?.id;

        const base = activeIds.has(id) ? ACTIVE_STYLE : ZONE_STYLE;

        layer.setStyle(
            id === selectedId
                ? { ...base, ...SELECTED_STYLE }
                : base
        );
    }


    function selectZone(id) {
        if (id === selectedId) return;

        selectedId = id;

        layers.eachLayer(styleLayer);

        transform.attach(id ? findLayer(id) : null);

        onSelect(id);
    }


    function attachLayer(feature, layer) {
        layer.feature = feature;

        styleLayer(layer);

        layer.on("click", event => {
            L.DomEvent.stopPropagation(event);
            selectZone(feature.properties.id);
        });

        layers.addLayer(layer);
    }


    // --------------------------------------------------
    // GEOJSON
    // --------------------------------------------------

    function getZones() {

        const features = [];

        layers.eachLayer(layer => {

            const feature = layer.toGeoJSON();

            feature.properties = {
                ...layer.feature.properties
            };

            features.push(feature);

        });

        return {
            type: "FeatureCollection",
            features
        };
    }


    function getZone(id) {
        return getZones().features.find(f => f.properties.id === id) ?? null;
    }


    function setZones(featureCollection) {

        transform.detach();
        layers.clearLayers();

        const previousSelection = selectedId;
        selectedId = null;

        featureCollection?.features?.forEach(feature => {

            if (feature.geometry?.type !== "Polygon") return;

            feature.properties = {
                ...ZONE_DEFAULTS,
                ...feature.properties,
                id: feature.properties?.id ?? crypto.randomUUID()
            };

            L.geoJSON(feature).eachLayer(child => {
                attachLayer(feature, child);
            });

        });

        if (previousSelection !== null) onSelect(null);
    }


    // --------------------------------------------------
    // DRAWING CONTROLS
    // --------------------------------------------------

    const drawControl = new L.Control.Draw({

        position: "topleft",

        draw: {

            polygon: {
                allowIntersection: false,
                showArea: true,
                shapeOptions: ZONE_STYLE
            },

            polyline: false,
            rectangle: false,
            circle: false,
            circlemarker: false,
            marker: false

        },

        edit: {
            featureGroup: layers,
            edit: true,
            remove: true
        }

    });

    map.addControl(drawControl);


    // --------------------------------------------------
    // DRAW EVENTS
    // --------------------------------------------------

    map.on(L.Draw.Event.CREATED, event => {

        const feature = event.layer.toGeoJSON();

        feature.properties = {
            ...ZONE_DEFAULTS,
            id: crypto.randomUUID(),
            name: `Zone ${layers.getLayers().length + 1}`
        };

        attachLayer(feature, event.layer);

        onChange(getZones());

        selectZone(feature.properties.id);

    });


    map.on(L.Draw.Event.EDITED, () => {
        onChange(getZones());
    });


    map.on(L.Draw.Event.DELETED, () => {
        if (selectedId && !findLayer(selectedId)) {
            selectZone(null);
        }
        onChange(getZones());
    });


    map.on("click", () => selectZone(null));


    // Hide move/scale handles while Leaflet.Draw tools are active.
    map.on("draw:drawstart draw:editstart draw:deletestart", () => transform.setEnabled(false));
    map.on("draw:drawstop draw:editstop draw:deletestop", () => transform.setEnabled(true));


    // --------------------------------------------------
    // PUBLIC API
    // --------------------------------------------------

    function focusZone(id) {

        const layer = findLayer(id);

        if (!layer) return;

        selectZone(id);

        map.fitBounds(
            layer.getBounds(),
            {
                padding: [35, 35],
                maxZoom: 18
            }
        );
    }


    function deleteZone(id) {

        const layer = findLayer(id);

        if (!layer) return;

        layers.removeLayer(layer);

        if (selectedId === id) {
            selectZone(null);
        }

        onChange(getZones());
    }


    function updateZone(id, patch) {

        const layer = findLayer(id);

        if (!layer) return;

        layer.feature.properties = {
            ...layer.feature.properties,
            ...patch
        };

        onChange(getZones());
    }


    function setActiveZones(ids) {
        activeIds = new Set(ids);
        layers.eachLayer(styleLayer);
    }


    function fitAll() {
        if (layers.getLayers().length) {
            map.fitBounds(layers.getBounds(), { padding: [35, 35], maxZoom: 18 });
        }
    }


    return {
        map,
        getZones,
        getZone,
        setZones,
        selectZone,
        focusZone,
        deleteZone,
        updateZone,
        setActiveZones,
        fitAll,
        getSelectedId: () => selectedId,
        destroy() {
            map.remove();
        }
    };

}
