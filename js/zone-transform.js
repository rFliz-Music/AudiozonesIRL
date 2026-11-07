// zone-transform.js
// Move / uniform-scale handles for the selected zone polygon.
// Works in screen (layer-point) space so shapes don't distort with latitude.

function handleIcon(className, symbol) {
    return L.divIcon({
        className: "",
        html: `<div class="zone-handle ${className}">${symbol}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
    });
}


export function createZoneTransform({ map, onCommit = () => {} }) {

    const handles = L.layerGroup().addTo(map);

    const moveHandle = L.marker([0, 0], {
        icon: handleIcon("move", "✥"),
        draggable: true,
        zIndexOffset: 900,
        title: "Drag to move zone"
    });

    const scaleHandle = L.marker([0, 0], {
        icon: handleIcon("scale", "⤡"),
        draggable: true,
        zIndexOffset: 900,
        title: "Drag to scale zone"
    });

    let layer = null;
    let enabled = true;
    let start = null;   // { rings: Point[][], center: Point, anchor: Point }


    // --------------------------------------------------
    // GEOMETRY
    // --------------------------------------------------

    const toPoint = latlng => map.latLngToLayerPoint(latlng);

    function begin(anchorLatLng) {
        start = {
            rings: layer.getLatLngs().map(ring => ring.map(toPoint)),
            center: toPoint(layer.getBounds().getCenter()),
            anchor: toPoint(anchorLatLng)
        };
    }

    function apply(transformPoint) {
        layer.setLatLngs(
            start.rings.map(ring =>
                ring.map(p => map.layerPointToLatLng(transformPoint(p)))
            )
        );
    }

    function translateTo(latlng) {
        const delta = toPoint(latlng).subtract(start.anchor);
        apply(p => p.add(delta));
    }

    function scaleTo(latlng) {
        const startDist = start.anchor.distanceTo(start.center);
        const factor = Math.max(
            toPoint(latlng).distanceTo(start.center) / startDist,
            0.02
        );
        const c = start.center;
        apply(p => c.add(p.subtract(c).multiplyBy(factor)));
    }

    function finish() {
        start = null;
        positionHandles();
        onCommit(layer);
    }

    function positionHandles() {
        if (!layer) return;
        const bounds = layer.getBounds();
        moveHandle.setLatLng(bounds.getCenter());
        scaleHandle.setLatLng(bounds.getNorthEast());
    }


    // --------------------------------------------------
    // HANDLE DRAGS (mouse + touch)
    // --------------------------------------------------

    moveHandle.on("dragstart", () => begin(moveHandle.getLatLng()));
    moveHandle.on("drag", () => translateTo(moveHandle.getLatLng()));
    moveHandle.on("dragend", finish);

    scaleHandle.on("dragstart", () => begin(scaleHandle.getLatLng()));
    scaleHandle.on("drag", () => {
        scaleTo(scaleHandle.getLatLng());
        moveHandle.setLatLng(layer.getBounds().getCenter());
    });
    scaleHandle.on("dragend", finish);


    // --------------------------------------------------
    // BODY DRAG (mouse: grab the polygon itself)
    // --------------------------------------------------

    function onBodyDown(event) {
        if (!enabled || event.originalEvent.button !== 0) return;

        L.DomEvent.stop(event);
        map.dragging.disable();
        begin(event.latlng);

        let moved = false;

        const onMove = e => {
            moved = true;
            translateTo(e.latlng);
            positionHandles();
        };

        const onUp = () => {
            map.off("mousemove", onMove);
            L.DomEvent.off(document, "mouseup", onUp);
            map.dragging.enable();
            if (moved) finish();
            else start = null;
        };

        map.on("mousemove", onMove);
        L.DomEvent.on(document, "mouseup", onUp);
    }


    // --------------------------------------------------
    // PUBLIC API
    // --------------------------------------------------

    function refresh() {
        const show = enabled && layer;

        if (show) {
            positionHandles();
            handles.addLayer(moveHandle).addLayer(scaleHandle);
        } else {
            handles.clearLayers();
        }

        layer?.getElement()?.classList.toggle("zone-draggable", !!show);
    }

    function attach(nextLayer) {
        if (layer === nextLayer) return;

        detach();
        layer = nextLayer;
        layer?.on("mousedown", onBodyDown);
        refresh();
    }

    function detach() {
        layer?.off("mousedown", onBodyDown);
        layer?.getElement()?.classList.remove("zone-draggable");
        layer = null;
        refresh();
    }

    /** Disabled while Leaflet.Draw is drawing / editing / deleting. */
    function setEnabled(value) {
        enabled = value;
        refresh();
    }

    return { attach, detach, setEnabled };
}
