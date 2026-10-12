(async function () {
  "use strict";

  // Plain background used if the hosted basemap cannot be reached.
  const FALLBACK_STYLE = {
    version: 8,
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": "#e9ecea" } }]
  };

  const $ = (id) => document.getElementById(id);
  const statusEl = $("status");
  const setStatus = (msg) => { statusEl.textContent = msg; };

  async function getJSON(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(url + " returned " + res.status);
    return res.json();
  }

  // ---------- config ----------
  let config;
  try {
    config = await getJSON("layers.json", { cache: "no-cache" });
  } catch (err) {
    setStatus("Could not load layers.json. Open this page from its web address, not as a local file. (" + err.message + ")");
    return;
  }
  document.title = config.title || "US Map";
  $("title").textContent = config.title || "US Map";

  const layers = (config.layers || []).map((cfg) => ({
    cfg,
    visible: cfg.visible !== false,
    data: null,
    bounds: cfg.bounds || null,
    count: null,
    updated: null,
    error: null,
    ids: [],
    bound: false,
    metaEl: null
  }));

  // ---------- data loading ----------
  function bboxOf(gj) {
    let w = 180, s = 90, e = -180, n = -90, any = false;
    const walk = (c) => {
      if (typeof c[0] === "number") {
        w = Math.min(w, c[0]); e = Math.max(e, c[0]);
        s = Math.min(s, c[1]); n = Math.max(n, c[1]);
        any = true;
      } else { c.forEach(walk); }
    };
    const feats = gj.type === "FeatureCollection" ? gj.features : [gj];
    feats.forEach((f) => { if (f && f.geometry && f.geometry.coordinates) walk(f.geometry.coordinates); });
    return any ? [[w, s], [e, n]] : null;
  }

  async function loadData(l) {
    try {
      l.data = await getJSON(l.cfg.url, { cache: "no-store" });
      l.bounds = l.cfg.bounds || bboxOf(l.data);
      l.count = Array.isArray(l.data.features) ? l.data.features.length : null;
      l.updated = new Date();
      l.error = null;
    } catch (err) {
      l.error = err.message; // keep any earlier data
    }
  }

  await Promise.all(layers.filter((l) => l.cfg.type === "geojson").map(loadData));

  // ---------- map ----------
  const map = new maplibregl.Map({
    container: "map",
    style: config.basemap.style,
    bounds: config.view.bounds,
    fitBoundsOptions: { padding: 20 },
    hash: true,
    attributionControl: { compact: true }
  });
  window.usMap = map; // handy for debugging in the browser console
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");

  if (window.pmtiles) {
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
  }

  // ---------- basemap fallback ----------
  let usingFallback = false;
  let basemapLoaded = false;
  const watchdog = setTimeout(() => { if (!basemapLoaded) useFallback(); }, 12000);

  function useFallback() {
    if (usingFallback) return;
    usingFallback = true;
    setStatus("Basemap unavailable. Layers are shown on a plain background.");
    map.setStyle(FALLBACK_STYLE);
  }

  map.on("error", (e) => {
    const url = e && e.error && e.error.url;
    if (!basemapLoaded && !usingFallback && url && String(url).indexOf(config.basemap.style) === 0) useFallback();
  });

  map.on("style.load", () => {
    if (!usingFallback) { basemapLoaded = true; clearTimeout(watchdog); }
    layers.forEach(addLayer);
    renderLegend();
  });

  // ---------- layers ----------
  function colorExpr(st) {
    const entries = st.colors ? Object.entries(st.colors) : [];
    if (st.colorBy && entries.length) {
      const m = ["match", ["to-string", ["get", st.colorBy]]];
      entries.forEach(([k, v]) => m.push(k, v));
      m.push(st.color || "#8a8984");
      return m;
    }
    return st.color || "#2a78d6";
  }

  function addLayer(l) {
    const cfg = l.cfg;
    if (map.getSource(cfg.id)) return;
    let source;
    if (cfg.type === "geojson") {
      if (!l.data) return;
      source = { type: "geojson", data: l.data };
    } else if (cfg.type === "pmtiles") {
      source = { type: "vector", url: "pmtiles://" + new URL(cfg.url, location.href).href, attribution: cfg.attribution };
    } else if (cfg.type === "vector") {
      source = { type: "vector", tiles: cfg.tiles, minzoom: cfg.minzoom, maxzoom: cfg.maxzoom, attribution: cfg.attribution };
    } else if (cfg.type === "raster") {
      source = { type: "raster", tiles: cfg.tiles, tileSize: cfg.tileSize || 256, attribution: cfg.attribution };
    } else { return; }

    map.addSource(cfg.id, source);
    l.ids = [];
    const st = cfg.style || {};
    const color = colorExpr(st);
    const visibility = l.visible ? "visible" : "none";
    const add = (layer) => {
      const def = Object.assign({ source: cfg.id }, layer);
      def.layout = Object.assign({ visibility }, layer.layout || {});
      if (cfg.sourceLayer && cfg.type !== "geojson" && cfg.type !== "raster") def["source-layer"] = cfg.sourceLayer;
      map.addLayer(def);
      l.ids.push(def.id);
    };

    if (cfg.type === "raster") {
      add({ id: cfg.id + "--raster", type: "raster", paint: { "raster-opacity": st.opacity != null ? st.opacity : 0.8 } });
    } else if (cfg.geometry === "line") {
      const w = st.width || 2;
      add({
        id: cfg.id + "--line", type: "line",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": color, "line-width": ["interpolate", ["linear"], ["zoom"], 3, w * 0.5, 10, w * 1.5] }
      });
    } else if (cfg.geometry === "polygon") {
      add({ id: cfg.id + "--fill", type: "fill", paint: { "fill-color": color, "fill-opacity": st.opacity != null ? st.opacity : 0.25 } });
      add({ id: cfg.id + "--outline", type: "line", paint: { "line-color": color, "line-width": st.width || 1 } });
    } else {
      const r = st.radius || 6;
      add({
        id: cfg.id + "--circle", type: "circle",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, r * 0.6, 8, r, 12, r * 1.4],
          "circle-color": color,
          "circle-stroke-color": "#fcfcfb",
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.95
        }
      });
    }
    if (cfg.popup && cfg.type !== "raster" && !l.bound) bindPopup(l);
  }

  function setVisible(l, on) {
    l.visible = on;
    l.ids.forEach((id) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); });
    renderLegend();
  }

  // ---------- popups ----------
  function featureBlock(p, popup) {
    const div = document.createElement("div");
    div.className = "feat";
    if (popup.title && p[popup.title]) {
      const h = document.createElement("strong");
      h.textContent = String(p[popup.title]);
      div.appendChild(h);
    }
    (popup.fields || []).forEach((f) => {
      const v = p[f.key];
      if (v === undefined || v === null || v === "") return;
      const row = document.createElement("div");
      const k = document.createElement("span");
      k.className = "k";
      k.textContent = f.label + ": ";
      row.appendChild(k);
      row.appendChild(document.createTextNode(String(v)));
      div.appendChild(row);
    });
    const link = popup.link;
    if (link && p[link.key] && /^https?:\/\//i.test(String(p[link.key]))) {
      const a = document.createElement("a");
      a.href = String(p[link.key]);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = link.label || "Link";
      div.appendChild(a);
    }
    return div;
  }

  // Cursor feedback per layer; the click itself is handled once, below, so overlapping layers never stack popups.
  function bindPopup(l) {
    l.bound = true;
    l.ids.forEach((id) => {
      map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
    });
  }

  let popup = null;
  function showPopup(lngLat, feats, cfg, point) {
    const seen = new Set();
    const unique = [];
    feats.forEach((f) => {
      const key = JSON.stringify(f.properties || {});
      if (!seen.has(key)) { seen.add(key); unique.push(f); }
    });
    // nearest first for point features
    const dist = (f) => {
      if (!f.geometry || f.geometry.type !== "Point") return 0;
      const q = map.project(f.geometry.coordinates);
      return Math.hypot(q.x - point.x, q.y - point.y);
    };
    unique.sort((a, b) => dist(a) - dist(b));
    const node = document.createElement("div");
    unique.slice(0, 8).forEach((f) => node.appendChild(featureBlock(f.properties || {}, cfg)));
    if (popup) popup.remove();
    popup = new maplibregl.Popup({ maxWidth: "300px" }).setLngLat(lngLat).setDOMContent(node).addTo(map);
  }

  // Points beat lines, lines beat polygons, so a polygon layer never hides a marker beneath it.
  // Within the same kind, the layer listed last in layers.json (drawn on top) wins.
  const rank = (l) => (l.cfg.geometry === "polygon" ? 2 : l.cfg.geometry === "line" ? 1 : 0);
  map.on("click", (e) => {
    const box = [[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]];
    const order = layers.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l) - rank(b.l) || b.i - a.i);
    for (const { l } of order) {
      if (!l.cfg.popup || !l.visible) continue;
      const ids = l.ids.filter((id) => map.getLayer(id));
      if (!ids.length) continue;
      const feats = map.queryRenderedFeatures(box, { layers: ids });
      if (feats.length) { showPopup(e.lngLat, feats, l.cfg.popup, e.point); return; }
    }
  });

  // ---------- panel ----------
  function updateMeta(l) {
    const el = l.metaEl;
    if (!el) return;
    el.textContent = "";
    const parts = [];
    if (l.count != null) parts.push(l.count + " features");
    const secs = l.cfg.refreshSeconds;
    if (secs > 0) parts.push("live, every " + secs + " s" + (l.updated ? ", updated " + l.updated.toLocaleTimeString() : ""));
    parts.forEach((t) => { const s = document.createElement("span"); s.textContent = t; el.appendChild(s); });
    if (l.error) {
      const s = document.createElement("span");
      s.className = "err";
      s.textContent = "Load problem: " + l.error;
      el.appendChild(s);
    }
    if (l.bounds) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "link";
      b.textContent = "Zoom to layer";
      b.addEventListener("click", () => map.fitBounds(l.bounds, { padding: 60, maxZoom: 9 }));
      el.appendChild(b);
    }
  }

  function renderList() {
    const ul = $("layer-list");
    ul.textContent = "";
    layers.forEach((l) => {
      const li = document.createElement("li");
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = l.visible;
      cb.addEventListener("change", () => setVisible(l, cb.checked));
      const name = document.createElement("span");
      name.textContent = l.cfg.name || l.cfg.id;
      label.append(cb, name);
      li.appendChild(label);
      const meta = document.createElement("div");
      meta.className = "meta";
      l.metaEl = meta;
      li.appendChild(meta);
      ul.appendChild(li);
      updateMeta(l);
    });
  }

  function renderLegend() {
    const box = $("legend");
    box.textContent = "";
    layers.filter((l) => l.visible && l.cfg.type !== "raster").forEach((l) => {
      const st = l.cfg.style || {};
      const entries = st.colors && st.colorBy ? Object.entries(st.colors) : [[l.cfg.name || l.cfg.id, st.color || "#2a78d6"]];
      const g = document.createElement("div");
      g.className = "legend-group";
      if (entries.length > 1) {
        const t = document.createElement("div");
        t.className = "legend-title";
        t.textContent = l.cfg.name || l.cfg.id;
        g.appendChild(t);
      }
      entries.forEach(([label, c]) => {
        const row = document.createElement("div");
        row.className = "legend-item";
        const sw = document.createElement("span");
        sw.className = "swatch";
        sw.style.background = c;
        const tx = document.createElement("span");
        tx.textContent = label;
        row.append(sw, tx);
        g.appendChild(row);
      });
      box.appendChild(g);
    });
  }

  renderList();
  renderLegend();

  // Start with the panel closed on phones so the map is visible.
  if (window.matchMedia("(max-width: 600px)").matches) {
    $("panel").classList.add("collapsed");
    $("collapse").textContent = "Layers";
    $("collapse").setAttribute("aria-expanded", "false");
  }

  $("reset").addEventListener("click", () => map.fitBounds(config.view.bounds, { padding: 20 }));
  $("collapse").addEventListener("click", () => {
    const panel = $("panel");
    const collapsed = panel.classList.toggle("collapsed");
    $("collapse").textContent = collapsed ? "Layers" : "Hide";
    $("collapse").setAttribute("aria-expanded", String(!collapsed));
  });

  // ---------- live refresh (GeoJSON layers with refreshSeconds) ----------
  layers.forEach((l) => {
    const secs = l.cfg.refreshSeconds;
    if (l.cfg.type !== "geojson" || !(secs > 0)) return;
    setInterval(async () => {
      if (document.hidden) return;
      await loadData(l);
      const src = map.getSource(l.cfg.id);
      if (src && l.data && !l.error) src.setData(l.data);
      updateMeta(l);
    }, Math.max(5, secs) * 1000);
  });
})();
