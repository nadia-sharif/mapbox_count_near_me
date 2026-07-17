// Set your Mapbox access token
mapboxgl.accessToken = "";

// Keep track of the last clicked location globally for safe travel mode toggling
let lastClickedLngLat = null;

// Initialise map centering directly on Melbourne CBD
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/light-v11', // Clean base style so colors pop
    center: [144.9631, -37.8136],
    zoom: 13,
    minZoom: 6,
    maxZoom: 20
});

map.on('load', () => {
    // 1. Set up an empty placeholder GeoJSON data source for the Isochrone shapes
    map.addSource('iso-source', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: []
        }
    });

    // 2. Add the drawing layer styled specifically with the policy color palette
    map.addLayer({
        id: 'iso-layer',
        type: 'fill',
        source: 'iso-source',
        layout: {},
        paint: {
            // Match the color to the 'contour' metric returned from Mapbox (5, 10, or 20)
            'fill-color': [
                'match',
                ['get', 'contour'],
                5, '#10B981',   // 5 Min - Emerald Green
                10, '#F59E0B',  // 10 Min - Amber Yellow
                20, '#EF4444',  // 20 Min - Crimson Red
                '#6B7280'       // Fallback gray
            ],
            'fill-opacity': 0.20, // Clear translucency to keep background street layout legible
            'fill-outline-color': 'rgba(255,255,255,0.5)'
        }
    });

    // 3. Add a clean point marker for the exact origin point clicked by the user
    map.addSource('origin-source', {
        type: 'geojson',
        data: {
            type: 'FeatureCollection',
            features: []
        }
    });

    map.addLayer({
        id: 'origin-layer',
        type: 'circle',
        source: 'origin-source',
        paint: {
            'circle-radius': 6,
            'circle-color': '#111827',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF'
        }
    });

    // 1. Create a dynamic source for live Mapbox Tilequery POI data
    map.addSource('osm-pois', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    // 1. Render captured locations using Mapbox's built-in Maki Icons
    map.addLayer({
        id: 'osm-poi-symbols',
        type: 'symbol',
        source: 'osm-pois',
        layout: {
            // Match the Mapbox 'maki' property tag value directly to a sprite name
            'icon-image': [
                'match',
                ['get', 'maki'],
                'cafe', 'cafe',
                'restaurant', 'restaurant',
                'school', 'school',
                'college', 'college',
                'pharmacy', 'pharmacy',
                'grocery', 'grocery',
                'clothing-store', 'clothing-store',
                'hairdresser', 'hairdresser',
                'bakery', 'bakery',
                'alcohol-shop', 'alcohol-shop',
                'shop', 'shop',
                'bus', 'bus',
                'fuel', 'fuel',
                'parking', 'parking',
                'marker' // Fallback icon
            ],
            'icon-size': 1.5,
            'icon-allow-overlap': true
        }
    });

    // 3. Render neat floating text labels right above the circles
    map.addLayer({
        id: 'osm-poi-labels',
        type: 'symbol',
        source: 'osm-pois',
        layout: {
            'text-field': ['get', 'name'],
            'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
            'text-size': 12,
            'text-offset': [0, 0.5],
            'text-anchor': 'top'
        },
        paint: {
            'text-color': [
                'match',
                ['get', 'maki'],
                // Cafes & Dining (Warm Tones)
                'cafe', '#f0690e', 'bakery', '#f0690e',
                'restaurant', '#eb28aa', 'fast-food', '#eb28aa',
                'bar', '#7209b7', 'pub', '#7209b7',
                // Essentials (Cool Tones)
                'grocery', '#059669', 'supermarket', '#059669',
                'pharmacy', '#2EC4B6', 'hospital', '#2EC4B6', 'doctor', '#2EC4B6',
                // Infrastructure / Education (Blues/Purples)
                'school', '#4361EE', 'college', '#4361EE', 'university', '#4361EE',
                'bus', '#3a0ca3', 'rail', '#3a0ca3',
                // Default text fallback color
                '#4b5563'
            ],
            'text-halo-color': '#FFFFFF',
            'text-halo-width': 1.5
        }
    });
}); // map loads end

// Add zoom and rotation controls to the top right corner
map.addControl(new mapboxgl.NavigationControl(), 'top-right');

// Master execution block for processing catchment queries
function generateCatchmentAnalysis(lng, lat) {
    const turfEngine = window.turf;
    if (!turfEngine) {
        console.error("Turf.js library is still downloading. Please click again in a brief second.");
        return;
    }

    const profileSelectEl = document.getElementById('profile-select') || document.getElementById('mode');
    const profile = profileSelectEl ? profileSelectEl.value : 'walking';

    // Update origin pin instantly
    map.getSource('origin-source').setData({
        'type': 'FeatureCollection',
        'features': [
            {
                'type': 'Feature',
                'geometry': {
                    'type': 'Point',
                    'coordinates': [lng, lat]
                },
                'properties': {}
            }
        ]
    });

    // Handle safety default max travel time parsing
    const timeSelectEl = document.getElementById('catchment-time-select');
    let travelTime = timeSelectEl && timeSelectEl.value ? timeSelectEl.value : null;
    if (!travelTime) {
        travelTime = profile === 'driving' ? '10' : '20';
    }

    const mapboxUrl = 'https://api.mapbox.com/isochrone/v1/mapbox/' + profile + '/' + lng + ',' + lat + '.json?contours_minutes=5,10,20&polygons=true&access_token=' + mapboxgl.accessToken;

    fetch(mapboxUrl)
        .then(response => response.json())
        .then(isoData => {
            map.getSource('iso-source').setData(isoData);

            const bbox = turfEngine.bbox(isoData);

            // GATED INLINE ROUTINE: Only query features AFTER the camera finishes expanding the map extent
            map.once('moveend', () => {
                
                // Secondary check: Ensure vector source layers are buffered in memory
                if (!map.isSourceLoaded('composite')) {
                    map.once('sourcedata', () => {
                        processCatchmentFeatures(isoData, turfEngine, lng, lat, profile);
                    });
                    return;
                }

                processCatchmentFeatures(isoData, turfEngine, lng, lat, profile);
            });

            // Trigger the viewport layout shift
            map.fitBounds(bbox, { padding: 40, animate: true });
        })
        .catch(error => {
            console.error('Error executing combined Spatial live-tracking data loop:', error);
        });
}

// Separate data extraction and pipeline rendering block for stable camera transforms
function processCatchmentFeatures(isoData, turfEngine, lng, lat, profile) {
    const featuresInViewport = map.querySourceFeatures('composite', {
        sourceLayer: 'poi_label'
    });

    const rawPoiData = turfEngine.featureCollection(featuresInViewport);
    const strictIntersections = turfEngine.pointsWithinPolygon(rawPoiData, isoData);

    // Deduplicate vector seam tiles
    const uniqueFeatures = [];
    const seenIds = new Set();

    strictIntersections.features.forEach(f => {
        const id = f.properties.id || f.id || `${f.geometry.coordinates[0]}-${f.geometry.coordinates[1]}`;
        if (!seenIds.has(id)) {
            seenIds.add(id);
            uniqueFeatures.push(f);
        }
    });
    strictIntersections.features = uniqueFeatures;

    // Render matching icons to map canvas
    map.getSource('osm-pois').setData(strictIntersections);

    // --- DASHBOARD DATA EXTRACTION ROUTINES ---
    const contours = [...isoData.features].reverse();
    const iso5Polygon = contours[0];
    const iso10Polygon = contours[1];
    const iso20Polygon = contours[2];

    let count5 = 0;
    let count10 = 0;
    let count20 = 0;

    const allAmenitiesList = [];
    const originPoint = turfEngine.point([lng, lat]);

    strictIntersections.features.forEach(poi => {
        const props = poi.properties;
        const makiType = props.maki || 'other';
        const rawName = props.name || 'Unnamed Amenity';
        const typeName = rawName.toLowerCase();

        if (typeName.length <= 2 || makiType === 'building' || makiType === 'marker') {
            return;
        }

        let group = 'Other Services';
        if (['cafe', 'bakery', 'ice-cream', 'teahouse'].includes(makiType)) group = 'Cafes & Bakeries';
        else if (['restaurant', 'fast-food'].includes(makiType) || typeName.includes('mcdonald') || typeName.includes('kfc')) group = 'Restaurants & Dining';
        else if (['bar', 'pub', 'beer', 'alcohol-shop'].includes(makiType)) group = 'Nightlife & Bars';
        else if (['grocery', 'supermarket', 'convenience'].includes(makiType)) group = 'Supermarkets & Groceries';
        else if (['school', 'college', 'university', 'kindergarten'].includes(makiType)) group = 'Education & Schools';
        else if (['library', 'museum', 'art-gallery', 'theatre', 'cinema'].includes(makiType)) group = 'Arts & Culture';
        else if (['pharmacy', 'hospital', 'doctor', 'dentist', 'clinic'].includes(makiType)) group = 'Medical & Health';
        else if (['park', 'playground', 'dog-park', 'garden'].includes(makiType)) group = 'Parks & Recreation';
        else if (['bus', 'rail', 'rail-metro', 'rail-light', 'ferry', 'fuel', 'gas_station'].includes(makiType) || typeName.includes('bp') || typeName.includes('shell')) group = 'Public Transit Stops';
        else if (['parking', 'parking-garage'].includes(makiType)) group = 'Parking Spaces';
        else if (['clothing-store', 'hairdresser', 'shop', 'mall', 'laundry', 'bank', 'atm'].includes(makiType)) group = 'Retail & Banking';

        // --- TRUE ISOCHRONE NETWORK POINT ASSIGNMENTS ---
        let catchmentZone = 'Far Zone';
        let travelEstimate = '';

        const distanceKm = turfEngine.distance(originPoint, poi);
        const distanceText = distanceKm < 1 ? `${Math.round(distanceKm * 1000)}m` : `${distanceKm.toFixed(1)}km`;

        if (profile === 'driving') {
            if (iso5Polygon && turfEngine.booleanPointInPolygon(poi, iso5Polygon)) {
                count5++;
                catchmentZone = '2-Min Drive';
                travelEstimate = '🚗 ≤ 2 min';
            } else if (iso10Polygon && turfEngine.booleanPointInPolygon(poi, iso10Polygon)) {
                count10++;
                catchmentZone = '5-Min Drive';
                travelEstimate = '🚗 2–5 min';
            } else if (iso20Polygon && turfEngine.booleanPointInPolygon(poi, iso20Polygon)) {
                count20++;
                catchmentZone = '10-Min Drive';
                travelEstimate = '🚗 5–10 min';
            }
        } else if (profile === 'cycling') {
            const suffix = 'Ride';
            if (iso5Polygon && turfEngine.booleanPointInPolygon(poi, iso5Polygon)) {
                count5++;
                catchmentZone = `5-Min ${suffix}`;
                travelEstimate = '🚲 ≤ 5 min';
            } else if (iso10Polygon && turfEngine.booleanPointInPolygon(poi, iso10Polygon)) {
                count10++;
                catchmentZone = `10-Min ${suffix}`;
                travelEstimate = '🚲 5–10 min';
            } else if (iso20Polygon && turfEngine.booleanPointInPolygon(poi, iso20Polygon)) {
                count20++;
                catchmentZone = `20-Min ${suffix}`;
                travelEstimate = '🚲 10–20 min';
            }
        } else { // Walking
            const suffix = 'Walk';
            if (iso5Polygon && turfEngine.booleanPointInPolygon(poi, iso5Polygon)) {
                count5++;
                catchmentZone = `5-Min ${suffix}`;
                travelEstimate = '🚶 ≤ 5 min';
            } else if (iso10Polygon && turfEngine.booleanPointInPolygon(poi, iso10Polygon)) {
                count10++;
                catchmentZone = `10-Min ${suffix}`;
                travelEstimate = '🚶 5–10 min';
            } else if (iso20Polygon && turfEngine.booleanPointInPolygon(poi, iso20Polygon)) {
                count20++;
                catchmentZone = `20-Min ${suffix}`;
                travelEstimate = '🚶 10–20 min';
            }
        }

        allAmenitiesList.push({
            name: rawName,
            category: group,
            distance: distanceText,
            distanceRaw: distanceKm,
            zone: catchmentZone,
            timeLabel: travelEstimate,
            coordinates: poi.geometry.coordinates
        });
    });

    // Sort lists natively by raw proximity
    allAmenitiesList.sort((a, b) => a.distanceRaw - b.distanceRaw);

    // --- DOM SIDEBAR COUNTER INFRASTRUCTURE ---
    document.getElementById('category-panel')?.classList.remove('hidden');

    const label5 = document.getElementById('label-5min');
    const label10 = document.getElementById('label-10min');
    const label20 = document.getElementById('label-20min');

    if (profile === 'driving') {
        if (label5) label5.innerText = '2-Min Drive';
        if (label10) label10.innerText = '5-Min Drive';
        if (label20) label20.innerText = '10-Min Drive';
    } else {
        const suffix = profile === 'cycling' ? 'Ride' : 'Walk';
        if (label5) label5.innerText = `5-Min ${suffix}`;
        if (label10) label10.innerText = `10-Min ${suffix}`;
        if (label20) label20.innerText = `20-Min ${suffix}`;
    }

    if (document.getElementById('count-5min')) document.getElementById('count-5min').innerText = `${count5} places`;
    if (document.getElementById('count-10min')) document.getElementById('count-10min').innerText = `${count10} places`;
    if (document.getElementById('count-20min')) document.getElementById('count-20min').innerText = `${count20} places`;

    // --- RENDER RESTRUCTURED EXPANDABLE ACCORDIONS ---
    const listContainer = document.getElementById('categories-list');
    if (listContainer) {
        const masterCategories = [
            'Cafes & Bakeries', 'Restaurants & Dining', 'Nightlife & Bars',
            'Supermarkets & Groceries', 'Education & Schools', 'Arts & Culture',
            'Medical & Health', 'Parks & Recreation', 'Public Transit Stops',
            'Parking Spaces', 'Retail & Banking', 'Other Services'
        ];

        const groupedData = {};
        masterCategories.forEach(cat => { groupedData[cat] = []; });
        allAmenitiesList.forEach(item => {
            if (groupedData[item.category]) groupedData[item.category].push(item);
            else groupedData['Other Services'].push(item);
        });

        let directoryHtml = `<div class="directory-accordion-container" style="display: flex; flex-direction: column; gap: 8px;">`;

        Object.keys(groupedData).forEach(categoryName => {
            const places = groupedData[categoryName];
            const count = places.length;

            if (count === 0) return; // Hide empty rows

            directoryHtml += `
            <details class="category-accordion-group" style="background: #ffffff; border: 1px solid #dadce0; border-radius: 8px; overflow: hidden; margin-bottom: 4px;">
                <summary class="accordion-header" style="padding: 12px 16px; font-weight: 600; font-size: 14px; color: #202124; cursor: pointer; display: flex; align-items: center; background: #f8f9fa; user-select: none;">
                    <span style="flex-grow: 1;">${categoryName}</span>
                    <span class="category-badge-count" style="background: #e8f0fe; color: #1a73e8; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 700; margin-right: 12px;">
                        ${count}
                    </span>
                </summary>
                <div class="accordion-expanded-content" style="padding: 8px 12px; background: #ffffff; border-top: 1px solid #f1f3f4; max-height: 260px; overflow-y: auto;">
            `;

            places.forEach(item => {
                let badgeBg = 'rgba(244, 67, 54, 0.12)';   // Crimson (20-Min)
                let badgeColor = '#b71c1c';

                if (item.zone.includes('5-Min') || item.zone.includes('2-Min')) {
                    badgeBg = 'rgba(76, 175, 80, 0.15)';    // Emerald (5-Min)
                    badgeColor = '#1b5e20';
                } else if (item.zone.includes('10-Min') || item.zone.includes('5-Min Drive')) {
                    badgeBg = 'rgba(255, 152, 0, 0.15)';   // Amber (10-Min)
                    badgeColor = '#e65100';
                }

                directoryHtml += `
                <div class="directory-card" style="background: #ffffff; border: 1px solid #dadce0; border-radius: 8px; padding: 10px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="flyToAmenity([${item.coordinates}])">
                    <div>
                        <div class="card-title" style="font-weight: 600; font-size: 13px; color: #202124;">${item.name}</div>
                        <div class="card-meta" style="font-size: 11px; color: #70757a; margin-top: 2px;">${item.timeLabel} (${item.distance})</div>
                    </div>
                    <span class="zone-badge" style="background: ${badgeBg}; color: ${badgeColor}; font-size: 10px; padding: 4px 8px; border-radius: 6px; font-weight: 700; white-space: nowrap;">
                        ${item.zone}
                    </span>
                </div>`;
            });
            directoryHtml += `</div></details>`;
        });

        directoryHtml += `</div>`;
        listContainer.innerHTML = directoryHtml;
    }
}

// Bind interactive event tracking actions
map.on('click', (e) => {
    lastClickedLngLat = e.lngLat;
    generateCatchmentAnalysis(e.lngLat.lng, e.lngLat.lat);
});

// Clear Map State Workflow on Control Value Commutations
window.handleControlChange = function() {
    if (typeof updateCatchmentDropdownOptions === "function") {
        updateCatchmentDropdownOptions();
    }

    // 1. Fully purge existing spatial layer buffers visually
    if (map.getSource('iso-source')) map.getSource('iso-source').setData({'type': 'FeatureCollection', 'features': []});
    if (map.getSource('osm-pois')) map.getSource('osm-pois').setData({'type': 'FeatureCollection', 'features': []});
    if (map.getSource('origin-source')) map.getSource('origin-source').setData({'type': 'FeatureCollection', 'features': []});

    // 2. Zero-out summary indicators
    if (document.getElementById('count-5min')) document.getElementById('count-5min').innerText = `0 places`;
    if (document.getElementById('count-10min')) document.getElementById('count-10min').innerText = `0 places`;
    if (document.getElementById('count-20min')) document.getElementById('count-20min').innerText = `0 places`;

    // 3. Update descriptive labels proactively for the newly elected profile
    const profileSelectEl = document.getElementById('profile-select') || document.getElementById('mode');
    const profile = profileSelectEl ? profileSelectEl.value : 'walking';
    
    const label5 = document.getElementById('label-5min');
    const label10 = document.getElementById('label-10min');
    const label20 = document.getElementById('label-20min');

    if (profile === 'driving') {
        if (label5) label5.innerText = '2-Min Drive';
        if (label10) label10.innerText = '5-Min Drive';
        if (label20) label20.innerText = '10-Min Drive';
    } else {
        const suffix = profile === 'cycling' ? 'Ride' : 'Walk';
        if (label5) label5.innerText = `5-Min ${suffix}`;
        if (label10) label10.innerText = `10-Min ${suffix}`;
        if (label20) label20.innerText = `20-Min ${suffix}`;
    }

    // 4. Instruct the user to interact with the map frame anew
    const listContainer = document.getElementById('categories-list');
    if (listContainer) {
        listContainer.innerHTML = `
            <div style="padding: 16px; color: #1a73e8; font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 8px;">
                📍 Click anywhere on the map to explore nearby places for your new mode.
            </div>`;
    }

    // 5. Hard purge variable state tracking to prevent race conditions on stale data references
    lastClickedLngLat = null;
};

window.flyToAmenity = function (coords) {
    map.flyTo({
        center: coords,
        zoom: 16,
        essential: true
    });
};
