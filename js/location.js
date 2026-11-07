// location.js
// Position sources: real GPS, and a draggable simulated player for desk testing.
// Both emit { lat, lng, accuracy, simulated }.

function playerIcon(className) {
    return L.divIcon({
        className: "",
        html: `<div class="player-dot ${className}"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9]
    });
}


export function createGpsSource({ map, onPosition, onError }) {

    let watchId = null;
    let marker = null;
    let accuracyCircle = null;
    let centered = false;


    function handle(position) {
        const { latitude: lat, longitude: lng, accuracy } = position.coords;
        const latlng = [lat, lng];

        if (!marker) {
            accuracyCircle = L.circle(latlng, {
                radius: accuracy,
                color: "#7aa2ff",
                weight: 1,
                fillOpacity: 0.1,
                interactive: false
            }).addTo(map);

            marker = L.marker(latlng, {
                icon: playerIcon(""),
                interactive: false,
                zIndexOffset: 1000
            }).addTo(map);
        } else {
            marker.setLatLng(latlng);
            accuracyCircle.setLatLng(latlng).setRadius(accuracy);
        }

        if (!centered) {
            centered = true;
            map.setView(latlng, Math.max(map.getZoom(), 17));
        }

        onPosition({ lat, lng, accuracy, simulated: false });
    }


    function start() {
        if (!("geolocation" in navigator)) {
            onError(new Error("This browser does not support geolocation."));
            return false;
        }
        if (!window.isSecureContext) {
            onError(new Error("GPS requires HTTPS (or localhost)."));
            return false;
        }

        centered = false;

        watchId = navigator.geolocation.watchPosition(handle, error => {
            const messages = {
                1: "Location permission was denied.",
                2: "Position unavailable. Try moving outdoors.",
                3: "GPS timed out; still waiting for a fix."
            };
            onError(new Error(messages[error.code] ?? error.message), error.code === 1);
        }, {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 20000
        });

        return true;
    }


    function stop() {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        watchId = null;
        marker?.remove();
        accuracyCircle?.remove();
        marker = accuracyCircle = null;
    }


    return { start, stop };
}


export function createSimSource({ map, onPosition }) {

    let marker = null;


    function emit() {
        const { lat, lng } = marker.getLatLng();
        onPosition({ lat, lng, accuracy: 0, simulated: true });
    }


    function start(latlng = map.getCenter()) {
        marker = L.marker(latlng, {
            icon: playerIcon("sim"),
            draggable: true,
            autoPan: true,
            zIndexOffset: 1000
        }).addTo(map);

        marker.on("drag", emit);
        emit();

        return true;
    }


    function stop() {
        marker?.remove();
        marker = null;
    }


    return { start, stop };
}
