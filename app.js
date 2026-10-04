import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
} from "./vendor/maplibre-gl.js";

const API = "https://api.transitous.org/api";
const HEX_SIZE = 2800;

const DEFAULT_ORIGIN = {
  label: "Pfingstweidstrasse 110, Zürich",
  lat: 47.39148,
  lon: 8.50701,
};

const PLACES = [
  { label: "Zürich HB", names: ["Zürich HB"] },
  { label: "Winterthur", names: ["Winterthur"] },
  { label: "Zug", names: ["Zug"] },
  { label: "Olten", names: ["Olten"] },
  { label: "Aarau", names: ["Aarau"] },
  { label: "Schaffhausen", names: ["Schaffhausen"] },
  { label: "Arth-Goldau", names: ["Arth-Goldau"] },
  { label: "Basel SBB", names: ["Basel SBB"] },
  { label: "Luzern", names: ["Luzern"] },
  { label: "Bern", names: ["Bern"] },
  { label: "St. Gallen", names: ["St. Gallen"] },
  { label: "Biel/Bienne", names: ["Biel/Bienne"] },
  { label: "Thun", names: ["Thun"] },
  { label: "Fribourg", names: ["Fribourg/Freiburg"] },
  { label: "Chur", names: ["Chur"] },
  { label: "Spiez", names: ["Spiez"] },
  { label: "Neuchâtel", names: ["Neuchâtel"] },
  { label: "Bellinzona", names: ["Bellinzona"] },
  { label: "La Chaux-de-Fonds", names: ["La Chaux-de-Fonds"] },
  { label: "Yverdon", names: ["Yverdon-les-Bains"] },
  { label: "Lugano", names: ["Lugano"] },
  { label: "Brig", names: ["Brig"] },
  { label: "Lausanne", names: ["Lausanne"] },
  { label: "Locarno", names: ["Locarno"] },
  { label: "Interlaken Ost", names: ["Interlaken Ost"] },
  { label: "Andermatt", names: ["Andermatt"] },
  { label: "Davos Platz", names: ["Davos Platz"] },
  { label: "Sion", names: ["Sion"] },
  { label: "Montreux", names: ["Montreux"] },
  { label: "Genève", names: ["Genève"] },
  { label: "Zermatt", names: ["Zermatt"] },
  { label: "St. Moritz", names: ["St. Moritz"] },
];

const FILL_COLOR = [
  "interpolate",
  ["linear"],
  ["get", "minutes"],
  0, "#ffd60a",
  30, "#ff8c00",
  60, "#ff4d00",
  90, "#e10600",
  120, "#b0006d",
  160, "#7a1f78",
  180, "#5c1a9a",
  200, "#3c096c",
  240, "#2a0a4a",
];

const SCALE = [
  [0, [255, 214, 10]],
  [30, [255, 140, 0]],
  [60, [255, 77, 0]],
  [90, [225, 6, 0]],
  [120, [176, 0, 109]],
  [160, [122, 31, 120]],
  [180, [92, 26, 154]],
  [200, [60, 9, 108]],
  [240, [42, 10, 74]],
];

const numberFormat = new Intl.NumberFormat("de-CH");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const originInput = document.querySelector("#origin");
const suggestionsEl = document.querySelector("#suggestions");
const whenInput = document.querySelector("#when");
const nowButton = document.querySelector("#now");
const horizonEl = document.querySelector("#horizon");
const form = document.querySelector("#query");
const statusEl = document.querySelector("#status");
const progressEl = document.querySelector("#progress");
const statEl = document.querySelector("#stat");
const statNum = document.querySelector("#stat-num");
const readoutEl = document.querySelector("#readout");
const placesEl = document.querySelector("#places");
const goButton = document.querySelector("#go");

let origin = { ...DEFAULT_ORIGIN };
let maxMinutes = 240;
let committedLabel = origin.label;
let seq = 0;
let worker = null;
let country = null;
let mask = null;
let mapReady;
let hoveredId = null;
let popup = null;
let marker = null;
let suggestToken = 0;
let suggestItems = [];
let suggestIndex = -1;
let suggestTimer = 0;
let lastWhen = "";
let lastResult = null;
let resizeTimer = 0;

const cache = new Map();

const map = new MapLibreMap({
  container: "map",
  style: {
    version: 8,
    sources: {
      swisstopo: {
        type: "raster",
        tiles: [
          "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg",
        ],
        tileSize: 256,
        maxzoom: 17,
        attribution: '© <a href="https://www.swisstopo.admin.ch/" target="_blank" rel="noopener">swisstopo</a> · <a href="https://transitous.org/sources/" target="_blank" rel="noopener">Transitous</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      },
    },
    layers: [
      { id: "swisstopo", type: "raster", source: "swisstopo" },
    ],
  },
  center: [DEFAULT_ORIGIN.lon, DEFAULT_ORIGIN.lat],
  zoom: 7.4,
  minZoom: 6,
  maxZoom: 16,
  maxBounds: [[4.2, 44.6], [12.5, 48.8]],
  renderWorldCopies: false,
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
  attributionControl: true,
});

map.addControl(new NavigationControl({ showCompass: false }), "top-right");
map.addControl(new ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");
map.touchZoomRotate.disableRotation();

popup = new Popup({ closeButton: true, maxWidth: "260px" });

function pad(value) {
  return String(value).padStart(2, "0");
}

function zurichParts(date) {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Zurich",
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const bag = {};
  for (const part of format.formatToParts(date)) bag[part.type] = part.value;
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[bag.weekday];
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
    weekday,
  };
}

function zurichOffsetMinutes(instant) {
  const parts = zurichParts(instant);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

function zurichWallToISO(value) {
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  let offset = zurichOffsetMinutes(new Date(Date.UTC(year, month - 1, day, hour, minute)));
  let utc = Date.UTC(year, month - 1, day, hour, minute) - offset * 60000;
  offset = zurichOffsetMinutes(new Date(utc));
  utc = Date.UTC(year, month - 1, day, hour, minute) - offset * 60000;
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  return `${date}T${pad(hour)}:${pad(minute)}:00${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

function defaultDepartureValue() {
  const parts = zurichParts(new Date());
  let add = 0;
  if (parts.weekday === 6) add = 2;
  else if (parts.weekday === 0) add = 1;
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + add));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T08:00`;
}

function nowValue() {
  const parts = zurichParts(new Date());
  const minute = parts.minute - (parts.minute % 5);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(minute)}`;
}

function formatWhen(value) {
  const date = new Date(zurichWallToISO(value));
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatMinutes(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

function changesLabel(transfers) {
  if (transfers <= 0) return "direct";
  if (transfers === 1) return "1 change";
  return `${transfers} changes`;
}

function colorAt(minutes) {
  const value = Math.max(0, Math.min(240, minutes));
  let index = 1;
  while (index < SCALE.length && SCALE[index][0] < value) index += 1;
  const [startMinute, start] = SCALE[Math.max(0, index - 1)];
  const [endMinute, end] = SCALE[Math.min(SCALE.length - 1, index)];
  const t = endMinute === startMinute ? 0 : (value - startMinute) / (endMinute - startMinute);
  const channels = start.map((channel, i) => Math.round(channel + (end[i] - channel) * t));
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function decodeMask(bits) {
  const binary = atob(bits);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.classList.toggle("is-error", Boolean(isError));
}

function setLoading(loading, text) {
  progressEl.hidden = !loading;
  goButton.disabled = loading;
  goButton.textContent = loading ? "Working…" : "Show times";
  if (text) setStatus(text, false);
}

function readHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (params.has("lat") && params.has("lon") && Number.isFinite(lat) && Number.isFinite(lon)) {
    origin = {
      lat,
      lon,
      label: params.get("label") || `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    };
    committedLabel = origin.label;
  }
  const when = params.get("t");
  if (when && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(when)) {
    whenInput.value = when.slice(0, 16);
  }
  const horizon = Number(params.get("m"));
  if ([60, 120, 180, 240].includes(horizon)) maxMinutes = horizon;
}

function writeHash() {
  const params = new URLSearchParams();
  params.set("lat", origin.lat.toFixed(5));
  params.set("lon", origin.lon.toFixed(5));
  params.set("label", origin.label);
  params.set("t", whenInput.value);
  params.set("m", String(maxMinutes));
  history.replaceState(null, "", `#${params.toString()}`);
}

function syncHorizon() {
  for (const button of horizonEl.querySelectorAll("button")) {
    const on = Number(button.dataset.min) === maxMinutes;
    button.setAttribute("aria-checked", on ? "true" : "false");
  }
}

function cameraPadding() {
  const narrow = window.innerWidth < 760;
  if (narrow) {
    const panel = document.querySelector("#panel");
    return { top: 20, left: 16, right: 16, bottom: panel.offsetHeight + 16 };
  }
  return { top: 28, left: 440, right: 28, bottom: 28 };
}

function fitSwitzerland() {
  if (!country) return;
  const bounds = new LngLatBounds();
  for (const position of country.coordinates[0]) bounds.extend(position);
  map.fitBounds(bounds, { padding: cameraPadding(), duration: reducedMotion ? 0 : 0, maxZoom: 9 });
}

function fitHexes(collection, duration) {
  const bounds = new LngLatBounds();
  for (const feature of collection.features) {
    for (const position of feature.geometry.coordinates[0]) bounds.extend(position);
  }
  bounds.extend([origin.lon, origin.lat]);
  if (bounds.isEmpty()) return;
  map.fitBounds(bounds, {
    padding: cameraPadding(),
    duration: duration ?? (reducedMotion ? 0 : 700),
    maxZoom: 12,
  });
}

function placePopupHtml(name, minutes, transfers, count) {
  const extra = count > 1 ? ` · fastest of ${numberFormat.format(count)} stops` : "";
  return `<strong>${escapeHtml(name)}</strong><span>${formatMinutes(minutes)} · ${changesLabel(transfers)}${extra}</span>`;
}

function renderPlaces(list) {
  placesEl.replaceChildren();
  const sorted = [...list].sort((a, b) => a.minutes - b.minutes);
  for (const place of sorted) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "place";

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = colorAt(place.minutes);

    const name = document.createElement("span");
    name.className = "place-name";
    name.textContent = place.label;

    const time = document.createElement("span");
    time.className = "place-time";
    time.textContent = formatMinutes(place.minutes);

    const meta = document.createElement("span");
    meta.className = "place-meta";
    meta.textContent = place.name === place.label
      ? changesLabel(place.transfers)
      : `${place.name} · ${changesLabel(place.transfers)}`;

    const track = document.createElement("span");
    track.className = "track";
    const fill = document.createElement("span");
    fill.className = "fill";
    fill.style.width = `${Math.max(4, Math.min(100, (place.minutes / maxMinutes) * 100))}%`;
    fill.style.background = colorAt(place.minutes);
    track.append(fill);

    const copy = document.createElement("span");
    copy.className = "place-copy";
    const top = document.createElement("span");
    top.className = "place-top";
    top.append(name, time);
    copy.append(top, meta, track);
    button.append(swatch, copy);
    button.addEventListener("click", () => {
      popup.setLngLat([place.lon, place.lat])
        .setHTML(placePopupHtml(place.name, place.minutes, place.transfers, 1))
        .addTo(map);
      map.flyTo({
        center: [place.lon, place.lat],
        zoom: Math.max(map.getZoom(), 9.5),
        duration: reducedMotion ? 0 : 800,
      });
    });
    item.append(button);
    placesEl.append(item);
  }
}

function publish(state) {
  window.__FAHRZEIT__ = state;
}

function applyResult(result) {
  lastResult = result;
  const source = map.getSource("hexes");
  source.setData(result.hexes);
  if (hoveredId != null) {
    map.setFeatureState({ source: "hexes", id: hoveredId }, { hover: false });
    hoveredId = null;
  }
  statEl.hidden = false;
  statNum.textContent = numberFormat.format(result.reached);
  setLoading(false);
  setStatus(`${formatWhen(whenInput.value)} departure`);
  readoutEl.textContent = result.fastest
    ? `Fastest stop: ${result.fastest.name}, ${formatMinutes(result.fastest.minutes)}.`
    : "No public-transport stop in Switzerland is reachable in this window.";
  renderPlaces(result.places);
  if (result.hexes.features.length) fitHexes(result.hexes);
  publish({
    status: "ready",
    reached: result.reached,
    cells: result.hexes.features.length,
    maxMinutes,
    origin: { ...origin },
    places: result.places.map((place) => ({
      label: place.label,
      minutes: place.minutes,
      transfers: place.transfers,
    })),
  });
}

function queryUrl() {
  const params = new URLSearchParams({
    one: `${origin.lat.toFixed(5)},${origin.lon.toFixed(5)}`,
    maxTravelTime: String(maxMinutes),
    time: zurichWallToISO(whenInput.value),
    maxPreTransitTime: "1200",
  });
  return `${API}/v6/one-to-all?${params.toString()}`;
}

function run() {
  if (!mask || !country) return;
  if (!whenInput.value) {
    setStatus("Choose a departure time.", true);
    return;
  }
  lastWhen = whenInput.value;
  const id = ++seq;
  writeHash();
  marker.setLngLat([origin.lon, origin.lat]);
  marker.getElement().title = origin.label;

  const url = queryUrl();
  const cached = cache.get(url);
  if (cached) {
    applyResult(cached);
    return;
  }

  setLoading(true, "Fetching reachable stops…");
  publish({ status: "loading", origin: { ...origin }, maxMinutes });
  if (worker) worker.terminate();
  worker = new Worker(new URL("worker.js", import.meta.url));
  worker.onmessage = (event) => {
    if (event.data.id !== id) return;
    if (event.data.type === "progress") {
      const text = {
        download: "Fetching reachable stops…",
        parse: "Reading the timetable…",
        grid: "Drawing travel times…",
      }[event.data.stage];
      if (text) setStatus(text);
      return;
    }
    if (event.data.type === "error") {
      setLoading(false);
      setStatus(event.data.message, true);
      publish({ status: "error", message: event.data.message });
      return;
    }
    if (event.data.type === "result") {
      cache.set(url, event.data);
      if (cache.size > 6) cache.delete(cache.keys().next().value);
      applyResult(event.data);
    }
  };
  worker.onerror = () => {
    if (id !== seq) return;
    setLoading(false);
    setStatus("Could not compute travel times.", true);
    publish({ status: "error", message: "worker" });
  };
  worker.postMessage({
    id,
    url,
    maskMeta: {
      lon0: country.mask.lon0,
      lat0: country.mask.lat0,
      step: country.mask.step,
      width: country.mask.width,
      height: country.mask.height,
    },
    mask,
    places: PLACES,
    hexSize: HEX_SIZE,
  });
}

function displayLabel(match) {
  const city = (match.areas || []).find((area) => area.adminLevel === 8)?.name
    || (match.areas || []).find((area) => area.adminLevel === 4)?.name
    || "";
  if (city && match.name && !match.name.toLowerCase().includes(city.toLowerCase())) {
    return `${match.name}, ${city}`;
  }
  return match.name || "Selected place";
}

function hideSuggestions() {
  suggestionsEl.hidden = true;
  suggestionsEl.replaceChildren();
  originInput.setAttribute("aria-expanded", "false");
  suggestItems = [];
  suggestIndex = -1;
}

function renderSuggestions(items) {
  suggestionsEl.replaceChildren();
  suggestItems = items;
  suggestIndex = -1;
  if (!items.length) {
    suggestionsEl.hidden = true;
    originInput.setAttribute("aria-expanded", "false");
    return;
  }
  suggestionsEl.hidden = false;
  originInput.setAttribute("aria-expanded", "true");
  items.forEach((item, index) => {
    const li = document.createElement("li");
    li.setAttribute("role", "presentation");
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "option");
    button.id = `suggest-${index}`;
    const name = document.createElement("span");
    name.className = "s-name";
    name.textContent = item.title;
    const meta = document.createElement("span");
    meta.className = "s-meta";
    meta.textContent = item.meta;
    button.append(name, meta);
    button.addEventListener("click", () => chooseSuggestion(item));
    li.append(button);
    suggestionsEl.append(li);
  });
}

function markSuggestion(index) {
  const buttons = suggestionsEl.querySelectorAll("button");
  buttons.forEach((button, i) => {
    const on = i === index;
    button.setAttribute("aria-selected", on ? "true" : "false");
    if (on) originInput.setAttribute("aria-activedescendant", button.id);
  });
  suggestIndex = index;
}

async function geocode(text) {
  const params = new URLSearchParams({ text });
  const response = await fetch(`${API}/v1/geocode?${params.toString()}`);
  if (!response.ok) throw new Error("Place search failed.");
  const matches = await response.json();
  return (Array.isArray(matches) ? matches : [])
    .filter((match) => Number.isFinite(match.lat) && Number.isFinite(match.lon))
    .sort((a, b) => {
      const score = (match) => (match.country === "CH" ? 0 : 1) + (match.type === "ADDRESS" ? 0 : 0.2);
      return score(a) - score(b);
    })
    .slice(0, 6)
    .map((match) => {
      const city = (match.areas || []).find((area) => area.adminLevel === 8)?.name || "";
      const kind = match.type === "STOP" ? "Stop" : match.type === "ADDRESS" ? "Address" : "Place";
      return {
        lat: match.lat,
        lon: match.lon,
        label: displayLabel(match),
        title: match.name || "Unnamed place",
        meta: [kind, city, match.country].filter(Boolean).join(" · "),
      };
    });
}

function chooseSuggestion(item) {
  origin = { lat: item.lat, lon: item.lon, label: item.label };
  committedLabel = item.label;
  originInput.value = item.label;
  hideSuggestions();
  run();
}

async function commitTypedOrigin() {
  const text = originInput.value.trim();
  if (!text) {
    setStatus("Enter a place in Switzerland.", true);
    return false;
  }
  if (text === committedLabel) return true;
  setLoading(true, "Searching for that place…");
  try {
    const items = await geocode(text);
    const match = items[0];
    if (!match) {
      setLoading(false);
      setStatus("No place found for that search.", true);
      return false;
    }
    origin = { lat: match.lat, lon: match.lon, label: match.label };
    committedLabel = match.label;
    originInput.value = match.label;
    hideSuggestions();
    return true;
  } catch (error) {
    setLoading(false);
    setStatus(error.message || "Place search failed.", true);
    return false;
  }
}

async function commitAndRun() {
  const ok = await commitTypedOrigin();
  if (ok) run();
}

async function reverseGeocode(lat, lon) {
  const response = await fetch(`${API}/v1/reverse-geocode?place=${lat.toFixed(5)},${lon.toFixed(5)}`);
  if (!response.ok) return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  const matches = await response.json();
  const address = (matches || []).find((match) => match.type === "ADDRESS")
    || (matches || []).find((match) => match.country === "CH")
    || (matches || [])[0];
  if (!address) return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  return displayLabel(address);
}

function scheduleSuggest() {
  window.clearTimeout(suggestTimer);
  const text = originInput.value.trim();
  if (text.length < 2 || text === committedLabel) {
    hideSuggestions();
    return;
  }
  suggestTimer = window.setTimeout(async () => {
    const token = ++suggestToken;
    try {
      const items = await geocode(text);
      if (token !== suggestToken) return;
      renderSuggestions(items);
    } catch {
      if (token !== suggestToken) return;
      hideSuggestions();
    }
  }, 220);
}

function moveSuggestion(step) {
  if (suggestionsEl.hidden || !suggestItems.length) return;
  const next = (suggestIndex + step + suggestItems.length) % suggestItems.length;
  markSuggestion(next);
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum;
}

function addCountryLayers() {
  const ring = country.coordinates[0];
  const outer = [[4.0, 44.4], [13.0, 44.4], [13.0, 49.0], [4.0, 49.0], [4.0, 44.4]];
  const hole = ringArea(ring) > 0 ? [...ring].reverse() : ring;
  map.addSource("outside", {
    type: "geojson",
    data: {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [outer, hole] },
    },
  });
  map.addLayer({
    id: "outside",
    type: "fill",
    source: "outside",
    paint: { "fill-color": "#cfc6b8", "fill-opacity": 0.42 },
  });
  map.addSource("border", {
    type: "geojson",
    data: { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] } },
  });
  map.addSource("hexes", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "hexes",
    type: "fill",
    source: "hexes",
    paint: {
      "fill-color": FILL_COLOR,
      "fill-opacity": [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        0.96,
        0.84,
      ],
    },
  });
  map.addLayer({
    id: "border",
    type: "line",
    source: "border",
    paint: { "line-color": "#2b2722", "line-width": 1.25, "line-opacity": 0.8 },
  });

  map.on("mousemove", "hexes", (event) => {
    const feature = event.features && event.features[0];
    if (!feature) return;
    if (hoveredId !== feature.id) {
      if (hoveredId != null) map.setFeatureState({ source: "hexes", id: hoveredId }, { hover: false });
      hoveredId = feature.id;
      map.setFeatureState({ source: "hexes", id: hoveredId }, { hover: true });
    }
    const props = feature.properties;
    readoutEl.textContent = `${props.name} · ${formatMinutes(Number(props.minutes))} · ${changesLabel(Number(props.transfers))}`;
    map.getCanvas().style.cursor = "pointer";
  });

  map.on("mouseleave", "hexes", () => {
    if (hoveredId != null) map.setFeatureState({ source: "hexes", id: hoveredId }, { hover: false });
    hoveredId = null;
    map.getCanvas().style.cursor = "";
    readoutEl.textContent = "Hover the map for the fastest stop in a cell.";
  });

  map.on("click", "hexes", (event) => {
    const feature = event.features && event.features[0];
    if (!feature) return;
    const props = feature.properties;
    popup.setLngLat(event.lngLat)
      .setHTML(placePopupHtml(props.name, Number(props.minutes), Number(props.transfers), Number(props.count)))
      .addTo(map);
  });
}

async function boot() {
  whenInput.value = defaultDepartureValue();
  readHash();
  lastWhen = whenInput.value;
  originInput.value = origin.label;
  committedLabel = origin.label;
  syncHorizon();

  const pin = document.createElement("div");
  pin.className = "pin-dot";
  pin.title = origin.label;
  marker = new Marker({ element: pin, anchor: "center", draggable: true })
    .setLngLat([origin.lon, origin.lat])
    .addTo(map);
  marker.on("dragend", async () => {
    const lngLat = marker.getLngLat();
    setLoading(true, "Locating the pin…");
    let label = `${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}`;
    try {
      label = await reverseGeocode(lngLat.lat, lngLat.lng);
    } catch {
      /* keep the coordinate label */
    }
    origin = { lat: lngLat.lat, lon: lngLat.lng, label };
    committedLabel = label;
    originInput.value = label;
    hideSuggestions();
    run();
  });

  mapReady = new Promise((resolve) => {
    if (map.loaded()) resolve();
    else map.once("load", resolve);
  });

  const response = await fetch(new URL("data/switzerland.json", import.meta.url));
  country = await response.json();
  mask = decodeMask(country.mask.bits);
  await mapReady;
  addCountryLayers();
  fitSwitzerland();
  run();
}

originInput.addEventListener("input", scheduleSuggest);
originInput.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSuggestion(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSuggestion(-1);
  } else if (event.key === "Escape") {
    hideSuggestions();
  } else if (event.key === "Enter" && suggestIndex >= 0) {
    event.preventDefault();
    chooseSuggestion(suggestItems[suggestIndex]);
  }
});

document.addEventListener("click", (event) => {
  if (event.target === originInput || suggestionsEl.contains(event.target)) return;
  hideSuggestions();
});

nowButton.addEventListener("click", () => {
  whenInput.value = nowValue();
  commitAndRun();
});

whenInput.addEventListener("change", () => {
  if (whenInput.value === lastWhen) return;
  lastWhen = whenInput.value;
  commitAndRun();
});

horizonEl.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  maxMinutes = Number(button.dataset.min);
  syncHorizon();
  commitAndRun();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (suggestIndex >= 0 && !suggestionsEl.hidden) {
    chooseSuggestion(suggestItems[suggestIndex]);
    return;
  }
  commitAndRun();
});

window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    map.resize();
    if (lastResult && lastResult.hexes.features.length) fitHexes(lastResult.hexes, 0);
  }, 120);
});

boot().catch((error) => {
  setLoading(false);
  setStatus(error.message || "The map could not be loaded.", true);
  publish({ status: "error", message: String(error) });
});
