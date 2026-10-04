/* Switzerland is projected onto a local metre grid around 46.8°N, 8.23°E.
   Hex centres and corners use that same grid, so cells tile without gaps. */

const M_LON = 111320 * Math.cos((46.8 * Math.PI) / 180);
const M_LAT = 110540;
const LON0 = 8.23;
const LAT0 = 46.8;

function project(lat, lon) {
  return { x: (lon - LON0) * M_LON, y: (lat - LAT0) * M_LAT };
}

function unproject(x, y) {
  return [LON0 + x / M_LON, LAT0 + y / M_LAT];
}

function hexRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);
  const qd = Math.abs(rq - q);
  const rd = Math.abs(rr - r);
  const sd = Math.abs(rs - s);
  if (qd > rd && qd > sd) rq = -rr - rs;
  else if (rd > sd) rr = -rq - rs;
  return [rq, rr];
}

function pixelToHex(x, y, size) {
  const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return hexRound(q, r);
}

function hexToPixel(q, r, size) {
  return {
    x: size * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r),
    y: size * (1.5 * r),
  };
}

function hexRing(q, r, size) {
  const center = hexToPixel(q, r, size);
  const ring = [];
  const grow = size * 1.02;
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    ring.push(unproject(
      center.x + grow * Math.cos(angle),
      center.y + grow * Math.sin(angle),
    ));
  }
  ring.push(ring[0]);
  return ring;
}

function inSwitzerland(lon, lat, meta, mask) {
  const x = Math.floor((lon - meta.lon0) / meta.step);
  const y = Math.floor((lat - meta.lat0) / meta.step);
  if (x < 0 || y < 0 || x >= meta.width || y >= meta.height) return false;
  const i = y * meta.width + x;
  return (mask[i >> 3] & (1 << (i & 7))) !== 0;
}

self.onmessage = async (event) => {
  const { id, url, maskMeta, mask, places, hexSize } = event.data;
  const wanted = new Map();
  for (const place of places) {
    for (const name of place.names) wanted.set(name.toLowerCase(), place.label);
  }

  try {
    self.postMessage({ id, type: "progress", stage: "download" });
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (response.status === 429) {
      throw new Error("The routing service is busy. Try again in a minute.");
    }
    if (!response.ok) {
      let message = `Routing service returned ${response.status}.`;
      try {
        const body = await response.json();
        message = body.message || body.error || message;
      } catch {
        /* keep the status message */
      }
      throw new Error(message);
    }

    self.postMessage({ id, type: "progress", stage: "parse" });
    const data = await response.json();
    const all = data.all;
    if (!Array.isArray(all)) {
      throw new Error("The routing service returned an unexpected response.");
    }

    self.postMessage({ id, type: "progress", stage: "grid" });
    const cells = new Map();
    const found = new Map();
    let reached = 0;
    let fastest = null;

    for (let n = 0; n < all.length; n += 1) {
      const item = all[n];
      const place = item && item.place;
      if (!place || place.lat == null || place.lon == null) continue;
      if (!inSwitzerland(place.lon, place.lat, maskMeta, mask)) continue;
      const minutes = item.duration;
      if (typeof minutes !== "number") continue;
      reached += 1;
      const transfers = Math.max(0, (item.k || 1) - 1);
      const name = place.name || "Stop";

      if (!fastest || minutes < fastest.minutes) {
        fastest = { name, minutes, lat: place.lat, lon: place.lon };
      }

      const label = wanted.get(name.toLowerCase());
      if (label) {
        const current = found.get(label);
        if (!current || minutes < current.minutes) {
          found.set(label, {
            label,
            name,
            minutes,
            transfers,
            lat: place.lat,
            lon: place.lon,
          });
        }
      }

      const projected = project(place.lat, place.lon);
      const [q, r] = pixelToHex(projected.x, projected.y, hexSize);
      const key = `${q},${r}`;
      const cell = cells.get(key);
      if (!cell) {
        cells.set(key, {
          q, r, minutes, transfers, name, count: 1, lat: place.lat, lon: place.lon,
        });
      } else {
        cell.count += 1;
        if (minutes < cell.minutes) {
          cell.minutes = minutes;
          cell.transfers = transfers;
          cell.name = name;
          cell.lat = place.lat;
          cell.lon = place.lon;
        }
      }
    }

    const features = [];
    let featureId = 1;
    for (const cell of cells.values()) {
      features.push({
        type: "Feature",
        id: featureId,
        properties: {
          minutes: cell.minutes,
          name: cell.name,
          transfers: cell.transfers,
          count: cell.count,
        },
        geometry: {
          type: "Polygon",
          coordinates: [hexRing(cell.q, cell.r, hexSize)],
        },
      });
      featureId += 1;
    }

    const placeList = places
      .map((place) => found.get(place.label))
      .filter(Boolean);

    self.postMessage({
      id,
      type: "result",
      reached,
      places: placeList,
      fastest,
      hexes: { type: "FeatureCollection", features },
    });
  } catch (error) {
    const message = error && error.name === "TimeoutError"
      ? "The routing service took too long. Try a shorter time window."
      : (error && error.message) || "Could not compute travel times.";
    self.postMessage({ id, type: "error", message });
  }
};
