/*!
 * weather-station-card – universelle Wetterstations-Karte für Home Assistant
 * https://github.com/pasimatics/weather-station-card · MIT License
 *
 * Temperatur, Niederschlag und Wind mit Verlauf. Erkennt die Sensoren
 * automatisch anhand des gewählten Geräts (device_class + Namen), jede
 * Zuordnung lässt sich im Karteneditor überschreiben.
 */
const WS_VERSION = "0.1.4";

const I18N = {
  de: {
    title: "Wetterstation", temperature: "Temperatur", feels: "gefühlt", today: "heute",
    humidity: "Feuchte", dewpoint: "Taupunkt", pressure: "Luftdruck", uv: "UV-Index",
    rain: "Niederschlag", rain_today: "Heute", rain_rate: "Intensität", rain_event: "Ereignis",
    week: "Woche", month: "Monat", year: "Jahr", sum: "Summe", raining: "regnet",
    no_rain: "Kein Niederschlag im Zeitraum", wind: "Wind", gust: "Böe", max_1h: "max 1 h",
    max_today: "max heute", from: "aus", mean: "Mittel", gusts: "Böen", calm: "Windstill",
    loading: "Lade Verlauf …", nodata: "Keine Verlaufsdaten", updated: "Stand",
    battery: "Batterie schwach", illuminance: "Helligkeit",
    avg: "Ø", avg_calm: "windstill", steady: "beständig", variable: "wechselnd", veryvar: "umlaufend",
    avg_title: "Nach Windstärke gewichteter Mittelwert · Beständigkeit",
    nothing: "Keine Wetterstation gefunden. Wähle im Karteneditor ein Gerät oder einzelne Sensoren aus.",
    r24h: "24 Std", r7d: "7 Tage", r30d: "30 Tage",
    dirs: ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"],
    card: ["N", "O", "S", "W"],
    bft: ["Windstille", "leiser Zug", "leichte Brise", "schwache Brise", "mäßige Brise", "frische Brise",
      "starker Wind", "steifer Wind", "stürmischer Wind", "Sturm", "schwerer Sturm", "orkanartiger Sturm", "Orkan"],
  },
  en: {
    title: "Weather station", temperature: "Temperature", feels: "feels like", today: "today",
    humidity: "Humidity", dewpoint: "Dew point", pressure: "Pressure", uv: "UV index",
    rain: "Precipitation", rain_today: "Today", rain_rate: "Rate", rain_event: "Event",
    week: "Week", month: "Month", year: "Year", sum: "Total", raining: "raining",
    no_rain: "No precipitation in this period", wind: "Wind", gust: "Gust", max_1h: "max 1 h",
    max_today: "max today", from: "from", mean: "Average", gusts: "Gusts", calm: "Calm",
    loading: "Loading history …", nodata: "No history data", updated: "Updated",
    battery: "Battery low", illuminance: "Brightness",
    avg: "Avg", avg_calm: "calm", steady: "steady", variable: "variable", veryvar: "shifting",
    avg_title: "Speed-weighted average · steadiness",
    nothing: "No weather station found. Pick a device or individual sensors in the card editor.",
    r24h: "24 h", r7d: "7 days", r30d: "30 days",
    dirs: ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"],
    card: ["N", "E", "S", "W"],
    bft: ["Calm", "Light air", "Light breeze", "Gentle breeze", "Moderate breeze", "Fresh breeze",
      "Strong breeze", "Near gale", "Gale", "Strong gale", "Storm", "Violent storm", "Hurricane"],
  },
};

/* Sensor-Schlüssel, die automatisch erkannt oder manuell gesetzt werden können */
const ENTITY_KEYS = [
  "temperature", "feels_like", "dewpoint", "humidity", "pressure", "uv_index", "illuminance",
  "rain_today", "rain_rate", "rain_event", "rain_week", "rain_month", "rain_year", "rain_history",
  "wind_speed", "wind_gust", "wind_gust_max", "wind_direction", "battery",
];

const SPEED_TO_MS = { "m/s": 1, "km/h": 1 / 3.6, mph: 0.44704, kn: 0.514444, kt: 0.514444, knots: 0.514444, "ft/s": 0.3048 };
const BFT_LIMITS = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
const HOUR = 3600e3;
const DAY = 24 * HOUR;
const REFRESH_MS = 5 * 60e3;

const lang = () => ((document.documentElement.lang || navigator.language || "de").toLowerCase().startsWith("de") ? "de" : "en");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const tsOf = (v) => (typeof v === "number" ? (v < 1e11 ? v * 1000 : v) : Date.parse(v));
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const startOfHour = (d) => { const x = new Date(d); x.setMinutes(0, 0, 0); return x.getTime(); };
const beaufort = (ms) => { let i = 0; while (i < BFT_LIMITS.length && ms >= BFT_LIMITS[i]) i++; return i; };

/* ---------------------------------------------------------------- Auto-Erkennung */
const RE = {
  indoor: /indoor|inside|innen|_in_|room|raum|zimmer|keller|basement/,
  notAir: /dew|tau|feels|gef(ü|ue)hl|apparent|chill|heat.?index|hitze|soil|boden|water|wasser|pool|leaf|blatt|wet.?bulb|probe|cpu|battery|batter/,
  outdoor: /outdoor|outside|au(ß|ss)en|exterior/,
  feels: /feels|gef(ü|ue)hl|apparent/,
  dew: /dew|tau/,
  avg: /avg|mean|average|mittel|10m|10_m|2m_|_2m/,
  max: /max|peak|spitze|highest/,
  gust: /gust|b(ö|oe)e/,
};

function detectEntities(hass, devices) {
  const out = {};
  if (!hass?.entities || !devices.length) return out;
  const devs = new Set(devices);
  const cands = [];
  for (const reg of Object.values(hass.entities)) {
    if (!reg.device_id || !devs.has(reg.device_id)) continue;
    const st = hass.states[reg.entity_id];
    if (!st) continue;
    const a = st.attributes || {};
    cands.push({
      id: reg.entity_id,
      domain: reg.entity_id.split(".")[0],
      dc: a.device_class,
      unit: a.unit_of_measurement,
      sc: a.state_class,
      hidden: !!reg.hidden,
      key: `${reg.entity_id} ${reg.translation_key || ""} ${a.friendly_name || ""}`.toLowerCase(),
    });
  }
  const sensors = cands.filter((c) => c.domain === "sensor");
  const pick = (filter, prefer = []) => {
    const list = sensors.filter(filter);
    if (!list.length) return undefined;
    const score = (c) => {
      let s = c.hidden ? 50 : 0;
      const i = prefer.findIndex((re) => re.test(c.key));
      return s + (i === -1 ? prefer.length : i);
    };
    return list.sort((a, b) => score(a) - score(b) || a.id.length - b.id.length)[0].id;
  };
  const is = (c, re) => re.test(c.key);

  out.temperature = pick((c) => c.dc === "temperature" && !is(c, RE.indoor) && !is(c, RE.notAir), [RE.outdoor]);
  out.feels_like = pick((c) => c.dc === "temperature" && is(c, RE.feels) && !is(c, RE.indoor));
  out.dewpoint = pick((c) => c.dc === "temperature" && is(c, RE.dew) && !is(c, RE.indoor), [RE.outdoor]);
  out.humidity = pick((c) => c.dc === "humidity" && !is(c, RE.indoor) && !/soil|boden|leaf|blatt/.test(c.key), [RE.outdoor]);
  out.pressure = pick((c) => (c.dc === "pressure" || c.dc === "atmospheric_pressure") && !is(c, RE.indoor), [/rel|sea|meer|qnh|baro/, /abs/]);
  out.uv_index = pick((c) => /(^|[^a-z])uv/.test(c.key) && !/radiation|strahlung/.test(c.key));
  out.illuminance = pick((c) => (c.dc === "illuminance" || c.unit === "lx") && !is(c, RE.indoor), [/solar|sun|sonne|outdoor|au(ß|ss)en/]);

  const isRain = (c) => c.dc === "precipitation" || (!c.dc && /^(mm|in)$/.test(c.unit || "") && /rain|regen|precip|niederschlag/.test(c.key));
  out.rain_rate = pick((c) => (c.dc === "precipitation_intensity" || /\/h$/.test(c.unit || "") && /rain|regen/.test(c.key)) && !is(c, RE.max), [/rate|intens/]);
  out.rain_today = pick((c) => isRain(c) && /daily|today|heute|tages|_day|day_/.test(c.key) && !is(c, RE.max) && !/24h|24_h/.test(c.key));
  out.rain_event = pick((c) => isRain(c) && /event|ereignis/.test(c.key));
  out.rain_week = pick((c) => isRain(c) && /week|woche/.test(c.key));
  out.rain_month = pick((c) => isRain(c) && /month|monat/.test(c.key));
  out.rain_year = pick((c) => isRain(c) && /year|jahr/.test(c.key));
  const rainTotal = pick((c) => isRain(c) && /total|gesamt|accum|cumul|lifetime/.test(c.key) && c.sc);
  const hist = [rainTotal, out.rain_today, out.rain_year, out.rain_month, out.rain_week]
    .find((id) => id && hass.states[id]?.attributes?.state_class);
  out.rain_history = hist;

  out.wind_direction = pick((c) => c.dc === "wind_direction" || (c.unit === "°" && /wind|dir|richtung/.test(c.key)), [/^(?!.*(avg|mean|10m|mittel))/]);
  out.wind_speed = pick((c) => c.dc === "wind_speed" && !is(c, RE.gust) && !is(c, RE.max) && !is(c, RE.avg), [/speed|geschw/]);
  if (!out.wind_speed) out.wind_speed = pick((c) => c.dc === "wind_speed" && !is(c, RE.gust) && !is(c, RE.max));
  out.wind_gust = pick((c) => c.dc === "wind_speed" && is(c, RE.gust) && !is(c, RE.max) && !/daily|_day|today|heute/.test(c.key));
  out.wind_gust_max = pick((c) => c.dc === "wind_speed" && is(c, RE.max) && /daily|day|tag|today|heute/.test(c.key));

  const bat = cands.find((c) => c.domain === "binary_sensor" && c.dc === "battery");
  out.battery = bat?.id;
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}

/* ---------------------------------------------------------------- Zahlen / Achsen */
function niceTicks(lo, hi, count, minSpan, zero) {
  if (zero) { lo = Math.min(0, lo); hi = Math.max(hi, lo + minSpan); }
  else if (hi - lo < minSpan) { const m = (hi + lo) / 2; lo = m - minSpan / 2; hi = m + minSpan / 2; }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  const min = Math.floor(lo / step + 1e-9) * step;
  const max = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let v = min; v <= max + step / 1e6; v += step) ticks.push(Math.round(v / step) * step);
  return { min, max: max === min ? min + step : max, step, ticks };
}

function stepDigits(step) {
  let d = 0;
  while (d < 3 && Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) > 1e-6) d++;
  return d;
}

function nearestIndex(arr, t) {
  let lo = 0, hi = arr.length - 1;
  if (hi < 0) return -1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arr[mid] < t) lo = mid; else hi = mid; }
  return Math.abs(arr[lo] - t) <= Math.abs(arr[hi] - t) ? lo : hi;
}

/* ---------------------------------------------------------------- Styles */
const STYLE = `
:host { display:block;
  --ws-temp:#eb6834; --ws-rain:#2a78d6; --ws-wind:#199e70;
  --ws-surface: var(--ha-card-background, var(--card-background-color, #fff));
  --ws-grid: var(--divider-color, rgba(127,127,127,.2));
  --ws-ink: var(--primary-text-color, #141414);
  --ws-muted: var(--secondary-text-color, #727272);
}
:host([dark]) { --ws-temp:#d95926; --ws-rain:#3987e5; --ws-wind:#199e70; }
ha-card { padding:16px; container-type:inline-size; overflow:hidden; }
.top { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; gap:8px; margin-bottom:2px; min-height:24px; line-height:20px; }
.top .name { font-size:16px; font-weight:500; color:var(--ws-ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.top .upd { justify-self:end; font-size:12px; color:var(--ws-muted); white-space:nowrap; }
#lux { display:flex; align-items:center; }
.lux { display:inline-flex; align-items:center; gap:5px; font-size:13px; color:var(--ws-muted); white-space:nowrap; }
.lux b { color:var(--ws-ink); font-weight:500; }
.lux ha-icon { --mdc-icon-size:18px; width:18px; height:18px; color:var(--ws-muted); }
.lux .l { display:none; }
@container (min-width: 520px) { .lux .l { display:inline; } }
.warn { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--ws-ink); margin:4px 0; }
.warn ha-icon { --mdc-icon-size:16px; color:var(--warning-color, #fab219); }
.grid { display:grid; grid-template-columns:minmax(0,1fr); }
.sec { padding:14px 0 12px; border-top:1px solid var(--ws-grid); min-width:0; }
.sec:first-child { border-top:none; padding-top:8px; }
@container (min-width: 900px) {
  .grid { grid-template-columns:repeat(3, minmax(0,1fr)); column-gap:24px; }
  .sec { border-top:none; padding-top:8px; }
  .sec + .sec { border-left:1px solid var(--ws-grid); padding-left:24px; }
}
.head { display:flex; align-items:center; gap:8px; min-height:28px; margin-bottom:6px;
  color:var(--ws-ink); font-size:14px; font-weight:500; }
.head ha-icon { --mdc-icon-size:20px; color:var(--ws-muted); }
.head .aside { margin-left:auto; font-weight:400; font-size:12px; color:var(--ws-muted); }
[data-e] { cursor:pointer; }
.u { font-size:.55em; color:var(--ws-muted); font-weight:400; margin-left:2px; }
.hero { display:flex; align-items:flex-end; justify-content:space-between; gap:4px 12px; flex-wrap:wrap; }
.big { font-size:48px; line-height:1; color:var(--ws-ink); letter-spacing:-.02em; }
.big .u { font-size:20px; vertical-align:top; position:relative; top:4px; }
.sub { text-align:right; font-size:13px; color:var(--ws-muted); line-height:1.55; }
.sub b, .chips b, .foot b, .wline b { color:var(--ws-ink); font-weight:500; }
.chips { display:flex; flex-wrap:wrap; gap:2px 16px; margin-top:10px; font-size:13px; color:var(--ws-muted); }
.chips span { white-space:nowrap; }
.stats { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:8px; }
.stat .l { font-size:12px; color:var(--ws-muted); display:flex; align-items:center; gap:4px; }
.stat .v { font-size:22px; line-height:1.25; color:var(--ws-ink); white-space:nowrap; }
.pill { font-size:11px; line-height:16px; padding:0 6px; border-radius:8px; color:#fff; background:var(--ws-rain); }
.seg { margin-left:auto; display:inline-flex; border:1px solid var(--ws-grid); border-radius:8px; overflow:hidden; }
.seg button { all:unset; cursor:pointer; padding:3px 9px; font-size:12px; font-weight:400; color:var(--ws-muted); }
.seg button + button { border-left:1px solid var(--ws-grid); }
.seg button[aria-pressed="true"] { color:var(--ws-ink); font-weight:500; background:var(--ws-grid); }
.seg button:focus-visible { outline:2px solid var(--primary-color); outline-offset:-2px; }
.chart { position:relative; height:132px; margin-top:10px; outline:none; touch-action:pan-y; -webkit-tap-highlight-color:transparent; }
.chart:focus-visible { box-shadow:0 0 0 2px var(--primary-color); border-radius:4px; }
.chart svg { display:block; overflow:visible; }
.msg { position:absolute; left:0; right:0; top:0; bottom:18px; display:flex; align-items:center; justify-content:center;
  font-size:12px; color:var(--ws-muted); pointer-events:none; text-align:center; }
.dim { opacity:.55; transition:opacity .2s; }
.gl { stroke:var(--ws-grid); stroke-width:1; shape-rendering:crispEdges; }
.ax { font-size:11px; fill:var(--ws-muted); font-variant-numeric:tabular-nums; }
.yl { paint-order:stroke; stroke:var(--ws-surface); stroke-width:3px; stroke-linejoin:round; }
.lbl { font-size:11px; fill:var(--ws-ink); font-weight:500; paint-order:stroke; stroke:var(--ws-surface); stroke-width:3px; stroke-linejoin:round; }
.cross { position:absolute; top:14px; width:1px; background:var(--ws-muted); opacity:.45; pointer-events:none; display:none; }
.dot { position:absolute; width:8px; height:8px; margin:-4px 0 0 -4px; border-radius:50%;
  box-shadow:0 0 0 2px var(--ws-surface); pointer-events:none; display:none; }
.tip { position:absolute; top:0; transform:translate(-50%, calc(-100% - 6px)); z-index:3; pointer-events:none; display:none;
  background:var(--ws-surface); color:var(--ws-ink); border:1px solid var(--ws-grid); border-radius:8px;
  padding:5px 8px; font-size:12px; line-height:1.45; white-space:nowrap; box-shadow:0 4px 14px rgba(0,0,0,.18); }
.tip .tt { color:var(--ws-muted); }
.tip i { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
.legend { display:flex; gap:16px; font-size:12px; color:var(--ws-muted); margin-top:6px; }
.key { display:inline-block; width:14px; height:2px; border-radius:1px; vertical-align:middle; margin-right:6px; }
.key.wash { height:10px; border-radius:2px; opacity:.3; }
.foot { display:flex; flex-wrap:wrap; gap:2px 16px; font-size:12px; color:var(--ws-muted); margin-top:8px; }
.foot span { white-space:nowrap; }
.wind { display:flex; align-items:center; gap:16px; }
.compass { flex:0 0 auto; width:104px; height:104px; }
.wv { min-width:0; }
.wv .speed { font-size:34px; line-height:1.05; color:var(--ws-ink); letter-spacing:-.01em; }
.wline { font-size:13px; color:var(--ws-muted); line-height:1.55; }
.wline span { white-space:nowrap; }
.wline.parts { display:flex; flex-wrap:wrap; column-gap:12px; }
.empty { padding:8px 0; font-size:14px; color:var(--ws-muted); }
`;

/* ---------------------------------------------------------------- Karte */
class WeatherStationCard extends HTMLElement {
  static getConfigForm() {
    const de = lang() === "de";
    const L = de ? {
      name: "Titel", devices: "Wetterstation (Gerät/e)", hours_to_show: "Verlauf Temperatur & Wind",
      rain_range: "Regen-Zeitraum (Start)", wind_unit: "Windeinheit", temperature: "Außentemperatur",
      feels_like: "Gefühlte Temperatur", dewpoint: "Taupunkt", humidity: "Luftfeuchtigkeit", pressure: "Luftdruck",
      uv_index: "UV-Index", illuminance: "Helligkeit", rain_today: "Regen heute", rain_rate: "Regenintensität", rain_event: "Regen-Ereignis",
      rain_week: "Regen Woche", rain_month: "Regen Monat", rain_year: "Regen Jahr",
      rain_history: "Regen-Zähler für den Verlauf", wind_speed: "Windgeschwindigkeit", wind_gust: "Windböe",
      wind_gust_max: "Max. Böe heute", wind_direction: "Windrichtung", battery: "Batterie-Sensor",
      wind_avg_hours: "Mittlere Windrichtung über",
    } : {
      name: "Title", devices: "Weather station (device/s)", hours_to_show: "Temperature & wind history",
      rain_range: "Rain period (default)", wind_unit: "Wind unit", temperature: "Outdoor temperature",
      feels_like: "Feels like", dewpoint: "Dew point", humidity: "Humidity", pressure: "Pressure",
      uv_index: "UV index", illuminance: "Brightness", rain_today: "Rain today", rain_rate: "Rain rate", rain_event: "Rain event",
      rain_week: "Rain week", rain_month: "Rain month", rain_year: "Rain year",
      rain_history: "Rain counter for history", wind_speed: "Wind speed", wind_gust: "Wind gust",
      wind_gust_max: "Max gust today", wind_direction: "Wind direction", battery: "Battery sensor",
      wind_avg_hours: "Average wind direction over",
    };
    const ent = (name, dc, domain = "sensor") => ({ name, selector: { entity: { filter: dc ? { domain, device_class: dc } : { domain } } } });
    return {
      schema: [
        { name: "name", selector: { text: {} } },
        { name: "devices", selector: { device: { multiple: true, entity: [
          { domain: "sensor", device_class: "temperature" },
          { domain: "sensor", device_class: "precipitation" },
          { domain: "sensor", device_class: "wind_speed" },
        ] } } },
        { name: "", type: "grid", schema: [
          { name: "hours_to_show", selector: { number: { min: 6, max: 168, step: 6, mode: "box", unit_of_measurement: "h" } } },
          { name: "wind_unit", selector: { select: { mode: "dropdown", options: [
            { value: "auto", label: de ? "wie Sensor" : "as sensor" },
            { value: "km/h", label: "km/h" }, { value: "m/s", label: "m/s" },
            { value: "kn", label: de ? "Knoten" : "knots" }, { value: "mph", label: "mph" },
          ] } } },
        ] },
        { name: "", type: "grid", schema: [
          { name: "rain_range", selector: { select: { mode: "dropdown", options: [
            { value: "24h", label: de ? "24 Stunden" : "24 hours" },
            { value: "7d", label: de ? "7 Tage" : "7 days" },
            { value: "30d", label: de ? "30 Tage" : "30 days" },
          ] } } },
          { name: "wind_avg_hours", selector: { number: { min: 0, max: 24, step: 0.5, mode: "box", unit_of_measurement: "h" } } },
        ] },
        { name: "", type: "expandable", flatten: true, icon: "mdi:tune-variant",
          title: de ? "Sensoren manuell zuordnen (überschreibt Auto-Erkennung)" : "Assign sensors manually (overrides auto-detection)",
          schema: [
            ent("temperature", "temperature"), ent("feels_like", "temperature"), ent("dewpoint", "temperature"),
            ent("humidity", "humidity"), ent("pressure"), ent("uv_index"), ent("illuminance", "illuminance"),
            ent("rain_today", "precipitation"), ent("rain_rate", "precipitation_intensity"), ent("rain_event", "precipitation"),
            ent("rain_week", "precipitation"), ent("rain_month", "precipitation"), ent("rain_year", "precipitation"),
            ent("rain_history", "precipitation"),
            ent("wind_speed", "wind_speed"), ent("wind_gust", "wind_speed"), ent("wind_gust_max", "wind_speed"),
            ent("wind_direction"), ent("battery", "battery", "binary_sensor"),
          ] },
      ],
      computeLabel: (s) => L[s.name] ?? s.name,
      computeHelper: (s) => s.name === "rain_history"
        ? (de ? "Sensor mit Statistik (state_class), z. B. Gesamt- oder Tagesregen" : "Sensor with statistics (state_class), e.g. total or daily rain")
        : s.name === "wind_avg_hours"
          ? (de ? "Nach Windstärke gewichtet · 0 = aus" : "Weighted by wind speed · 0 = off")
        : s.name === "devices"
          ? (de ? "Sensoren werden automatisch erkannt. Mehrere Geräte möglich (z. B. getrennter Wind- und Regenmesser)." : "Sensors are detected automatically. Several devices allowed (e.g. separate wind and rain gauges).")
          : undefined,
    };
  }

  static getStubConfig(hass) {
    const byDev = {};
    for (const reg of Object.values(hass?.entities || {})) {
      if (!reg.device_id) continue;
      const dc = hass.states[reg.entity_id]?.attributes?.device_class;
      if (dc === "wind_speed" || dc === "precipitation" || dc === "temperature") {
        (byDev[reg.device_id] ||= new Set()).add(dc);
      }
    }
    const best = Object.entries(byDev).sort((a, b) => b[1].size - a[1].size)[0];
    return best && best[1].size >= 2 ? { devices: [best[0]] } : {};
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._data = {};
    this._charts = {};
    this._fetchedAt = 0;
    this._fetching = false;
    this._gen = 0;
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    const c = { hours_to_show: 24, rain_range: "24h", wind_unit: "auto", ...config };
    c.hours_to_show = Math.min(168, Math.max(1, Number(c.hours_to_show) || 24));
    if (!["24h", "7d", "30d"].includes(c.rain_range)) c.rain_range = "24h";
    const ah = Number(c.wind_avg_hours ?? 2);
    c.wind_avg_hours = Number.isFinite(ah) ? Math.min(24, Math.max(0, ah)) : 2;
    this._config = c;
    this._rainRange = c.rain_range;
    this._entRef = null;
    this._built = false;
    this._data = {};
    this._fetchedAt = 0;
    this._gen++;
    if (this._hass) this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  get hass() { return this._hass; }

  connectedCallback() {
    if (!this._ro && window.ResizeObserver) {
      this._ro = new ResizeObserver(() => {
        cancelAnimationFrame(this._raf);
        this._raf = requestAnimationFrame(() => this._drawCharts());
      });
    }
    this._ro?.observe(this);
    if (this._hass) this._update();
  }

  disconnectedCallback() { this._ro?.disconnect(); }

  getCardSize() { return 12; }

  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

  /* -------------------------------------------- Ablauf */
  _t(k) { return (I18N[this._lang] || I18N.de)[k]; }

  _resolve() {
    const c = this._config;
    const devices = [].concat(c.devices || c.device || []).filter(Boolean);
    const auto = detectEntities(this._hass, devices);
    const ent = { ...auto };
    for (const k of ENTITY_KEYS) if (c[k]) ent[k] = c[k];
    if (c.rain_history === undefined && !ent.rain_history) {
      ent.rain_history = [ent.rain_today, ent.rain_year, ent.rain_month]
        .find((id) => id && this._hass.states[id]?.attributes?.state_class);
    }
    this._ent = ent;
    this._devices = devices;
    this._tracked = [...new Set(Object.values(ent).filter(Boolean))];
  }

  _update() {
    const hass = this._hass;
    if (!hass || !this._config) return;
    this._lang = lang();
    if (hass.entities !== this._entRef) {
      const before = JSON.stringify(this._ent || {});
      this._entRef = hass.entities;
      this._resolve();
      if (JSON.stringify(this._ent) !== before) { this._built = false; this._data = {}; this._fetchedAt = 0; this._gen++; }
    }
    const dark = !!hass.themes?.darkMode;
    if (dark !== this.hasAttribute("dark")) {
      this.toggleAttribute("dark", dark);
      if (this._built) requestAnimationFrame(() => this._drawCharts());
    }
    if (!this._built) { this._build(); this._lastStates = null; }
    const changed = !this._lastStates || this._tracked.some((id) => hass.states[id] !== this._lastStates[id]);
    if (changed) {
      this._lastStates = Object.fromEntries(this._tracked.map((id) => [id, hass.states[id]]));
      this._renderValues();
    }
    if (Date.now() - this._fetchedAt > REFRESH_MS && !this._fetching) this._fetch();
  }

  /* -------------------------------------------- Helfer für Werte */
  _st(id) { return id ? this._hass.states[id] : undefined; }

  _num(id) {
    const s = this._st(id);
    if (!s) return null;
    const v = parseFloat(s.state);
    return Number.isFinite(v) ? v : null;
  }

  _unit(id) { return this._st(id)?.attributes?.unit_of_measurement || ""; }

  _digits(id, fallback) {
    const p = id ? this._hass.entities?.[id]?.display_precision : undefined;
    return isNum(p) ? p : fallback;
  }

  _fmt(v, digits = 1) {
    if (!isNum(v)) return "–";
    const loc = this._hass?.locale?.language || this._hass?.language || "de";
    try { return v.toLocaleString(loc, { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
    catch (e) { return v.toFixed(digits); }
  }

  _luxFmt(v) {
    if (!isNum(v)) return "–";
    if (v >= 1000) return `${this._fmt(v / 1000, v >= 100000 ? 0 : 1)} klx`;
    return `${this._fmt(v, 0)} lx`;
  }

  _val(id, digits, unit) {
    const v = this._num(id);
    const u = unit ?? this._unit(id);
    return `${this._fmt(v, this._digits(id, digits))}${u ? `<span class="u">${esc(u)}</span>` : ""}`;
  }

  _windUnit() {
    const u = this._config.wind_unit;
    if (u && u !== "auto" && SPEED_TO_MS[u]) return u;
    const eu = this._unit(this._ent.wind_speed) || this._unit(this._ent.wind_gust);
    return SPEED_TO_MS[eu] ? eu : "m/s";
  }

  _dirName(deg) { return this._t("dirs")[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]; }

  _windDigits() { return ["km/h", "mph"].includes(this._windUnit()) ? 0 : 1; }

  /* Wert einer Wind-Entität in m/s */
  _windMs(id) {
    const v = this._num(id);
    if (v === null) return null;
    return v * (SPEED_TO_MS[this._unit(id)] ?? 1);
  }

  _fromMs(ms) { return isNum(ms) ? ms / SPEED_TO_MS[this._windUnit()] : null; }

  _timeFmt(t, opts) {
    const loc = this._hass?.locale?.language || "de";
    return new Date(t).toLocaleString(loc, opts);
  }

  _moreInfo(id) {
    if (!id) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: id } }));
  }

  /* -------------------------------------------- Grundgerüst */
  _build() {
    const e = this._ent;
    const t = (k) => this._t(k);
    const hasTemp = !!e.temperature;
    const hasRain = !!(e.rain_today || e.rain_rate || e.rain_history || e.rain_event);
    const hasWind = !!(e.wind_speed || e.wind_direction || e.wind_gust);
    const devName = (() => {
      const d = this._devices?.[0] && this._hass.devices?.[this._devices[0]];
      return d ? (d.name_by_user || d.name) : "";
    })();
    const name = this._config.name ?? (devName || t("title"));
    const seg = ["24h", "7d", "30d"].map((r) =>
      `<button data-range="${r}" aria-pressed="${r === this._rainRange}">${t("r" + r)}</button>`).join("");

    let html = `<style>${STYLE}</style><ha-card>`;
    if (name || e.illuminance) html += `<div class="top"><span class="name">${esc(name)}</span><span id="lux"></span><span class="upd" id="upd"></span></div>`;
    html += `<div id="warn"></div><div class="grid">`;
    if (!hasTemp && !hasRain && !hasWind) html += `<div class="empty">${t("nothing")}</div>`;
    if (hasTemp) html += `
      <section class="sec">
        <div class="head"><ha-icon icon="mdi:thermometer"></ha-icon><span data-e="${e.temperature}">${t("temperature")}</span></div>
        <div id="t-val"></div>
        <div class="chart" id="t-chart" tabindex="0" role="img" aria-label="${t("temperature")}"></div>
      </section>`;
    if (hasRain) html += `
      <section class="sec">
        <div class="head"><ha-icon icon="mdi:weather-pouring"></ha-icon><span data-e="${e.rain_today || e.rain_history || ""}">${t("rain")}</span>
          ${e.rain_history ? `<div class="seg" role="group">${seg}</div>` : ""}</div>
        <div id="r-val"></div>
        ${e.rain_history ? `<div class="chart" id="r-chart" tabindex="0" role="img" aria-label="${t("rain")}"></div>` : ""}
        <div class="foot" id="r-foot"></div>
      </section>`;
    if (hasWind) html += `
      <section class="sec">
        <div class="head"><ha-icon icon="mdi:weather-windy"></ha-icon><span data-e="${e.wind_speed || e.wind_direction}">${t("wind")}</span></div>
        <div id="w-val"></div>
        ${e.wind_speed || e.wind_gust ? `<div class="chart" id="w-chart" tabindex="0" role="img" aria-label="${t("wind")}"></div>
        <div class="legend">${e.wind_speed ? `<span><i class="key" style="background:var(--ws-wind)"></i>${t("mean")}</span>` : ""}${e.wind_gust ? `<span><i class="key wash" style="background:var(--ws-wind)"></i>${t("gusts")}</span>` : ""}</div>` : ""}
      </section>`;
    html += `</div></ha-card>`;
    this.shadowRoot.innerHTML = html;
    this._built = true;

    const root = this.shadowRoot;
    root.querySelector("ha-card").addEventListener("click", (ev) => {
      const r = ev.target.closest?.("[data-range]");
      if (r) { this._setRange(r.dataset.range); return; }
      const m = ev.target.closest?.("[data-e]");
      if (m && m.dataset.e) this._moreInfo(m.dataset.e);
    });
    for (const id of ["t-chart", "r-chart", "w-chart"]) {
      const el = root.getElementById(id);
      if (el) this._bindChart(el);
    }
    this._drawCharts();
  }

  _setRange(r) {
    if (r === this._rainRange) return;
    this._rainRange = r;
    this.shadowRoot.querySelectorAll("[data-range]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === r)));
    const el = this.shadowRoot.getElementById("r-chart");
    el?.querySelector("svg")?.classList.add("dim");
    const gen = this._gen;
    this._fetchRain(r).then((patch) => {
      if (gen !== this._gen || r !== this._rainRange) return;
      Object.assign(this._data, patch);
      this._renderValues();
      this._drawCharts();
    });
  }

  /* -------------------------------------------- Live-Werte */
  _renderValues() {
    if (!this._built) return;
    const root = this.shadowRoot;
    const e = this._ent;
    const t = (k) => this._t(k);
    const d = this._data;

    // Stand / Warnungen
    const upd = root.getElementById("upd");
    if (upd) {
      const last = Math.max(0, ...this._tracked.map((id) => Date.parse(this._st(id)?.last_updated || 0) || 0));
      upd.textContent = last ? `${t("updated")} ${this._timeFmt(last, { hour: "2-digit", minute: "2-digit" })}` : "";
    }
    const warn = root.getElementById("warn");
    if (warn) warn.innerHTML = this._st(e.battery)?.state === "on"
      ? `<div class="warn" data-e="${e.battery}"><ha-icon icon="mdi:battery-alert-variant-outline"></ha-icon>${t("battery")}</div>` : "";

    // Helligkeit (Kopfzeile, mittig)
    const lux = root.getElementById("lux");
    if (lux) {
      const lv = this._num(e.illuminance);
      lux.innerHTML = e.illuminance
        ? `<span class="lux" data-e="${e.illuminance}" title="${esc(t("illuminance"))}: ${isNum(lv) ? this._fmt(lv, 0) : "–"} lx"><ha-icon icon="${isNum(lv) && lv < 10 ? "mdi:weather-night" : "mdi:white-balance-sunny"}"></ha-icon><span class="l">${t("illuminance")}</span><b>${this._luxFmt(lv)}</b></span>`
        : "";
    }

    // Temperatur
    const tv = root.getElementById("t-val");
    if (tv) {
      const tu = this._unit(e.temperature);
      const deg = tu.replace(/[CFK]$/, "") || "°";
      const sub = [];
      if (e.feels_like) sub.push(`<span data-e="${e.feels_like}">${t("feels")} <b>${this._fmt(this._num(e.feels_like), this._digits(e.feels_like, 1))}${esc(deg)}</b></span>`);
      if (d.tToday) sub.push(`<span data-e="${e.temperature}">↓ <b>${this._fmt(d.tToday.min, 1)}${esc(deg)}</b> &nbsp;↑ <b>${this._fmt(d.tToday.max, 1)}${esc(deg)}</b> ${t("today")}</span>`);
      const chips = [];
      if (e.humidity) chips.push(`<span data-e="${e.humidity}">${t("humidity")} <b>${this._fmt(this._num(e.humidity), this._digits(e.humidity, 0))} %</b></span>`);
      if (e.dewpoint) chips.push(`<span data-e="${e.dewpoint}">${t("dewpoint")} <b>${this._fmt(this._num(e.dewpoint), this._digits(e.dewpoint, 1))} ${esc(this._unit(e.dewpoint))}</b></span>`);
      if (e.pressure) {
        const pu = this._unit(e.pressure);
        chips.push(`<span data-e="${e.pressure}">${t("pressure")} <b>${this._fmt(this._num(e.pressure), this._digits(e.pressure, /inhg/i.test(pu) ? 2 : /kpa/i.test(pu) ? 1 : 0))} ${esc(pu)}</b></span>`);
      }
      if (e.uv_index) chips.push(`<span data-e="${e.uv_index}">${t("uv")} <b>${this._fmt(this._num(e.uv_index), this._digits(e.uv_index, 0))}</b></span>`);
      tv.innerHTML = `
        <div class="hero">
          <div class="big" data-e="${e.temperature}">${this._fmt(this._num(e.temperature), this._digits(e.temperature, 1))}<span class="u">${esc(tu)}</span></div>
          <div class="sub">${sub.join("<br>")}</div>
        </div>
        ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}`;
    }

    // Regen
    const rv = root.getElementById("r-val");
    if (rv) {
      const ru = this._unit(e.rain_today || e.rain_history || e.rain_event) || "mm";
      const rate = this._num(e.rain_rate);
      let today = this._num(e.rain_today);
      if (today === null && d.rainToday !== undefined) today = d.rainToday;
      const stat = (label, inner, id) => `<div class="stat"${id ? ` data-e="${id}"` : ""}><div class="l">${label}</div><div class="v">${inner}</div></div>`;
      const items = [];
      items.push(stat(t("rain_today"), `${this._fmt(today, this._digits(e.rain_today, 1))}<span class="u">${esc(ru)}</span>`, e.rain_today || e.rain_history));
      if (e.rain_rate) items.push(stat(`${t("rain_rate")}${rate > 0 ? ` <span class="pill">${t("raining")}</span>` : ""}`, this._val(e.rain_rate, 1), e.rain_rate));
      if (e.rain_event) items.push(stat(t("rain_event"), this._val(e.rain_event, 1), e.rain_event));
      rv.innerHTML = `<div class="stats">${items.join("")}</div>`;
      const foot = root.getElementById("r-foot");
      const f = [];
      if (d.rainSum !== undefined) f.push(`<span>${t("sum")} ${t("r" + (d.rainRange || this._rainRange))}: <b>${this._fmt(d.rainSum, 1)} ${esc(ru)}</b></span>`);
      for (const [k, l] of [["rain_week", "week"], ["rain_month", "month"], ["rain_year", "year"]]) {
        if (e[k]) f.push(`<span data-e="${e[k]}">${t(l)} <b>${this._fmt(this._num(e[k]), this._digits(e[k], 1))} ${esc(this._unit(e[k]))}</b></span>`);
      }
      foot.innerHTML = f.join("");
    }

    // Wind
    const wv = root.getElementById("w-val");
    if (wv) {
      const wu = this._windUnit();
      const wd = this._windDigits();
      const ms = this._windMs(e.wind_speed);
      const gustMs = this._windMs(e.wind_gust);
      const dir = this._num(e.wind_direction);
      const b = isNum(ms) ? beaufort(ms) : null;
      let maxToday = this._windMs(e.wind_gust_max);
      if (isNum(d.gustToday)) maxToday = isNum(maxToday) ? Math.max(maxToday, d.gustToday) : d.gustToday;
      const parts = [];
      if (e.wind_gust) parts.push(`<span data-e="${e.wind_gust}">${t("gust")} <b>${this._fmt(this._fromMs(gustMs), wd)}</b></span>`);
      if (isNum(d.gust1h)) parts.push(`<span>${t("max_1h")} <b>${this._fmt(this._fromMs(d.gust1h), wd)}</b></span>`);
      if (isNum(maxToday)) parts.push(`<span data-e="${e.wind_gust_max || e.wind_gust || ""}">${t("max_today")} <b>${this._fmt(this._fromMs(maxToday), wd)}</b></span>`);
      const dirTxt = isNum(dir) ? `${t("from")} <b>${this._dirName(dir)}</b> (${Math.round(dir)}°)` : "";
      // Mittlere Windrichtung (gewichtet)
      const wa = d.windAvg;
      let avgTxt = "";
      if (wa) {
        const hh = `${t("avg")} ${this._fmt(wa.hours, Number.isInteger(wa.hours) ? 0 : 1)} h`;
        avgTxt = wa.calm
          ? `<span>${hh} <b>${t("avg_calm")}</b></span>`
          : `<span>${hh} ${t("from")} <b>${this._dirName(wa.deg)}</b> (${Math.round(wa.deg)}°)</span><span>${t(wa.R >= 0.8 ? "steady" : wa.R >= 0.5 ? "variable" : "veryvar")}</span>`;
      }
      const avgTitle = wa && !wa.calm ? `${t("avg_title")} ${Math.round(wa.R * 100)} %` : "";
      wv.innerHTML = `
        <div class="wind">
          ${e.wind_direction ? `<div class="compass" data-e="${e.wind_direction}">${this._compass(dir, isNum(ms) && ms < 0.3)}</div>` : ""}
          <div class="wv">
            ${e.wind_speed ? `<div class="speed" data-e="${e.wind_speed}">${this._fmt(this._fromMs(ms), wd)}<span class="u">${esc(wu)}</span></div>` : ""}
            ${b !== null ? `<div class="wline">Bft <b>${b}</b> · ${esc(this._t("bft")[b])}</div>` : ""}
            ${dirTxt ? `<div class="wline" data-e="${e.wind_direction}">${dirTxt}</div>` : ""}
            ${avgTxt ? `<div class="wline parts" data-e="${e.wind_direction}"${avgTitle ? ` title="${esc(avgTitle)}"` : ""}>${avgTxt}</div>` : ""}
            ${parts.length ? `<div class="wline parts">${parts.join("")}</div>` : ""}
          </div>
        </div>`;
    }
  }

  _compass(deg, calm) {
    const c = 52, R = 46;
    const L = this._t("card");
    let s = `<svg viewBox="0 0 104 104" width="104" height="104" role="img" aria-label="${isNum(deg) ? Math.round(deg) + "°" : ""}">`;
    s += `<circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="var(--ws-grid)" stroke-width="1"/>`;
    for (let i = 0; i < 16; i++) {
      const a = (i * 22.5 * Math.PI) / 180;
      const major = i % 4 === 0;
      const r1 = R - (major ? 7 : 4);
      s += `<line x1="${(c + Math.sin(a) * R).toFixed(1)}" y1="${(c - Math.cos(a) * R).toFixed(1)}" x2="${(c + Math.sin(a) * r1).toFixed(1)}" y2="${(c - Math.cos(a) * r1).toFixed(1)}" stroke="var(--ws-muted)" stroke-opacity="${major ? 0.8 : 0.4}" stroke-width="1"/>`;
    }
    L.forEach((l, i) => {
      const a = (i * 90 * Math.PI) / 180, r = R - 15;
      s += `<text x="${(c + Math.sin(a) * r).toFixed(1)}" y="${(c - Math.cos(a) * r + 4).toFixed(1)}" text-anchor="middle" class="ax" style="font-weight:${i === 0 ? 600 : 400}">${l}</text>`;
    });
    if (isNum(deg)) {
      // Pfeil: kommt aus "deg" (Rand) und zeigt in Windrichtung durch die Mitte
      s += `<g transform="rotate(${deg.toFixed(1)} ${c} ${c})" opacity="${calm ? 0.35 : 1}">
        <line x1="${c}" y1="${c - R + 4}" x2="${c}" y2="${c + R - 34}" stroke="var(--ws-wind)" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M${c - 7} ${c + R - 36} L${c} ${c + R - 23} L${c + 7} ${c + R - 36} Z" fill="var(--ws-wind)" stroke="var(--ws-surface)" stroke-width="2" stroke-linejoin="round"/>
        <circle cx="${c}" cy="${c - R + 4}" r="4" fill="var(--ws-wind)" stroke="var(--ws-surface)" stroke-width="2"/>
      </g>`;
    }
    return s + "</svg>";
  }

  /* -------------------------------------------- Daten */
  async _stats(ids, start, end, period, types) {
    if (!ids.length) return {};
    const units = { speed: "m/s" };
    const tu = this._unit(this._ent.temperature);
    if (["°C", "°F", "K"].includes(tu)) units.temperature = tu;
    const ru = this._unit(this._ent.rain_history);
    if (["mm", "in", "cm"].includes(ru)) units.distance = ru;
    const msg = {
      type: "recorder/statistics_during_period",
      start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(),
      statistic_ids: ids, period, types, units,
    };
    try { return await this._hass.callWS(msg); }
    catch (e) {
      delete msg.units;
      try { const res = await this._hass.callWS(msg); return Object.assign(res || {}, { __noUnits: true }); }
      catch (e2) { return {}; }
    }
  }

  /* Fallback ohne Statistik: Rohverlauf in Zeitfenster bündeln */
  async _historyBuckets(id, start, end, bucket) {
    try {
      const res = await this._hass.callWS({
        type: "history/history_during_period", start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(),
        entity_ids: [id], minimal_response: true, no_attributes: true, significant_changes_only: false,
      });
      const rows = res?.[id] || [];
      const map = new Map();
      for (const r of rows) {
        const v = parseFloat(r.s);
        const ts = tsOf(r.lu ?? r.lc);
        if (!Number.isFinite(v) || !Number.isFinite(ts)) continue;
        const k = Math.floor(ts / bucket) * bucket;
        const b = map.get(k) || { start: k, sum: 0, n: 0, min: v, max: v };
        b.sum += v; b.n++; b.min = Math.min(b.min, v); b.max = Math.max(b.max, v);
        map.set(k, b);
      }
      return [...map.values()].sort((a, b) => a.start - b.start).map((b) => ({ start: b.start, mean: b.sum / b.n, min: b.min, max: b.max, raw: true }));
    } catch (e) { return []; }
  }

  async _fetch() {
    const gen = this._gen;
    this._fetching = true;
    this._fetchedAt = Date.now();
    let patches = [];
    try {
      patches = await Promise.all([this._fetchLines(), this._fetchRain(this._rainRange), this._fetchAvg()]);
    } catch (e) {
      console.warn("weather-station-card:", e);
    } finally {
      this._fetching = false;
    }
    if (gen !== this._gen) { this._fetchedAt = 0; if (this._hass) this._update(); return; }
    for (const p of patches) Object.assign(this._data, p);
    this._renderValues();
    this._drawCharts();
  }

  async _fetchLines() {
    const e = this._ent;
    const now = Date.now();
    const hours = this._config.hours_to_show;
    const start = Math.min(now - hours * HOUR, startOfDay(now));
    const period = hours > 72 ? "hour" : "5minute";
    const bucket = period === "hour" ? HOUR : 5 * 60e3;
    const ids = [e.temperature, e.wind_speed, e.wind_gust].filter(Boolean);
    if (!ids.length) return {};
    const res = await this._stats(ids, start, now, period, ["mean", "min", "max"]);
    const get = async (id) => {
      if (!id) return null;
      let rows = (res?.[id] || []).map((r) => ({ start: tsOf(r.start), mean: r.mean, min: r.min, max: r.max }));
      if (!rows.length) rows = await this._historyBuckets(id, start, now, bucket);
      return rows;
    };
    const [tRows, sRows, gRows] = await Promise.all([get(e.temperature), get(e.wind_speed), get(e.wind_gust)]);
    const sod = startOfDay(now);
    const noUnits = !!res.__noUnits;
    const d = {};
    d.period = bucket;
    d.lineStart = now - hours * HOUR;
    d.lineEnd = now;

    if (tRows) {
      const pts = tRows.filter((r) => isNum(r.mean)).map((r) => [r.start + bucket / 2, r.mean]);
      const today = tRows.filter((r) => r.start >= sod);
      const lo = today.map((r) => r.min).filter(isNum), hi = today.map((r) => r.max).filter(isNum);
      const live = this._num(e.temperature);
      if (isNum(live)) { lo.push(live); hi.push(live); }
      d.tToday = lo.length ? { min: Math.min(...lo), max: Math.max(...hi) } : undefined;
      d.temp = pts;
    }
    // Windwerte: Statistik kommt in m/s; Rohverlauf in Sensoreinheit
    const toMs = (rows, id, field) => rows.filter((r) => isNum(r[field])).map((r) => [r.start + bucket / 2, r.raw || noUnits ? r[field] * (SPEED_TO_MS[this._unit(id)] ?? 1) : r[field]]);
    if (sRows) d.speed = toMs(sRows, e.wind_speed, "mean");
    if (gRows) d.gust = toMs(gRows, e.wind_gust, "max");
    const gustSrc = gRows ? d.gust : d.speed ? toMs(sRows, e.wind_speed, "max") : [];
    const gust1 = gustSrc.filter((p) => p[0] >= now - HOUR).map((p) => p[1]);
    const gToday = gustSrc.filter((p) => p[0] >= sod).map((p) => p[1]);
    const liveG = this._windMs(e.wind_gust ?? e.wind_speed);
    if (isNum(liveG)) { gust1.push(liveG); gToday.push(liveG); }
    d.gust1h = gust1.length ? Math.max(...gust1) : undefined;
    d.gustToday = gToday.length ? Math.max(...gToday) : undefined;
    return d;
  }

  /* Rohverlauf als [[Zeit, Wert], …] */
  async _rawStates(id, start, end) {
    try {
      const res = await this._hass.callWS({
        type: "history/history_during_period", start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(),
        entity_ids: [id], minimal_response: true, no_attributes: true, significant_changes_only: false,
      });
      return (res?.[id] || []).map((r) => [tsOf(r.lu ?? r.lc), parseFloat(r.s)])
        .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
    } catch (e) { return []; }
  }

  /* Mittlere Windrichtung als Vektormittel, gewichtet mit der Windgeschwindigkeit.
     R (0–1) = Beständigkeit: 1 = Wind kam die ganze Zeit aus derselben Richtung. */
  async _fetchAvg() {
    const e = this._ent;
    const hrs = this._config.wind_avg_hours;
    if (!e.wind_direction || !(hrs > 0)) return { windAvg: undefined };
    const now = Date.now(), start = now - hrs * HOUR;
    const res = await this._stats([e.wind_direction, e.wind_speed].filter(Boolean), start, now, "5minute", ["mean"]);
    const toMs = SPEED_TO_MS[this._unit(e.wind_speed)] ?? 1;
    const samples = []; // [Richtung °, Zeitgewicht, Geschwindigkeit m/s | null]
    const dirRows = (res?.[e.wind_direction] || []).filter((r) => isNum(r.mean));
    if (dirRows.length) {
      const spd = new Map((res?.[e.wind_speed] || []).filter((r) => isNum(r.mean))
        .map((r) => [tsOf(r.start), res.__noUnits ? r.mean * toMs : r.mean]));
      for (const r of dirRows) {
        const s = e.wind_speed ? spd.get(tsOf(r.start)) : null;
        if (e.wind_speed && !isNum(s)) continue;
        samples.push([r.mean, 1, s]);
      }
    } else {
      // Keine Langzeitstatistik: Rohwerte, zeitgewichtet
      const dirs = await this._rawStates(e.wind_direction, start, now);
      const spds = e.wind_speed ? await this._rawStates(e.wind_speed, start, now) : null;
      const spdT = spds ? spds.map((p) => p[0]) : null;
      dirs.forEach(([ts, deg], i) => {
        const t0 = Math.max(ts, start), t1 = i + 1 < dirs.length ? dirs[i + 1][0] : now;
        const dur = Math.max(0, t1 - t0) / 60e3;
        if (!dur) return;
        let s = null;
        if (spds) { const j = nearestIndex(spdT, t0); if (j < 0) return; s = spds[j][1] * toMs; }
        samples.push([deg, dur, s]);
      });
    }
    if (!samples.length) return { windAvg: undefined };
    let x = 0, y = 0, wSum = 0, tSum = 0, sSum = 0, hasSpeed = false;
    for (const [deg, tw, s] of samples) {
      const w = s === null ? tw : tw * Math.max(0, s);
      const a = (deg * Math.PI) / 180;
      x += w * Math.sin(a); y += w * Math.cos(a); wSum += w; tSum += tw;
      if (s !== null) { sSum += tw * Math.max(0, s); hasSpeed = true; }
    }
    const meanSpeed = hasSpeed ? sSum / tSum : null;
    const calm = wSum <= 0 || (meanSpeed !== null && meanSpeed < 0.3);
    const deg = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
    const R = wSum > 0 ? Math.min(1, Math.hypot(x, y) / wSum) : 0;
    return { windAvg: { deg, R, calm, hours: hrs } };
  }

  async _fetchRain(range) {
    const e = this._ent;
    const id = e.rain_history;
    if (!id) return {};
    const now = Date.now();
    const d = {};
    let buckets;
    if (range === "24h") {
      const h0 = startOfHour(now) - 23 * HOUR;
      const res = await this._stats([id], h0, now, "5minute", ["change"]);
      buckets = Array.from({ length: 24 }, (_, i) => ({ start: h0 + i * HOUR, end: h0 + (i + 1) * HOUR, v: 0, has: false }));
      for (const r of res?.[id] || []) {
        const i = Math.floor((tsOf(r.start) - h0) / HOUR);
        if (i >= 0 && i < 24 && isNum(r.change)) { buckets[i].v += Math.max(0, r.change); buckets[i].has = true; }
      }
      if (this._num(e.rain_today) === null) {
        const sod = startOfDay(now);
        d.rainToday = buckets.filter((b) => b.start >= sod).reduce((a, b) => a + b.v, 0);
      }
    } else {
      const n = range === "7d" ? 7 : 30;
      const d0 = startOfDay(now);
      const starts = [];
      for (let i = n - 1; i >= 0; i--) { const x = new Date(d0); x.setDate(x.getDate() - i); starts.push(x.getTime()); }
      const res = await this._stats([id], starts[0], now, "day", ["change"]);
      buckets = starts.map((s, i) => ({ start: s, end: starts[i + 1] ?? startOfDay(s + 36 * HOUR), v: 0, has: false }));
      for (const r of res?.[id] || []) {
        const ts = tsOf(r.start);
        const i = buckets.findIndex((b) => ts >= b.start - HOUR && ts < b.end - HOUR);
        if (i >= 0 && isNum(r.change)) { buckets[i].v += Math.max(0, r.change); buckets[i].has = true; }
      }
      const live = this._num(e.rain_today);
      const last = buckets[buckets.length - 1];
      if (live !== null) { last.v = live; last.has = true; }
      else d.rainToday = last.v;
    }
    d.rain = buckets;
    d.rainRange = range;
    d.rainHasData = buckets.some((b) => b.has);
    d.rainSum = buckets.reduce((a, b) => a + b.v, 0);
    return d;
  }

  /* -------------------------------------------- Diagramme */
  _drawCharts() {
    if (!this._built) return;
    const root = this.shadowRoot;
    const d = this._data;
    const t = (k) => this._t(k);
    const loaded = this._fetchedAt > 0 && !this._fetching;
    const tEl = root.getElementById("t-chart");
    if (tEl) {
      if (!d.temp) this._message(tEl, loaded ? t("nodata") : t("loading"));
      else {
        const pts = this._withLive(d.temp, this._num(this._ent.temperature));
        const tu = this._unit(this._ent.temperature);
        const deg = tu.replace(/[CFK]$/, "") || "°";
        this._lineChart(tEl, {
          series: [{ pts, color: "var(--ws-temp)", line: true, wash: 0.1, hover: true, name: t("temperature"), unit: tu, digits: 1 }],
          minSpan: 2, zero: false, extremes: true, deg,
        });
      }
    }
    const wEl = root.getElementById("w-chart");
    if (wEl) {
      if (!d.speed && !d.gust) this._message(wEl, loaded ? t("nodata") : t("loading"));
      else {
        const W = wEl.clientWidth || 400;
        let res = d.period;
        const conv = (pts, agg) => {
          const r = this._downsample(pts.map((p) => [p[0], this._fromMs(p[1])]), W, agg);
          res = r.res;
          return r.pts;
        };
        const series = [];
        const wu = this._windUnit();
        const wd = this._windDigits();
        if (d.gust) series.push({ pts: this._withLive(conv(d.gust, "max"), this._fromMs(this._windMs(this._ent.wind_gust))), color: "var(--ws-wind)", wash: 0.18, edge: true, hover: true, name: t("gust"), unit: wu, digits: wd });
        if (d.speed) series.push({ pts: this._withLive(conv(d.speed, "mean"), this._fromMs(this._windMs(this._ent.wind_speed))), color: "var(--ws-wind)", line: true, hover: true, name: t("mean"), unit: wu, digits: wd });
        this._lineChart(wEl, { series, minSpan: wu === "km/h" || wu === "mph" ? 10 : 2, zero: true, res });
      }
    }
    const rEl = root.getElementById("r-chart");
    if (rEl) {
      if (!d.rain) this._message(rEl, loaded ? t("nodata") : t("loading"));
      else this._barChart(rEl, d.rain, d.rainRange);
    }
  }

  /* Auf ~4 px je Punkt verdichten (Mittelwert bzw. Maximum, damit Böen-Spitzen erhalten bleiben) */
  _downsample(pts, W, agg) {
    const d = this._data;
    const size = Math.ceil((d.lineEnd - d.lineStart) / Math.max(48, W / 4) / d.period) * d.period;
    if (size <= d.period || pts.length < 3) return { pts, res: d.period };
    const out = [];
    let cur = null;
    const flush = () => cur && out.push([cur.k + size / 2, agg === "max" ? cur.max : cur.sum / cur.n]);
    for (const [ts, v] of pts) {
      const k = Math.floor(ts / size) * size;
      if (!cur || cur.k !== k) { flush(); cur = { k, sum: 0, n: 0, max: -Infinity }; }
      cur.sum += v; cur.n++; if (v > cur.max) cur.max = v;
    }
    flush();
    return { pts: out, res: size };
  }

  _withLive(pts, live) {
    if (!isNum(live) || !pts.length) return pts;
    const now = Date.now();
    return pts[pts.length - 1][0] < now ? [...pts, [now, live]] : pts;
  }

  _message(el, text) {
    if (el.querySelector("svg")) { el.querySelector("svg").classList.add("dim"); return; }
    el._geo = null;
    el.innerHTML = `<div class="msg">${esc(text)}</div>`;
  }

  _xTicks(t0, t1, W) {
    const span = (t1 - t0) / HOUR;
    const step = span <= 12 ? 3 : span <= 36 ? 6 : span <= 84 ? 12 : 24;
    const out = [];
    const x = new Date(t0);
    x.setMinutes(0, 0, 0);
    if (step === 24) x.setHours(0); else x.setHours(Math.ceil(x.getHours() / step) * step);
    while (x.getTime() < t0) x.setHours(x.getHours() + step);
    for (; x.getTime() <= t1; x.setHours(x.getHours() + step)) {
      const ts = x.getTime();
      const label = step === 24 || (step === 12 && x.getHours() === 0)
        ? this._timeFmt(ts, { weekday: "short" })
        : this._timeFmt(ts, { hour: "2-digit", minute: "2-digit" });
      out.push({ t: ts, label });
      if (out.length > 40) break;
    }
    return out;
  }

  _lineChart(el, m) {
    const W = el.clientWidth;
    const H = el.clientHeight || 132;
    if (!W) return;
    const d = this._data;
    const PT = 14, AX = 18, ph = H - PT - AX;
    const t0 = d.lineStart, t1 = d.lineEnd > t0 ? Math.max(d.lineEnd, Date.now()) : t0 + HOUR;
    const series = m.series.map((s) => ({ ...s, pts: s.pts.filter((p) => p[0] >= t0 - d.period && isNum(p[1])) }));
    let lo = Infinity, hi = -Infinity;
    for (const s of series) for (const p of s.pts) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
    if (!isFinite(lo)) { el._geo = null; el.innerHTML = `<div class="msg">${esc(this._t("nodata"))}</div>`; return; }
    const tk = niceTicks(lo, hi, 3, m.minSpan, m.zero);
    const x = (ts) => Math.max(0, Math.min(W, ((ts - t0) / (t1 - t0)) * W));
    const y = (v) => PT + ph - ((v - tk.min) / (tk.max - tk.min)) * ph;
    const base = y(tk.min);
    const gap = Math.max(3 * d.period, 20 * 60e3, 2.5 * (m.res || 0));
    const n = (v) => v.toFixed(1);
    const yDigits = stepDigits(tk.step);

    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
    for (const v of tk.ticks) {
      const yy = Math.round(y(v)) + 0.5;
      svg += `<line class="gl" x1="0" x2="${W}" y1="${yy}" y2="${yy}"/>`;
    }
    for (const xt of this._xTicks(t0, t1, W)) {
      const xx = x(xt.t);
      if (xx < 16 || xx > W - 16) continue;
      svg += `<text class="ax" x="${n(xx)}" y="${H - 4}" text-anchor="middle">${esc(xt.label)}</text>`;
    }
    for (const s of series) {
      const segs = [];
      let cur = [];
      for (const p of s.pts) {
        if (cur.length && p[0] - cur[cur.length - 1][0] > gap) { segs.push(cur); cur = []; }
        cur.push(p);
      }
      if (cur.length) segs.push(cur);
      for (const seg of segs) {
        const line = seg.map((p, i) => `${i ? "L" : "M"}${n(x(p[0]))},${n(y(p[1]))}`).join("");
        if (s.wash) svg += `<path d="${line}L${n(x(seg[seg.length - 1][0]))},${n(base)}L${n(x(seg[0][0]))},${n(base)}Z" fill="${s.color}" fill-opacity="${s.wash}" stroke="none"/>`;
        if (s.edge) svg += `<path d="${line}" fill="none" stroke="${s.color}" stroke-opacity=".45" stroke-width="1" stroke-linejoin="round"/>`;
        if (s.line) svg += `<path d="${line}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      }
    }
    // Achsenbeschriftung über den Gitterlinien (mit Flächen-Halo)
    for (const v of tk.ticks) {
      const yy = Math.round(y(v)) + 0.5;
      svg += `<text class="ax yl" x="0" y="${n(yy - 3)}">${this._fmt(v, yDigits)}</text>`;
    }
    const main = series.find((s) => s.line) || series[0];
    if (m.extremes && main.pts.length > 2) {
      let iMin = 0, iMax = 0;
      main.pts.forEach((p, i) => { if (p[1] < main.pts[iMin][1]) iMin = i; if (p[1] > main.pts[iMax][1]) iMax = i; });
      for (const [i, above] of [[iMax, true], [iMin, false]]) {
        const p = main.pts[i];
        const xx = x(p[0]), yy = y(p[1]);
        const anchor = xx < 28 ? "start" : xx > W - 28 ? "end" : "middle";
        const ty = above ? Math.max(11, yy - 8) : Math.min(PT + ph - 2, yy + 16);
        svg += `<circle cx="${n(xx)}" cy="${n(yy)}" r="3" fill="${main.color}" stroke="var(--ws-surface)" stroke-width="2"/>`;
        svg += `<text class="lbl" x="${n(xx)}" y="${n(ty)}" text-anchor="${anchor}">${this._fmt(p[1], 1)}${esc(m.deg || "")}</text>`;
      }
    }
    if (main.pts.length) {
      const p = main.pts[main.pts.length - 1];
      svg += `<circle cx="${n(x(p[0]))}" cy="${n(y(p[1]))}" r="4" fill="${main.color}" stroke="var(--ws-surface)" stroke-width="2"/>`;
    }
    svg += `</svg>`;
    const hov = series.filter((s) => s.hover);
    el.innerHTML = svg + `<div class="cross" style="height:${ph}px"></div>` + hov.map(() => `<div class="dot"></div>`).join("") + `<div class="tip"></div>`;
    const times = main.pts.map((p) => p[0]);
    el._geo = {
      kind: "line", W, PT, ph, x, y, times, count: times.length,
      tip: (i) => {
        const ts = times[i];
        const vals = hov.map((s) => {
          const j = nearestIndex(s.pts.map((p) => p[0]), ts);
          return j < 0 ? null : s.pts[j];
        });
        const multiDay = (t1 - t0) > 30 * HOUR;
        const head = this._timeFmt(ts, multiDay ? { weekday: "short", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" });
        const rows = hov.map((s, k) => vals[k] ? `<div><i style="background:${s.color};${s.wash && !s.line ? "opacity:.45" : ""}"></i>${hov.length > 1 ? esc(s.name) + " " : ""}<b>${this._fmt(vals[k][1], s.digits)} ${esc(s.unit)}</b></div>` : "").join("");
        return { html: `<div class="tt">${esc(head)}</div>${rows}`, x: x(ts), dots: vals.map((v, k) => v ? { x: x(v[0]), y: y(v[1]), color: hov[k].color } : null) };
      },
    };
    if (el._idx !== undefined && el._active) this._showTip(el, Math.min(el._idx, times.length - 1));
  }

  _barChart(el, buckets, range) {
    const W = el.clientWidth;
    const H = el.clientHeight || 132;
    if (!W) return;
    const PT = 14, AX = 18, ph = H - PT - AX;
    const ru = this._unit(this._ent.rain_today || this._ent.rain_history) || "mm";
    const hi = Math.max(...buckets.map((b) => b.v));
    const tk = niceTicks(0, hi, 3, ru === "in" ? 0.1 : 1, true);
    const y = (v) => PT + ph - (v / tk.max) * ph;
    const nB = buckets.length;
    const band = W / nB;
    const bw = Math.max(2, Math.min(24, band - 2));
    const n = (v) => v.toFixed(1);
    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
    for (const v of tk.ticks) {
      const yy = Math.round(y(v)) + 0.5;
      svg += `<line class="gl" x1="0" x2="${W}" y1="${yy}" y2="${yy}"/>`;
    }
    let iMax = -1;
    buckets.forEach((b, i) => {
      if (b.v > 0 && (iMax < 0 || b.v > buckets[iMax].v)) iMax = i;
      const h = (b.v / tk.max) * ph;
      if (h < 0.5) return;
      const x0 = i * band + (band - bw) / 2, yb = PT + ph, yt = yb - h;
      const r = Math.min(4, bw / 2, h);
      svg += `<path d="M${n(x0)},${n(yb)}L${n(x0)},${n(yt + r)}Q${n(x0)},${n(yt)} ${n(x0 + r)},${n(yt)}L${n(x0 + bw - r)},${n(yt)}Q${n(x0 + bw)},${n(yt)} ${n(x0 + bw)},${n(yt + r)}L${n(x0 + bw)},${n(yb)}Z" fill="var(--ws-rain)"/>`;
    });
    // X-Beschriftung
    buckets.forEach((b, i) => {
      const xx = i * band + band / 2;
      let label = "";
      const dt = new Date(b.start);
      if (range === "24h") { if (dt.getHours() % 6 === 0) label = this._timeFmt(b.start, { hour: "2-digit", minute: "2-digit" }); }
      else if (range === "7d") label = this._timeFmt(b.start, { weekday: "short" });
      else if ((nB - 1 - i) % 5 === 0) label = this._timeFmt(b.start, { day: "numeric", month: "numeric" });
      if (label && xx > 12 && xx < W - 12) svg += `<text class="ax" x="${n(xx)}" y="${H - 4}" text-anchor="middle">${esc(label)}</text>`;
    });
    for (const v of tk.ticks) {
      const yy = Math.round(y(v)) + 0.5;
      svg += `<text class="ax yl" x="0" y="${n(yy - 3)}">${this._fmt(v, stepDigits(tk.step))}</text>`;
    }
    if (iMax >= 0) {
      const b = buckets[iMax];
      const xx = iMax * band + band / 2;
      const anchor = xx < 20 ? "start" : xx > W - 20 ? "end" : "middle";
      svg += `<text class="lbl" x="${n(xx)}" y="${n(Math.max(11, y(b.v) - 5))}" text-anchor="${anchor}">${this._fmt(b.v, 1)} ${esc(ru)}</text>`;
    }
    svg += `</svg>`;
    const empty = !buckets.some((b) => b.v > 0);
    const noData = !buckets.some((b) => b.has);
    el.innerHTML = svg + (empty ? `<div class="msg">${esc(this._t(noData ? "nodata" : "no_rain"))}</div>` : "") + `<div class="cross" style="height:${ph}px"></div><div class="tip"></div>`;
    el._geo = {
      kind: "bar", W, PT, ph, band, count: nB,
      tip: (i) => {
        const b = buckets[i];
        const head = range === "24h"
          ? `${this._timeFmt(b.start, { hour: "2-digit", minute: "2-digit" })} – ${this._timeFmt(b.end, { hour: "2-digit", minute: "2-digit" })}`
          : this._timeFmt(b.start, { weekday: "short", day: "numeric", month: "numeric" });
        return { html: `<div class="tt">${esc(head)}</div><div><i style="background:var(--ws-rain)"></i><b>${this._fmt(b.v, 1)} ${esc(ru)}</b></div>`, x: i * band + band / 2, dots: [] };
      },
    };
    if (el._idx !== undefined && el._active) this._showTip(el, Math.min(el._idx, nB - 1));
  }

  _bindChart(el) {
    const at = (clientX) => {
      const g = el._geo;
      if (!g || !g.count) return;
      const px = clientX - el.getBoundingClientRect().left;
      let i;
      if (g.kind === "bar") i = Math.max(0, Math.min(g.count - 1, Math.floor(px / g.band)));
      else {
        const d = this._data;
        const t1 = Math.max(d.lineEnd, Date.now());
        i = nearestIndex(g.times, d.lineStart + (px / g.W) * (t1 - d.lineStart));
      }
      el._active = true;
      this._showTip(el, i);
    };
    el.addEventListener("pointermove", (ev) => at(ev.clientX));
    el.addEventListener("pointerdown", (ev) => at(ev.clientX));
    el.addEventListener("pointerleave", () => this._hideTip(el));
    el.addEventListener("focus", () => { const g = el._geo; if (g?.count) { el._active = true; this._showTip(el, el._idx ?? g.count - 1); } });
    el.addEventListener("blur", () => this._hideTip(el));
    el.addEventListener("keydown", (ev) => {
      const g = el._geo;
      if (!g?.count) return;
      const stepN = g.kind === "bar" ? 1 : Math.max(1, Math.round(g.count / 48));
      let i = el._idx ?? g.count - 1;
      if (ev.key === "ArrowLeft") i -= stepN;
      else if (ev.key === "ArrowRight") i += stepN;
      else if (ev.key === "Home") i = 0;
      else if (ev.key === "End") i = g.count - 1;
      else if (ev.key === "Escape") { this._hideTip(el); return; }
      else return;
      ev.preventDefault();
      el._active = true;
      this._showTip(el, Math.max(0, Math.min(g.count - 1, i)));
    });
  }

  _showTip(el, i) {
    const g = el._geo;
    if (!g || i < 0) return;
    el._idx = i;
    const info = g.tip(i);
    const cross = el.querySelector(".cross");
    const tip = el.querySelector(".tip");
    if (!cross || !tip) return;
    cross.style.left = `${Math.round(info.x)}px`;
    cross.style.display = "block";
    el.querySelectorAll(".dot").forEach((dot, k) => {
      const p = info.dots[k];
      if (!p) { dot.style.display = "none"; return; }
      dot.style.left = `${p.x}px`;
      dot.style.top = `${p.y}px`;
      dot.style.background = p.color;
      dot.style.display = "block";
    });
    tip.innerHTML = info.html;
    tip.style.display = "block";
    const w = tip.offsetWidth;
    tip.style.left = `${Math.max(w / 2, Math.min(g.W - w / 2, info.x))}px`;
  }

  _hideTip(el) {
    el._active = false;
    el.querySelectorAll(".cross,.dot,.tip").forEach((n) => { n.style.display = "none"; });
  }
}

if (!customElements.get("weather-station-card")) {
  customElements.define("weather-station-card", WeatherStationCard);
  const de = lang() === "de";
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "weather-station-card",
    name: de ? "Wetterstation" : "Weather Station Card",
    description: de
      ? "Temperatur, Niederschlag und Wind mit Verlauf – erkennt die Sensoren deiner Wetterstation automatisch."
      : "Temperature, precipitation and wind with history – detects the sensors of your weather station automatically.",
    preview: true,
    documentationURL: "https://github.com/pasimatics/weather-station-card",
  });
  console.info(`%c WEATHER-STATION-CARD %c v${WS_VERSION} `, "color:#fff;background:#2a78d6;border-radius:3px 0 0 3px", "color:#2a78d6;background:#fff;border-radius:0 3px 3px 0");
}
/* Alter Name aus der ersten Version – bestehende Dashboards mit custom:wetterstation-card laufen weiter */
if (!customElements.get("wetterstation-card")) {
  customElements.define("wetterstation-card", class extends WeatherStationCard {});
}
