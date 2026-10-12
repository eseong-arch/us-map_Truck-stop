# US Map

A vector web map of the United States built on MapLibre GL JS. It is a static site, so it can be hosted for free on GitHub Pages. Layers are listed in `layers.json`, so adding one means adding one entry to that file. There is no build step and nothing to install.

First layer: 48 truck stops (Flying J, Pilot, TA, Petro, Love's) in the Mojave region, with a source link and coordinate basis for each stop.

## Put it online (GitHub Pages)

1. Unzip this folder on your computer.
2. In your GitHub repository, click **Add file**, then **Upload files**.
3. Drag the **contents** of the folder into the page (so `index.html` ends up at the top level of the repository, not inside another folder). Drag the `data` and `vendor` folders too. Click **Commit changes**.
4. In the repository go to **Settings**, then **Pages**. Under "Build and deployment" choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
5. After a minute or two the site appears at `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`. GitHub shows the exact address on that Pages screen.

Opening `index.html` directly from your computer will not work, because the page loads its data over the web. Use the GitHub address.

## Add a layer

Add an object to the `layers` list in `layers.json`, then upload the changed file (and any new data file) to the repository.

**A GeoJSON file you upload** (points, lines or polygons):

```json
{
  "id": "rest-areas",
  "name": "Rest areas",
  "type": "geojson",
  "geometry": "point",
  "url": "data/rest_areas.geojson",
  "visible": true,
  "style": { "color": "#6250d6", "radius": 5 },
  "popup": { "title": "name", "fields": [{ "key": "route", "label": "Route" }] }
}
```

**A live feed**: use the feed's GeoJSON address as `url` and add `"refreshSeconds": 60`. The page re-fetches it on that interval and updates the map. The feed's server must allow other websites to read it (CORS); if the layer shows a "Load problem" message, that is the usual reason.

**Large layers** (whole-country roads, parcels): convert to a single `.pmtiles` file with tippecanoe, host it as a file, and add `{ "type": "pmtiles", "url": "data/roads.pmtiles", "sourceLayer": "roads", "geometry": "line" }`. GitHub has per-file size limits (about 100 MB, and 25 MB for browser uploads, from memory; check current limits), so very large files belong on object storage such as Cloudflare R2.

**Raster tiles** (for example a weather overlay): `{ "type": "raster", "tiles": ["https://.../{z}/{x}/{y}.png"], "attribution": "..." }`.

Style options: `color`, or `colorBy` plus a `colors` map to colour by a property; `radius` (points), `width` (lines), `opacity` (polygons and rasters). Add `"visible": false` to start a layer switched off. Clicking a feature opens a popup from the `popup` setting. Points take priority over lines and lines over polygons when features overlap.

## Update the truck stops

Replace `data/truck_stops.geojson` with a new file that has the same property names (`group`, `store`, `address`, `city`, `state`, `hwy_exit`, `coord_basis`, `source_url`). The `group` values decide the colours.

## Notes

- **Basemap:** OpenFreeMap (free, no account or key), built on OpenStreetMap data. Its operator states there is no uptime guarantee. If it cannot be reached the page falls back to a plain background and still shows your layers. To use a different basemap, change `basemap.style` in `layers.json` to any MapLibre style address.
- **Attribution:** the basemap's attribution appears on the map automatically. Keep it there.
- **Libraries:** MapLibre GL JS 5.24.0 (BSD-3-Clause) and PMTiles 4.5.0 are included in `vendor/` so the site does not depend on a CDN.
- **Truck-stop data:** coordinates come from each operator's location page (Pilot Flying J, TravelCenters of America) and, for two Love's stops, Roadtrippers, retrieved 2026-10-12. Each stop's popup says which. It is not a complete list.
- **Sharing a view:** the address bar keeps the map position, so copying the URL shares the same view.
