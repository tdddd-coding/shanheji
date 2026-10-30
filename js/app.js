/* ===========================================================
   山河纪 · 中国历史三维时空图谱
   Three.js scene + timeline + atlas UI
   =========================================================== */
const THREE = window.THREE;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad2 = (n) => String(n).padStart(2, "0");
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const COLORS = {
  capital: "#f7e3ae",
  person: "#72e0c2",
  event: "#ffb45f",
  landmark: "#79c6ff",
};

const state = {
  geo: null,
  eras: [],
  eraIndex: -1,
  year: -221,
  progress: 0,
  playing: false,
  holdUntil: 0,
  autoRotate: false,
  tab: "people",
  layers: { territory: true, people: true, events: true, landmarks: true, geo: true, admin: false },
  adminLabels: [],
  allMarkers: [],
  landmarkMarkers: [],
  eraMarkers: [],
  geoLabels: [],
  eventDots: [],
  selected: null,
  detail: null,
  landmarkIds: "",
  wikiBook: null,
  wikiLookup: new Map(),
  wiki: null,
  started: false,
  dragging: false,
  dragDistance: 0,
  suppressClick: false,
  yawDragging: false,
  textureScale: 1,
  eraFlashTimer: null,
};

/* ---------------------------------------------------------------- utils */
function fmtYear(y) {
  const n = Math.round(y);
  if (n < 0) return `公元前${-n}年`;
  if (n === 0) return "公元1年";
  return `公元${n}年`;
}
function shortYear(y) {
  const n = Math.round(y);
  if (n < 0) return `前${-n}`;
  if (n === 0) return "1";
  return String(n);
}
function fmtRange(era) {
  if (era.end <= era.start) return shortYear(era.start);
  return `${shortYear(era.start)} — ${shortYear(era.end)}`;
}
function eraLocal(era, year) {
  const span = era.end - era.start;
  if (span <= 0) return 0.9995;
  return clamp((year - era.start) / span, 0, 0.9995);
}
function lerp(a, b, t) { return a + (b - a) * t; }
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }
function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.dispose?.();
    }
  });
}
function showToast(text, ms = 2200) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("is-show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => el.classList.remove("is-show"), ms);
}
function setLoad(pct, text) {
  const bar = $("#loadBar");
  if (bar) bar.style.width = `${clamp(pct, 0, 100)}%`;
  if (text) $("#loadStatus").textContent = text;
}
function showError(message) {
  const loading = $("#loading");
  loading?.classList.add("is-done");
  $("#errorText").textContent = message;
  $("#errorPanel").hidden = false;
  document.body.dataset.ready = "error";
}
function hexToRgba(hex, a) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ---------------------------------------------------------------- 本地百科配图 */
function escHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function thumbKey(kind, data) {
  if (kind === "event") return `event:${data.year}:${data.name}`;
  if (kind === "capital") return `capital:${state.eras[state.eraIndex]?.id}:${data.name}`;
  return `${kind}:${data.name}`;
}
function typeChar(kind) {
  return kind === "person" ? "人" : kind === "event" ? "事" : kind === "landmark" ? "迹" : "都";
}
function imageEntry(kind, data, entryKey = null) {
  const key = entryKey || thumbKey(kind, data);
  const entry = state.wikiBook?.entries?.[key] || null;
  const img = entry?.images?.[0] || null;
  return { key, entry, img };
}
function mediaImageHTML(kind, data, entryKey = null) {
  const { img } = imageEntry(kind, data, entryKey);
  if (img?.file) {
    return `<img src="assets/images/${escHTML(img.file)}" alt="${escHTML(data.name || data.note || "")}" loading="lazy">`;
  }
  return `<span class="media-ph">${typeChar(kind)}</span>`;
}
function mediaThumbHTML(kind, data, entryKey = null) {
  const { img } = imageEntry(kind, data, entryKey);
  return `<span class="art-thumb${img?.file ? " has-img" : " is-empty"}" data-kind="${kind}">${mediaImageHTML(kind, data, entryKey)}</span>`;
}

/* ---------------------------------------------------------------- three globals */
let renderer, scene, camera, terrainGeometry, terrainMesh;
let waterMat, outerWater, waterMesh;
let riversGroup, riverMats = [];
let markerRoot, landmarkRoot, eraRoot, starField;
let sunSprite;
let glowTexture;
let camTween = null;
let elapsed = 0;
let lastFrame = performance.now();

const cam = {
  theta: 0.08,
  phi: 0.77,
  dist: 72,
  target: new THREE.Vector3(2.0, 0.15, -3.0),
  desired: {
    theta: 0.08,
    phi: 0.77,
    dist: 72,
    target: new THREE.Vector3(2.0, 0.15, -3.0),
  },
};
const DEFAULT_CAM = {
  theta: 0.06,
  phi: 0.72,
  dist: 64,
  target: new THREE.Vector3(3.0, 0.25, -2.5),
};

const MAP = {
  lon0: 65, lon1: 145, lat0: 5, lat1: 58,
  w: 0, d: 0, cos: 1,
};
let heightData = null, maskData = null, maskCanvas = null;
const HEIGHT_SCALE = 5.2;
const OCEAN_Y = -1.55;

function setupMap(geo) {
  MAP.lon0 = geo.map.lon0;
  MAP.lon1 = geo.map.lon1;
  MAP.lat0 = geo.map.lat0;
  MAP.lat1 = geo.map.lat1;
  MAP.w = (MAP.lon1 - MAP.lon0) * Math.cos(((MAP.lat0 + MAP.lat1) / 2) * Math.PI / 180);
  MAP.d = MAP.lat1 - MAP.lat0;
  MAP.cos = Math.cos(((MAP.lat0 + MAP.lat1) / 2) * Math.PI / 180);
}

function lonlatToXZ(lon, lat) {
  const u = (lon - MAP.lon0) / (MAP.lon1 - MAP.lon0);
  const v = (MAP.lat1 - lat) / (MAP.lat1 - MAP.lat0);
  return [(-0.5 + u) * MAP.w, (-0.5 + v) * MAP.d];
}
function xzToLonLat(x, z) {
  const u = x / MAP.w + 0.5;
  const v = z / MAP.d + 0.5;
  return [MAP.lon0 + u * (MAP.lon1 - MAP.lon0), MAP.lat1 - v * (MAP.lat1 - MAP.lat0)];
}

function sampleGray(data, w, h, u, v) {
  const x = clamp(u, 0, 1) * (w - 1);
  const y = clamp(v, 0, 1) * (h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  const a = data[i00] * (1 - fx) + data[i10] * fx;
  const b = data[i01] * (1 - fx) + data[i11] * fx;
  return a * (1 - fy) + b * fy;
}
function maskAt(lon, lat) {
  if (!maskData) return 1;
  const u = (lon - MAP.lon0) / (MAP.lon1 - MAP.lon0);
  const v = (MAP.lat1 - lat) / (MAP.lat1 - MAP.lat0);
  return sampleGray(maskData, state.geo.map.width, state.geo.map.height, u, v) / 255;
}
function heightAt(lon, lat) {
  if (!heightData) return 0.6;
  const m = maskAt(lon, lat);
  if (m < 0.42) return OCEAN_Y;
  const u = (lon - MAP.lon0) / (MAP.lon1 - MAP.lon0);
  const v = (MAP.lat1 - lat) / (MAP.lat1 - MAP.lat0);
  const h = sampleGray(heightData, state.geo.map.width, state.geo.map.height, u, v) / 255;
  return h * HEIGHT_SCALE;
}
function worldPosition(lon, lat, lift = 0) {
  const [x, z] = lonlatToXZ(lon, lat);
  return new THREE.Vector3(x, heightAt(lon, lat) + lift, z);
}

/* ---------------------------------------------------------------- loading */
async function loadTexture(url) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, resolve, undefined, () => reject(new Error(`贴图载入失败：${url}`)));
  });
}
async function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`图片载入失败：${url}`));
    img.src = url;
  });
}
function imageToCanvas(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d").drawImage(img, 0, 0);
  return c;
}
function makeGlowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,.72)");
  g.addColorStop(0.48, "rgba(255,255,255,.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter;
  return t;
}

async function loadAssets() {
  setLoad(24, "读取地形高程与海岸线…");
  const [colorTex, normalTex, heightImg, maskImg] = await Promise.all([
    loadTexture("assets/terrain_color.png"),
    loadTexture("assets/terrain_normal.png"),
    loadImage("assets/terrain_height.png"),
    loadImage("assets/land_mask.png"),
  ]);

  colorTex.encoding = THREE.sRGBEncoding;
  colorTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  colorTex.minFilter = THREE.LinearMipmapLinearFilter;
  colorTex.magFilter = THREE.LinearFilter;
  colorTex.wrapS = colorTex.wrapT = THREE.ClampToEdgeWrapping;
  normalTex.anisotropy = colorTex.anisotropy;
  normalTex.minFilter = THREE.LinearMipmapLinearFilter;
  normalTex.magFilter = THREE.LinearFilter;
  normalTex.wrapS = normalTex.wrapT = THREE.ClampToEdgeWrapping;

  setLoad(48, "解析山河纹理…");
  const heightCanvas = imageToCanvas(heightImg);
  const hctx = heightCanvas.getContext("2d", { willReadFrequently: true });
  heightData = hctx.getImageData(0, 0, heightCanvas.width, heightCanvas.height).data;

  maskCanvas = imageToCanvas(maskImg);
  const mctx = maskCanvas.getContext("2d", { willReadFrequently: true });
  maskData = mctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;

  const blurCanvas = document.createElement("canvas");
  blurCanvas.width = maskCanvas.width;
  blurCanvas.height = maskCanvas.height;
  const bctx = blurCanvas.getContext("2d");
  bctx.filter = "blur(4px)";
  bctx.drawImage(maskCanvas, 0, 0);
  const maskBlurTexture = new THREE.CanvasTexture(blurCanvas);
  maskBlurTexture.minFilter = THREE.LinearFilter;
  maskBlurTexture.magFilter = THREE.LinearFilter;
  maskBlurTexture.wrapS = maskBlurTexture.wrapT = THREE.ClampToEdgeWrapping;

  setLoad(64, "雕刻高原、山脉与河流…");
  return { colorTex, normalTex, maskBlurTexture, heightCanvas, maskCanvas };
}

/* ---------------------------------------------------------------- scene */
function initScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x040a12, 0.0038);

  camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 800);
  camera.position.set(20, 40, 58);

  const hemi = new THREE.HemisphereLight(0xa8cbea, 0x0a0e0a, 0.92);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0x0e1b26, 0.42);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffe2b6, 1.45);
  sun.position.set(-42, 64, -38);
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x5d8dff, 0.36);
  fill.position.set(46, 24, 44);
  scene.add(fill);

  glowTexture = makeGlowTexture();
  buildStars();
  buildSun();
  buildTerrain();
  buildWater(state.textures.maskBlurTexture);
  buildRivers();
  buildGeoLabels();
  buildTerritoryRoots();
}

function buildStars() {
  const count = 1100;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const rng = mulberry32(77);
  for (let i = 0; i < count; i++) {
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(1 - rng() * 1.35);
    const r = 210 + rng() * 140;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi) * 0.72 + 10;
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const warm = rng() > 0.82;
    const b = 0.55 + rng() * 0.45;
    col[i * 3] = warm ? b : b * 0.58;
    col[i * 3 + 1] = warm ? b * 0.82 : b * 0.76;
    col[i * 3 + 2] = warm ? b * 0.52 : b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  starField = new THREE.Points(g, new THREE.PointsMaterial({
    size: 1.3, sizeAttenuation: true, vertexColors: true,
    transparent: true, opacity: 0.72, depthWrite: false, fog: false,
  }));
  scene.add(starField);
}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function buildSun() {
  const bg = makeGlowTexture();
  const mat = new THREE.SpriteMaterial({
    map: bg, color: 0xffc77a, transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  sunSprite = new THREE.Sprite(mat);
  sunSprite.position.set(-95, 55, -130);
  sunSprite.scale.set(120, 120, 1);
  scene.add(sunSprite);
}

function buildTerrain() {
  const segX = 380;
  const segZ = Math.round(segX * MAP.d / MAP.w);
  const count = (segX + 1) * (segZ + 1);
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const indices = new Uint32Array(segX * segZ * 6);
  let p = 0, uv = 0, ii = 0;
  for (let iz = 0; iz <= segZ; iz++) {
    const v = iz / segZ;
    const lat = MAP.lat1 - v * (MAP.lat1 - MAP.lat0);
    const z = -MAP.d / 2 + v * MAP.d;
    for (let ix = 0; ix <= segX; ix++) {
      const u = ix / segX;
      const lon = MAP.lon0 + u * (MAP.lon1 - MAP.lon0);
      const x = -MAP.w / 2 + u * MAP.w;
      positions[p++] = x;
      positions[p++] = heightAt(lon, lat);
      positions[p++] = z;
      uvs[uv++] = u;
      uvs[uv++] = 1 - v;
    }
  }
  for (let iz = 0; iz < segZ; iz++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iz * (segX + 1) + ix;
      const b = a + segX + 1;
      const c = a + 1;
      const d = b + 1;
      indices[ii++] = a; indices[ii++] = b; indices[ii++] = c;
      indices[ii++] = b; indices[ii++] = d; indices[ii++] = c;
    }
  }
  terrainGeometry = new THREE.BufferGeometry();
  terrainGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  terrainGeometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  terrainGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
  terrainGeometry.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map: state.textures.colorTex,
    normalMap: state.textures.normalTex,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 0.94,
    metalness: 0.025,
    color: 0xffffff,
  });
  terrainMesh = new THREE.Mesh(terrainGeometry, mat);
  terrainMesh.renderOrder = 1;
  scene.add(terrainMesh);
}

function buildWater(maskTexture) {
  const wp = MAP.w * 6;
  const dp = MAP.d * 6;
  const y = -0.18;
  const g = new THREE.BufferGeometry();
  const verts = new Float32Array([
    -wp / 2, y, -dp / 2,
    wp / 2, y, -dp / 2,
    wp / 2, y, dp / 2,
    -wp / 2, y, dp / 2,
  ]);
  g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  g.setIndex([0, 2, 1, 0, 3, 2]);

  waterMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMask: { value: maskTexture },
      uMapW: { value: MAP.w },
      uMapD: { value: MAP.d },
    },
    vertexShader: `
      varying vec2 vMapUv;
      varying float vDist;
      uniform float uMapW;
      uniform float uMapD;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vMapUv = vec2(world.x / uMapW + 0.5, 0.5 - world.z / uMapD);
        vDist = length(world.xz - cameraPosition.xz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      varying vec2 vMapUv;
      varying float vDist;
      uniform float uTime;
      uniform sampler2D uMask;
      void main() {
        vec2 uv = clamp(vMapUv, 0.0, 1.0);
        float inside = step(0.0, vMapUv.x) * step(vMapUv.x, 1.0)
                     * step(0.0, vMapUv.y) * step(vMapUv.y, 1.0);
        float border = min(min(vMapUv.x, 1.0 - vMapUv.x), min(vMapUv.y, 1.0 - vMapUv.y));
        float fadeIn = smoothstep(0.0, 0.06, border);
        vec2 px = vec2(1.0/1440.0, 1.0/1120.0);
        float gx = texture2D(uMask, uv + vec2(px.x, 0.0)).r
                 - texture2D(uMask, uv - vec2(px.x, 0.0)).r;
        float gy = texture2D(uMask, uv + vec2(0.0, px.y)).r
                 - texture2D(uMask, uv - vec2(0.0, px.y)).r;
        float edge = smoothstep(0.0, 0.25, length(vec2(gx, gy))) * inside * fadeIn;
        float w1 = sin(uv.x * 52.0 + uTime * 0.30) * sin(uv.y * 43.0 - uTime * 0.24);
        float w2 = sin(uv.x * 17.0 - uTime * 0.12 + uv.y * 13.0);
        vec3 deep = vec3(0.007, 0.024, 0.042);
        vec3 shallow = vec3(0.018, 0.072, 0.088);
        vec3 far = vec3(0.003, 0.010, 0.020);
        vec3 col = mix(deep, shallow, 0.23 + 0.08 * w1 + 0.035 * w2);
        col += vec3(0.055, 0.25, 0.29) * edge * 0.80;
        col = mix(far, col, inside * fadeIn);
        float horizon = exp(-vDist * 0.0075);
        col = mix(far, col, horizon);
        gl_FragColor = vec4(col, 1.0);
        #include <encodings_fragment>
      }
    `,
  });
  waterMesh = new THREE.Mesh(g, waterMat);
  waterMesh.renderOrder = 0;
  scene.add(waterMesh);
  outerWater = null;
}

/* ---------------------------------------------------------------- rivers & geo labels */
function buildRivers() {
  riversGroup = new THREE.Group();
  scene.add(riversGroup);

  for (const river of state.geo.rivers) {
    const curvePts = river.coords.map(([lon, lat]) => {
      const [x, z] = lonlatToXZ(lon, lat);
      return new THREE.Vector3(x, 0, z);
    });
    const baseCurve = new THREE.CatmullRomCurve3(curvePts, false, "catmullrom", 0.4);
    const samples = baseCurve.getPoints(220);
    const draped = samples.map((p) => {
      const [lon, lat] = xzToLonLat(p.x, p.z);
      return new THREE.Vector3(p.x, heightAt(lon, lat) + 0.14, p.z);
    });
    const curve = new THREE.CatmullRomCurve3(draped, false, "catmullrom", 0.35);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(river.color) },
        uTime: { value: 0 },
        uOpacity: { value: 1 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform vec3 uColor;
        uniform float uTime;
        uniform float uOpacity;
        void main() {
          float flow = 0.5 + 0.5 * sin((vUv.x * 14.0 - uTime * 0.55) * 6.2831853);
          float pulse = smoothstep(0.25, 0.95, flow);
          vec3 col = uColor * (0.78 + 0.62 * pulse);
          gl_FragColor = vec4(col, (0.40 + 0.48 * pulse) * uOpacity);
          #include <encodings_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 220, 0.032, 5, false), material);
    tube.renderOrder = 3;
    riversGroup.add(tube);
    riverMats.push(material);

    const glowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(river.color), transparent: true, opacity: 0.09,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const glowTube = new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.11, 5, false), glowMat);
    glowTube.renderOrder = 2;
    riversGroup.add(glowTube);

    const mid = river.coords[Math.floor(river.coords.length * 0.52)];
    const el = document.createElement("span");
    el.className = "geo-label river-label";
    el.textContent = river.name;
    el.style.color = river.color;
    $("#geoLayer").appendChild(el);
    state.geoLabels.push({
      el,
      world: worldPosition(mid[0], mid[1], 0.7),
      kind: "river",
      river: true,
    });
  }
}

function buildGeoLabels() {
  for (const g of state.geo.geoLabels) {
    const el = document.createElement("span");
    el.className = `geo-label kind-${g.kind}`;
    el.textContent = g.text;
    $("#geoLayer").appendChild(el);
    state.geoLabels.push({
      el,
      world: worldPosition(g.lon, g.lat, 1.1),
      kind: g.kind,
    });
  }
}

/* ---------------------------------------------------------------- territory */
const TERRITORY = new Map();
let territoryRoot;

function buildTerritoryRoots() {
  territoryRoot = new THREE.Group();
  scene.add(territoryRoot);
  markerRoot = new THREE.Group();
  scene.add(markerRoot);
  landmarkRoot = new THREE.Group();
  markerRoot.add(landmarkRoot);
  eraRoot = new THREE.Group();
  markerRoot.add(eraRoot);
}

function territoryMaskCanvas(group) {
  const cw = 1024;
  const ch = Math.round(cw * state.geo.map.height / state.geo.map.width);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = "#fff";
  for (const poly of group.polygons) {
    if (!poly || !poly.length) continue;
    ctx.beginPath();
    for (const ring of poly) {
      if (!ring || ring.length < 3) continue;
      for (let i = 0; i < ring.length; i++) {
        const [lon, lat] = ring[i];
        const x = (lon - MAP.lon0) / (MAP.lon1 - MAP.lon0) * cw;
        const y = (MAP.lat1 - lat) / (MAP.lat1 - MAP.lat0) * ch;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
    ctx.fill("evenodd");
  }
  return canvas;
}

function buildBorderRibbon(ring, color, width, opacity, wall = false) {
  if (!ring || ring.length < 3) return null;
  let pts = ring;
  if (pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);

  const dense = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const steps = clamp(Math.ceil((Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1])) / 0.32), 1, 28);
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      dense.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  if (dense.length < 3) return null;

  const n = dense.length;
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices = new Uint32Array(n * 6);
  const p = [];
  for (let i = 0; i < n; i++) {
    const [lon, lat] = dense[i];
    const [x, z] = lonlatToXZ(lon, lat);
    p.push({ x, z, y: heightAt(lon, lat) });
  }
  for (let i = 0; i < n; i++) {
    const prev = p[(i - 1 + n) % n];
    const next = p[(i + 1) % n];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len; tz /= len;
    const nx = -tz, nz = tx;
    const cur = p[i];
    const lx = cur.x + nx * width, lz = cur.z + nz * width;
    const rx = cur.x - nx * width, rz = cur.z - nz * width;
    const yy = cur.y + 0.2;
    positions[i * 6] = lx; positions[i * 6 + 1] = yy; positions[i * 6 + 2] = lz;
    positions[i * 6 + 3] = rx; positions[i * 6 + 4] = yy; positions[i * 6 + 5] = rz;
    uvs[i * 4] = 0; uvs[i * 4 + 1] = 0;
    uvs[i * 4 + 2] = 1; uvs[i * 4 + 3] = 0;
    const i0 = i * 2, i1 = i * 2 + 1;
    const ni0 = ((i + 1) % n) * 2, ni1 = ni0 + 1;
    indices[i * 6] = i0; indices[i * 6 + 1] = ni0; indices[i * 6 + 2] = i1;
    indices[i * 6 + 3] = i1; indices[i * 6 + 4] = ni0; indices[i * 6 + 5] = ni1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));

  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: wall ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = wall ? 5 : 4;
  mesh.userData.baseOpacity = opacity;
  return mesh;
}

function buildBorderWall(ring, color) {
  if (!ring || ring.length < 3) return null;
  let pts = ring;
  if (pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);
  const dense = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const steps = clamp(Math.ceil((Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1])) / 0.5), 1, 20);
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      dense.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  if (dense.length < 3) return null;
  const n = dense.length;
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices = new Uint32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const [lon, lat] = dense[i];
    const [x, z] = lonlatToXZ(lon, lat);
    const y = heightAt(lon, lat);
    positions[i * 6] = x; positions[i * 6 + 1] = y + 0.05; positions[i * 6 + 2] = z;
    positions[i * 6 + 3] = x; positions[i * 6 + 4] = y + 0.85; positions[i * 6 + 5] = z;
    uvs[i * 4] = 0; uvs[i * 4 + 1] = 0;
    uvs[i * 4 + 2] = 0; uvs[i * 4 + 3] = 1;
    const i0 = i * 2, i1 = i * 2 + 1;
    const ni0 = ((i + 1) % n) * 2, ni1 = ni0 + 1;
    indices[i * 6] = i0; indices[i * 6 + 1] = ni0; indices[i * 6 + 2] = i1;
    indices[i * 6 + 3] = i1; indices[i * 6 + 4] = ni0; indices[i * 6 + 5] = ni1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        float a = (1.0 - vUv.y) * 0.26 * uOpacity;
        gl_FragColor = vec4(uColor, a);
        #include <encodings_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  mesh.userData.baseOpacity = 1;
  return mesh;
}

function ensureTerritory(era) {
  if (TERRITORY.has(era.id)) return TERRITORY.get(era.id);
  const entry = { eraId: era.id, opacity: 0, target: 0, groups: [], tags: [] };
  for (const tg of era.territories) {
    const root = new THREE.Group();
    const maskCanvas = territoryMaskCanvas(tg);
    const tex = new THREE.CanvasTexture(maskCanvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;

    const fillMat = new THREE.ShaderMaterial({
      uniforms: {
        uMask: { value: tex },
        uColor: { value: new THREE.Color(tg.color) },
        uTime: { value: 0 },
        uOpacity: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D uMask;
        uniform vec3 uColor;
        uniform float uTime;
        uniform float uOpacity;
        void main() {
          float m = texture2D(uMask, vUv).a;
          vec2 px = vec2(1.0/1024.0, 1.0/796.0);
          float l = texture2D(uMask, vUv - vec2(px.x, 0.0)).a;
          float r = texture2D(uMask, vUv + vec2(px.x, 0.0)).a;
          float d = texture2D(uMask, vUv - vec2(0.0, px.y)).a;
          float u = texture2D(uMask, vUv + vec2(0.0, px.y)).a;
          float edge = smoothstep(0.08, 0.75, abs(l - m) + abs(r - m) + abs(d - m) + abs(u - m));
          float scan = 0.5 + 0.5 * sin(vUv.y * 120.0 - uTime * 1.15 + vUv.x * 24.0);
          vec3 col = uColor * (0.92 + 0.18 * scan);
          col = mix(col, uColor * 1.35, edge);
          float alpha = m * (0.17 + 0.06 * scan) + edge * 0.34;
          gl_FragColor = vec4(col, alpha * uOpacity);
          #include <encodings_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    const fill = new THREE.Mesh(terrainGeometry, fillMat);
    fill.position.y = 0.16;
    fill.renderOrder = 2;
    root.add(fill);

    for (const poly of tg.polygons) {
      for (const ring of poly) {
        const core = buildBorderRibbon(ring, tg.color, 0.06, 0.88);
        const glow = buildBorderRibbon(ring, tg.color, 0.22, 0.10);
        const wall = buildBorderWall(ring, tg.color);
        if (core) root.add(core);
        if (glow) root.add(glow);
        if (wall) root.add(wall);
      }
    }

    root.visible = false;
    territoryRoot.add(root);
    entry.groups.push({ root, fillMat, tg });

    if (tg.labelAt) {
      const el = document.createElement("div");
      el.className = "territory-tag";
      el.textContent = tg.label;
      el.style.setProperty("--tcolor", tg.color);
      $("#markerLayer").appendChild(el);
      entry.tags.push({ el, world: worldPosition(tg.labelAt[0], tg.labelAt[1], 2.4) });
    }
  }
  TERRITORY.set(era.id, entry);
  return entry;
}

function activateTerritory(eraId, instant = false) {
  for (const [id, entry] of TERRITORY) {
    entry.target = state.layers.territory && id === eraId ? 1 : 0;
    if (instant) entry.opacity = entry.target;
  }
}
state.allTerritoryTags = [];

function updateTerritories(dt) {
  const tags = [];
  for (const entry of TERRITORY.values()) {
    const speed = 1 - Math.pow(0.001, dt);
    entry.opacity += (entry.target - entry.opacity) * Math.min(1, speed * 1.6);
    if (Math.abs(entry.target - entry.opacity) < 0.002) entry.opacity = entry.target;
    for (const g of entry.groups) {
      const o = entry.opacity;
      g.root.visible = o > 0.004;
      if (!g.root.visible) continue;
      g.fillMat.uniforms.uTime.value = elapsed;
      g.fillMat.uniforms.uOpacity.value = o;
      g.root.traverse((ch) => {
        if (ch.isMesh && ch.material) {
          const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
          for (const mat of mats) {
            if (mat.uniforms?.uOpacity && ch !== g.root) mat.uniforms.uOpacity.value = o;
            else if (mat.isMeshBasicMaterial) mat.opacity = (ch.userData.baseOpacity ?? 1) * o;
          }
        }
      });
    }
    for (const t of entry.tags) tags.push({ t, o: entry.opacity });
  }
  state.allTerritoryTags = tags;
  for (const { t, o } of tags) {
    t.el.classList.toggle("is-visible", o > 0.35 && state.layers.territory);
  }
}

/* ---------------------------------------------------------------- markers */
function markerKey(type, data) {
  if (type === "event") return `event:${data.year}:${data.name}`;
  return `${type}:${data.name || data.note}`;
}
function eventTolerance(era) {
  return Math.max(0.5, (era.end - era.start) * 0.008);
}
function availableLandmarks() {
  return state.geo.landmarks
    .filter((lm) => lm.year <= state.year + 0.5)
    .sort((a, b) => a.year - b.year);
}
function renderAdminLabels(era) {
  const layer = $("#adminLayer");
  layer.innerHTML = "";
  state.adminLabels = [];
  if (!state.layers.admin || !era) return;
  for (const [name, lon, lat] of (era.adminUnits || [])) {
    const el = document.createElement("span");
    el.className = "admin-label";
    el.textContent = name;
    layer.appendChild(el);
    state.adminLabels.push({ el, world: worldPosition(lon, lat, 1.35) });
  }
}

function updateLandmarkAvailability() {
  const lms = availableLandmarks();
  const ids = lms.map((lm) => lm.name).join("|");
  $("#countLandmarks").textContent = lms.length;
  if (state.tab === "landmarks" && state.landmarkIds !== ids) {
    state.landmarkIds = ids;
    renderPanel();
  }
  if (state.detail?.type === "landmark" && state.detail.data.year > state.year + 0.5) {
    closeDetail();
  }
}
function isMarkerVisible(m) {
  if (m.type === "capital") return state.layers.territory;
  if (m.type === "person") return state.layers.people;
  if (m.type === "event") {
    return state.layers.events && m.data.year <= state.year + eventTolerance(state.eras[state.eraIndex]);
  }
  if (m.type === "landmark") return state.layers.landmarks && m.data.year <= state.year + 0.5;
  return true;
}

function createMarker(type, data, scope) {
  const color = COLORS[type];
  const root = scope === "landmark" ? landmarkRoot : eraRoot;
  const g = new THREE.Group();
  let lon = data.lon, lat = data.lat;
  if (type !== "capital") {
    const angle = (hashString(`${type}:${data.name || data.year}`) % 360) * Math.PI / 180;
    const radius = type === "person" ? 0.55 : 0.42;
    lon += Math.cos(angle) * radius;
    lat += Math.sin(angle) * radius * 0.7;
  }
  const [mx, mz] = lonlatToXZ(lon, lat);
  const terrainY = heightAt(lon, lat);
  const baseY = terrainY < 0 ? 0.34 : terrainY + 0.02;
  g.position.set(mx, baseY, mz);

  const isCapital = type === "capital";
  const mkScale = isCapital ? 1.12 : 1.25;
  const beamH = (isCapital ? 1.9 : type === "landmark" ? 0.95 : 0.92) * mkScale;
  const headSize = (isCapital ? 0.25 : type === "event" ? 0.15 : type === "landmark" ? 0.13 : 0.10) * mkScale;

  let headGeo;
  if (type === "person") headGeo = new THREE.SphereGeometry(headSize, 12, 12);
  else if (type === "event") headGeo = new THREE.OctahedronGeometry(headSize, 0);
  else headGeo = new THREE.BoxGeometry(headSize * 1.6, headSize * 1.6, headSize * 1.6);

  const headMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color), transparent: true,
    opacity: isCapital ? 1 : 0.95, toneMapped: false,
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = beamH;
  head.rotation.y = type === "landmark" ? Math.PI / 4 : 0;
  head.rotation.x = type === "landmark" ? Math.PI / 4 : 0;
  g.add(head);

  const beamMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color), transparent: true, opacity: isCapital ? 0.5 : 0.26,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, beamH, 5), beamMat);
  beam.position.y = beamH / 2;
  g.add(beam);

  const ringMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color), transparent: true, opacity: isCapital ? 0.9 : 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(
      (isCapital ? 0.22 : 0.13) * mkScale,
      (isCapital ? 0.36 : 0.21) * mkScale,
      32
    ),
    ringMat
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.045;
  g.add(ring);

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color: new THREE.Color(color), transparent: true,
    opacity: isCapital ? 0.85 : 0.45, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  }));
  halo.position.y = beamH;
  const haloScale = (isCapital ? 2.1 : type === "landmark" ? 1.15 : 1.0) * mkScale;
  halo.scale.set(haloScale, haloScale, 1);
  g.add(halo);

  if (isCapital) {
    const outerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.44, 0.48, 40),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color), transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      })
    );
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.position.y = 0.04;
    g.add(outerRing);
    g.userData.outerRing = outerRing;
  }

  root.add(g);

  const m = {
    type, data, scope, key: !!data.key || isCapital,
    color, group: g, head, ring, halo, beamH,
    baseHeadY: beamH, phase: Math.random() * Math.PI * 2,
    visible: true,
    labelLift: beamH + 0.55,
    keyId: markerKey(type, data),
    priority: isCapital ? 100 : data.key ? (type === "landmark" ? 80 : 70) : 20,
    el: null, labelEl: null, labelW: 0, labelH: 0,
  };
  g.userData.marker = m;
  head.userData.marker = m;
  ring.userData.marker = m;
  halo.userData.marker = m;
  if (g.userData.outerRing) g.userData.outerRing.userData.marker = m;

  const el = document.createElement("button");
  el.className = `marker marker-${type}${m.key ? " is-key" : ""}`;
  el.style.setProperty("--mcolor", color);
  el.dataset.key = m.keyId;
  el.innerHTML = `<span class="marker-dot"></span><span class="marker-label"><b></b><em></em></span>`;
  el.querySelector(".marker-label b").textContent = data.name || data.note;
  el.querySelector(".marker-label em").textContent =
    type === "person" ? data.title || "" :
    type === "event" ? shortYear(data.year) :
    type === "landmark" ? data.type || "" :
    data.note || "";
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onMarkerClick(m);
  });
  el.addEventListener("mouseenter", () => { m.hovered = true; });
  el.addEventListener("mouseleave", () => { m.hovered = false; });
  $("#markerLayer").appendChild(el);
  m.el = el;
  m.labelEl = el.querySelector(".marker-label");
  requestAnimationFrame(() => {
    m.labelW = m.labelEl.offsetWidth || 70;
    m.labelH = m.labelEl.offsetHeight || 22;
  });
  return m;
}

function clearEraMarkers() {
  for (const m of state.eraMarkers) {
    m.el?.remove();
    if (m.group?.parent) m.group.parent.remove(m.group);
    disposeObject(m.group);
  }
  state.eraMarkers = [];
  state.allMarkers = [...state.landmarkMarkers];
  updatePickables();
}

function rebuildEraMarkers(era) {
  clearEraMarkers();
  const marked = [];
  for (const c of era.capitals) marked.push(createMarker("capital", {
    name: c.name, lon: c.lon, lat: c.lat, note: c.note, key: true,
  }, "era"));
  for (const p of era.people) {
    marked.push(createMarker("person", {
      ...p, key: !!p.key,
    }, "era"));
  }
  for (const ev of era.events) {
    marked.push(createMarker("event", {
      ...ev, key: !!ev.key,
    }, "era"));
  }
  state.eraMarkers = marked;
  state.allMarkers = [...state.landmarkMarkers, ...marked];
  updatePickables();
  updateMarkerVisibility();
}

function buildLandmarkMarkers() {
  for (const lm of state.geo.landmarks) {
    const m = createMarker("landmark", { ...lm }, "landmark");
    state.landmarkMarkers.push(m);
  }
  state.allMarkers = [...state.landmarkMarkers, ...state.eraMarkers];
  updatePickables();
}

let pickables = [];
function updatePickables() {
  pickables = [];
  for (const m of state.allMarkers) {
    m.group.traverse((o) => { if (o.isMesh) pickables.push(o); });
  }
}

function updateMarkerVisibility() {
  const era = state.eras[state.eraIndex];
  for (const m of state.allMarkers) {
    const vis = isMarkerVisible(m);
    m.visible = vis;
    if (m.group) m.group.visible = vis;
    if (m.el) {
      m.el.classList.toggle("is-hidden", !vis);
      m.el.classList.toggle("is-visible", vis);
    }
    if (!vis) m.el?.classList.remove("is-selected");
  }
  if (state.selected && !state.selected.visible) {
    // keep detail open, but drop the glow
    state.selected.el?.classList.remove("is-selected");
  }
}

function updateMarkerAnimation(dt) {
  for (const m of state.allMarkers) {
    if (!m.visible) continue;
    const t = elapsed + m.phase;
    if (m.head) {
      m.head.position.y = m.baseHeadY + Math.sin(t * 1.5) * 0.055;
      if (m.type !== "person") m.head.rotation.y += dt * 0.55;
    }
    if (m.ring) {
      const s = 1 + Math.sin(t * 1.9) * 0.08;
      m.ring.scale.set(s, s, s);
    }
    if (m.halo) {
      m.halo.material.opacity = (m.type === "capital" ? 0.85 : 0.45) * (0.68 + 0.32 * Math.sin(t * 2.0));
    }
    if (m.group.userData.outerRing) {
      const s = 1 + Math.sin(t * 1.2 + 1.2) * 0.13;
      m.group.userData.outerRing.scale.set(s, s, s);
    }
  }
}

/* ---------------------------------------------------------------- projection / labels */
function projectPoint(world) {
  const v = world.clone().project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * window.innerWidth,
    y: (-v.y * 0.5 + 0.5) * window.innerHeight,
    z: v.z,
    visible: v.z < 1 && v.z > -1,
  };
}

function updateScreenOverlays() {
  const labelZoom = cam.dist < 38;
  const labels = [];
  for (const m of state.allMarkers) {
    if (!m.visible) continue;
    const p = projectPoint(new THREE.Vector3(m.group.position.x, m.group.position.y + m.labelLift, m.group.position.z));
    if (!p.visible || p.x < -120 || p.x > window.innerWidth + 120 || p.y < -80 || p.y > window.innerHeight + 80) {
      m.el.style.opacity = "0";
      continue;
    }
    m.el.style.opacity = "";
    m.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%)`;
    const want = m.key || labelZoom;
    if (m.type !== "capital") m.el.classList.toggle("is-label", want && !m.key);
    if (want) {
      labels.push({ m, x: p.x, y: p.y, w: m.labelW || 70, h: m.labelH || 22 });
    } else {
      m.el.classList.remove("is-label-hidden");
    }
  }

  const forced = (m) => m.hovered || state.selected === m;
  labels.sort((a, b) => (forced(b.m) ? 1 : 0) - (forced(a.m) ? 1 : 0) || b.m.priority - a.m.priority);
  const placed = [];
  for (const L of labels) {
    const rect = {
      x: L.x - L.w / 2 - 3,
      y: L.y - 19 - L.h - 3,
      w: L.w + 6,
      h: L.h + 6,
    };
    let overlap = false;
    for (const r of placed) {
      if (rect.x < r.x + r.w && rect.x + rect.w > r.x && rect.y < r.y + r.h && rect.y + rect.h > r.y) {
        overlap = true; break;
      }
    }
    const hide = overlap && !forced(L.m);
    L.m.el.classList.toggle("is-label-hidden", hide);
    if (!hide) placed.push(rect);
  }

  for (const a of state.adminLabels) {
    const p = projectPoint(a.world);
    const on = state.layers.admin && p.visible && p.x > 0 && p.x < window.innerWidth && p.y > 0 && p.y < window.innerHeight;
    a.el.classList.toggle("is-visible", on);
    if (on) a.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%)`;
  }

  for (const g of state.geoLabels) {
    const p = projectPoint(g.world);
    const on = state.layers.geo && p.visible && p.x > 0 && p.x < window.innerWidth && p.y > 0 && p.y < window.innerHeight;
    g.el.classList.toggle("is-visible", on);
    if (on) g.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%)`;
  }

  for (const { t, o } of state.allTerritoryTags || []) {
    const p = projectPoint(t.world);
    const on = state.layers.territory && o > 0.35 && p.visible &&
      p.x > 0 && p.x < window.innerWidth && p.y > 0 && p.y < window.innerHeight;
    if (on) {
      t.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%)`;
      t.el.classList.add("is-visible");
    } else {
      t.el.classList.remove("is-visible");
    }
  }
}

/* ---------------------------------------------------------------- camera */
function setupCamera() {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const narrow = window.innerWidth <= 900;
  const fitDist = 64 * clamp(1.55 / aspect, 1, 1.9);
  DEFAULT_CAM.dist = fitDist;
  if (narrow) DEFAULT_CAM.target.x = 0;
  cam.theta = 0.30;
  cam.phi = 1.02;
  cam.dist = fitDist * 1.9;
  cam.target.set(0, 0.8, 2.0);
  cam.desired.theta = DEFAULT_CAM.theta;
  cam.desired.phi = DEFAULT_CAM.phi;
  cam.desired.dist = DEFAULT_CAM.dist;
  cam.desired.target.copy(DEFAULT_CAM.target);
  updateCameraTransform();
  if (new URLSearchParams(location.search).get("instant") === "1") {
    cam.theta = DEFAULT_CAM.theta;
    cam.phi = DEFAULT_CAM.phi;
    cam.dist = DEFAULT_CAM.dist;
    cam.target.copy(DEFAULT_CAM.target);
    cam.desired.theta = DEFAULT_CAM.theta;
    cam.desired.phi = DEFAULT_CAM.phi;
    cam.desired.dist = DEFAULT_CAM.dist;
    cam.desired.target.copy(DEFAULT_CAM.target);
    updateCameraTransform();
    return;
  }
  camTween = {
    start: performance.now(),
    dur: REDUCED ? 0.6 : 2.9,
    from: {
      theta: cam.theta, phi: cam.phi, dist: cam.dist,
      target: cam.target.clone(),
    },
    to: {
      theta: DEFAULT_CAM.theta, phi: DEFAULT_CAM.phi, dist: DEFAULT_CAM.dist,
      target: DEFAULT_CAM.target.clone(),
    },
  };
}

function updateCameraTransform() {
  const sinPhi = Math.sin(cam.phi);
  camera.position.set(
    cam.target.x + cam.dist * sinPhi * Math.sin(cam.theta),
    cam.target.y + cam.dist * Math.cos(cam.phi),
    cam.target.z + cam.dist * sinPhi * Math.cos(cam.theta)
  );
  camera.lookAt(cam.target);
  camera.updateMatrixWorld();
}

function updateCamera(dt) {
  if (camTween) {
    const raw = clamp((performance.now() - camTween.start) / (camTween.dur * 1000), 0, 1);
    const t = easeInOutCubic(raw);
    cam.theta = lerp(camTween.from.theta, camTween.to.theta, t);
    cam.phi = lerp(camTween.from.phi, camTween.to.phi, t);
    cam.dist = lerp(camTween.from.dist, camTween.to.dist, t);
    cam.target.lerpVectors(camTween.from.target, camTween.to.target, t);
    if (raw >= 1) {
      camTween = null;
      cam.desired.theta = cam.theta;
      cam.desired.phi = cam.phi;
      cam.desired.dist = cam.dist;
      cam.desired.target.copy(cam.target);
    }
  } else {
    if (state.autoRotate && !state.dragging) cam.desired.theta += dt * 0.045;
    const k = 1 - Math.pow(0.0025, dt);
    cam.theta += (cam.desired.theta - cam.theta) * k;
    cam.phi += (cam.desired.phi - cam.phi) * k;
    cam.dist += (cam.desired.dist - cam.dist) * k;
    cam.target.lerp(cam.desired.target, k);
  }
  updateCameraTransform();

  const needle = $("#compassNeedle");
  if (needle) needle.style.transform = `translateX(-50%) rotate(${cam.theta}rad)`;
}

function flyTo(lon, lat, opts = {}) {
  const target = worldPosition(lon, lat, 0.35);
  if (target.y < 0.2) target.y = 0.38;
  const to = {
    theta: cam.theta,
    phi: opts.phi ?? 0.68,
    dist: opts.dist ?? clamp(cam.dist * 0.72, 32, 52),
    target,
  };
  camTween = {
    start: performance.now(),
    dur: REDUCED ? 0.4 : (opts.dur ?? 1.15),
    from: { theta: cam.theta, phi: cam.phi, dist: cam.dist, target: cam.target.clone() },
    to,
  };
}

function resetView() {
  camTween = {
    start: performance.now(),
    dur: REDUCED ? 0.4 : 1.25,
    from: { theta: cam.theta, phi: cam.phi, dist: cam.dist, target: cam.target.clone() },
    to: {
      theta: DEFAULT_CAM.theta, phi: DEFAULT_CAM.phi, dist: DEFAULT_CAM.dist,
      target: DEFAULT_CAM.target.clone(),
    },
  };
}

function interruptCamera() {
  if (camTween) {
    camTween = null;
    cam.desired.theta = cam.theta;
    cam.desired.phi = cam.phi;
    cam.desired.dist = cam.dist;
    cam.desired.target.copy(cam.target);
  }
}

/* ---------------------------------------------------------------- interactions */
const pointers = new Map();
let gesture = null;

function setupControls() {
  const canvas = $("#scene");
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas.addEventListener("pointerdown", (e) => {
    interruptCamera();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
    state.dragDistance = 0;
    state.suppressClick = false;
    if (pointers.size === 1) {
      state.dragging = true;
      state.yawDragging = true;
      canvas.classList.add("is-dragging");
      gesture = {
        mode: (e.button === 2 || e.shiftKey) ? "pan" : "rotate",
        lastX: e.clientX, lastY: e.clientY,
      };
    } else if (pointers.size === 2) {
      gesture = makePinchGesture();
    }
    hideHint();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) {
      hoverTest(e);
      return;
    }
    const prev = pointers.get(e.pointerId);
    state.dragDistance += Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: prev.button });

    if (pointers.size === 2) {
      if (gesture?.mode !== "pinch") gesture = makePinchGesture();
      const pts = [...pointers.values()];
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const scale = gesture.startDist / Math.max(1, dist);
      cam.desired.dist = clamp(gesture.startCamDist * scale, 18, 180);
      const dx = mid.x - gesture.startMid.x;
      const dy = mid.y - gesture.startMid.y;
      panCamera(dx, dy, gesture.startTarget);
      return;
    }

    if (!gesture) return;
    if (gesture.mode === "rotate") {
      const dx = e.clientX - gesture.lastX;
      const dy = e.clientY - gesture.lastY;
      cam.desired.theta -= dx * 0.0045;
      cam.desired.phi = clamp(cam.desired.phi - dy * 0.0035, 0.16, 1.24);
      gesture.lastX = e.clientX;
      gesture.lastY = e.clientY;
      state.suppressClick = state.dragDistance > 6;
    } else if (gesture.mode === "pan") {
      panCamera(e.clientX - gesture.lastX, e.clientY - gesture.lastY, null);
      gesture.lastX = e.clientX;
      gesture.lastY = e.clientY;
      state.suppressClick = state.dragDistance > 6;
    }
  });

  const endPointer = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      state.dragging = false;
      state.yawDragging = false;
      canvas.classList.remove("is-dragging");
      gesture = null;
    } else if (pointers.size === 1) {
      const [p] = [...pointers.values()];
      gesture = { mode: "rotate", lastX: p.x, lastY: p.y };
    }
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", (e) => {
    if (pointers.has(e.pointerId) && e.pointerType === "mouse") endPointer(e);
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    interruptCamera();
    cam.desired.dist = clamp(cam.desired.dist * Math.exp(e.deltaY * 0.0011), 18, 180);
    hideHint();
  }, { passive: false });

  canvas.addEventListener("click", (e) => {
    if (state.suppressClick || state.dragDistance > 6) {
      state.suppressClick = false;
      return;
    }
    handleCanvasClick(e);
  });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });

  // keyboard
  window.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    if (!$("#imageLightbox").hidden) {
      if (e.code === "Escape") closeLightbox();
      else if (e.code === "ArrowLeft") stepLightbox(-1);
      else if (e.code === "ArrowRight") stepLightbox(1);
      return;
    }
    if (e.code === "Space") {
      if (e.target.closest("button")) return;
      e.preventDefault();
      togglePlay();
    } else if (e.code === "ArrowLeft") {
      e.preventDefault();
      pause();
      setProgress(state.progress - (e.shiftKey ? 0.02 : 0.005));
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      pause();
      setProgress(state.progress + (e.shiftKey ? 0.02 : 0.005));
    } else if (e.code === "Escape") {
      closeWiki();
      closeDetail();
      closeHelp();
      document.body.classList.remove("panel-open");
    }
  });
}

function makePinchGesture() {
  const pts = [...pointers.values()];
  return {
    mode: "pinch",
    startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
    startCamDist: cam.desired.dist,
    startMid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
    startTarget: cam.desired.target.clone(),
  };
}

function panCamera(dx, dy, baseTarget) {
  const target = baseTarget ? baseTarget.clone() : cam.desired.target.clone();
  const scale = cam.dist * 0.0016;
  const right = new THREE.Vector3(Math.cos(cam.theta), 0, -Math.sin(cam.theta));
  const forward = new THREE.Vector3(Math.sin(cam.theta), 0, Math.cos(cam.theta));
  target.addScaledVector(right, -dx * scale);
  target.addScaledVector(forward, dy * scale);
  target.x = clamp(target.x, -MAP.w * 0.6, MAP.w * 0.6);
  target.z = clamp(target.z, -MAP.d * 0.6, MAP.d * 0.6);
  target.y = 0.2;
  cam.desired.target.copy(target);
}

function hoverTest(e) {
  if (!pickables.length) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(pointer, camera);
  const hits = ray.intersectObjects(pickables, false);
  const hit = hits.find((h) => h.object.userData.marker?.visible);
  $("#scene").style.cursor = hit ? "pointer" : "";
}

function handleCanvasClick(e) {
  if (!pickables.length) { closeDetail(); return; }
  const rect = renderer.domElement.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(pointer, camera);
  const hits = ray.intersectObjects(pickables, false);
  const hit = hits.find((h) => h.object.userData.marker?.visible);
  if (hit) onMarkerClick(hit.object.userData.marker);
  else closeDetail();
}

/* ---------------------------------------------------------------- timeline */
function progressEraIndex(p) {
  const n = state.eras.length;
  if (p >= 1) return n - 1;
  return clamp(Math.floor(p * n + 1e-9), 0, n - 1);
}
function progressToYear(p) {
  const n = state.eras.length;
  if (p >= 1) return state.eras[n - 1].end;
  const x = clamp(p, 0, 0.999999999) * n;
  const i = clamp(Math.floor(x + 1e-9), 0, n - 1);
  const local = x - i;
  const era = state.eras[i];
  if (era.end <= era.start) return era.start;
  return era.start + (era.end - era.start) * local;
}
function yearToProgress(year, preferEra) {
  let i = preferEra;
  if (i == null || i < 0) {
    i = state.eras.findIndex((e) => year >= e.start && year <= e.end);
  }
  if (i < 0) {
    // a gap: snap to the start of the nearest later era
    i = state.eras.findIndex((e) => e.start >= year);
    if (i < 0) i = state.eras.length - 1;
    return i / state.eras.length;
  }
  const e = state.eras[i];
  if (e.end <= e.start) {
    return i === state.eras.length - 1 ? 1 : (i + 0.9995) / state.eras.length;
  }
  let local = (year - e.start) / (e.end - e.start);
  local = clamp(local, 0, 0.9995);
  if (i === state.eras.length - 1 && year >= e.end) local = 1;
  return (i + local) / state.eras.length;
}

function buildTimeline() {
  const segments = $("#segments");
  const labels = $("#trackLabels");
  const dots = $("#eventDots");
  segments.innerHTML = "";
  labels.innerHTML = "";
  dots.innerHTML = "";
  state.eventDots = [];

  state.eras.forEach((era, i) => {
    const seg = document.createElement("div");
    seg.className = "segment";
    seg.dataset.era = i;
    seg.style.setProperty("--seg-bg", hexToRgba(era.color, 0.07));
    seg.style.setProperty("--seg-active", hexToRgba(era.color, 0.34));
    seg.title = `${era.name} · ${fmtRange(era)}`;
    segments.appendChild(seg);

    const lab = document.createElement("div");
    lab.className = "track-label";
    lab.innerHTML = `<b>${era.name}</b>${fmtRange(era)}`;
    labels.appendChild(lab);

    for (const ev of era.events) {
      const local = eraLocal(era, ev.year);
      const p = (i + local) / state.eras.length;
      const dot = document.createElement("button");
      dot.className = "event-dot" + (ev.key ? " is-key" : "");
      dot.style.left = `${p * 100}%`;
      dot.style.setProperty("--dot-color", era.color);
      dot.title = `${shortYear(ev.year)} · ${ev.name}`;
      dot.dataset.era = i;
      dot.dataset.year = ev.year;
      dot.addEventListener("pointerdown", (e) => e.stopPropagation());
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        pause();
        const prog = (i + eraLocal(era, ev.year)) / state.eras.length;
        setProgress(prog);
        setTimeout(() => focusItem("event", ev, { fly: true, keepTime: true }), 160);
      });
      dots.appendChild(dot);
      state.eventDots.push({ el: dot, era: i, event: ev });
    }
  });
  updateEraChrome(true);
}

function updateEraChrome(initial = false) {
  const era = state.eras[state.eraIndex];
  if (!era) return;
  $("#currentEra").textContent = era.name;
  $("#currentEra").style.fontSize = era.name.length > 4 ? "15px" : "";
  $("#currentYears").textContent = fmtRange(era);
  $("#mapNote").textContent = era.mapNote;
  $("#eraTitle").textContent = era.name;
  $("#eraSubtitle").textContent = era.fullName;
  $("#eraYears").textContent = fmtRange(era);
  $("#eraSummary").textContent = era.summary;
  $("#chapterNo").textContent = pad2(state.eraIndex + 1);
  $("#chapterTotal").textContent = pad2(state.eras.length);
  $("#countPeople").textContent = era.people.length;
  $("#countEvents").textContent = era.events.length;
  $("#countLandmarks").textContent = availableLandmarks().length;

  const capRow = $("#capitalRow");
  capRow.innerHTML = "";
  for (const c of era.capitals) {
    const b = document.createElement("button");
    b.className = "capital-chip";
    b.innerHTML = `<i></i>都城 ${c.name}<em>${c.note || ""}</em>`;
    b.addEventListener("click", () => {
      focusItem("capital", { ...c, key: true }, { fly: true });
      onMobilePanelClose();
    });
    capRow.appendChild(b);
  }

  $$(".era-item").forEach((el, i) => el.classList.toggle("is-active", i === state.eraIndex));
  $$(".segment").forEach((el, i) => el.classList.toggle("is-active", i === state.eraIndex));
  $$(".track-label").forEach((el, i) => el.classList.toggle("is-active", i === state.eraIndex));
  if (!initial) flashEra();
}

function flashEra() {
  const tl = $("#timeline");
  tl.style.transition = "none";
  tl.style.borderColor = "rgba(231,195,122,.55)";
  requestAnimationFrame(() => {
    tl.style.transition = "border-color .9s ease";
    tl.style.borderColor = "";
  });
}

function setProgress(p, opts = {}) {
  const clamped = clamp(p, 0, 1);
  const newEra = progressEraIndex(clamped);
  const year = progressToYear(clamped);
  const changed = newEra !== state.eraIndex;

  state.progress = clamped;
  state.year = year;
  if (changed) {
    state.eraIndex = newEra;
    enterEra(newEra, opts);
  }
  updateYearUI();
}

function enterEra(index, opts = {}) {
  state.eraIndex = index;
  const era = state.eras[index];
  ensureTerritory(era);
  activateTerritory(era.id, !!opts.initial);
  rebuildEraMarkers(era);
  renderAdminLabels(era);
  updateEraChrome(!!opts.initial);
  renderPanel();
  closeDetail();
  state.selected = null;
  if (!opts.initial && cam.dist < 50) resetView();
  if (!opts.silent && !opts.initial) {
    showToast(`${era.name} · ${fmtRange(era)}`, 1500);
  }
}

function updateYearUI() {
  const era = state.eras[state.eraIndex];
  if (!era) return;
  $("#yearText").textContent = fmtYear(state.year);
  $("#handle").style.left = `${state.progress * 100}%`;
  $("#trackFill").style.width = `${state.progress * 100}%`;
  const tol = eventTolerance(era);
  for (const d of state.eventDots) {
    const past = d.event.year <= state.year + tol;
    d.el.classList.toggle("is-past", past);
    d.el.classList.toggle("is-active", past && Math.abs(d.event.year - state.year) < tol * 1.5);
  }
  $$("#panelList .card[data-year]").forEach((c) => {
    const y = Number(c.dataset.year);
    c.classList.toggle("is-future", y > state.year + tol);
  });
  updateMarkerVisibility();
  updateLandmarkAvailability();
  const future = era.events.some((e) => e.year > state.year + tol);
  $("#panelFootText").textContent = future ? "未来事件可点击穿越" : "点击条目，飞越至历史现场";
}

function setYear(year, eraIndex) {
  setProgress(yearToProgress(year, eraIndex));
}

function goEra(index, useDefault = true) {
  if (index < 0 || index >= state.eras.length) return;
  pause();
  const era = state.eras[index];
  const year = useDefault ? era.defaultYear : clamp(state.year, era.start, era.end);
  setProgress(yearToProgress(year, index));
}

function togglePlay() {
  if (state.playing) pause();
  else {
    if (state.progress >= 0.9999) setProgress(0);
    state.playing = true;
    state.holdUntil = 0;
    document.body.classList.add("is-playing");
    $("#playBtn").setAttribute("aria-label", "暂停");
    hideHint();
  }
}
function pause() {
  state.playing = false;
  document.body.classList.remove("is-playing");
  $("#playBtn").setAttribute("aria-label", "播放");
}

function updatePlayback(dt, now) {
  if (!state.playing) return;
  if (now < state.holdUntil) return;
  const eraCount = state.eras.length;
  const speed = 1 / (eraCount * 3.35);
  let next = state.progress + dt * speed;
  if (next >= 1) {
    setProgress(1);
    pause();
    showToast("山河长卷 · 1949", 3200);
    return;
  }
  const oldEra = progressEraIndex(state.progress);
  const newEra = progressEraIndex(next);
  if (newEra !== oldEra) {
    const boundary = newEra / eraCount;
    setProgress(boundary);
    state.holdUntil = now + 620;
    return;
  }
  setProgress(next);
}

function setupTimeline() {
  const track = $("#track");
  let scrubbing = false;

  const updateFromEvent = (e) => {
    const rect = track.getBoundingClientRect();
    const p = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    setProgress(p);
  };

  track.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".event-dot")) return;
    pause();
    interruptCamera();
    scrubbing = true;
    document.body.classList.add("is-scrubbing");
    track.setPointerCapture(e.pointerId);
    updateFromEvent(e);
    hideHint();
  });
  track.addEventListener("pointermove", (e) => {
    if (!scrubbing) return;
    updateFromEvent(e);
  });
  const end = (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    document.body.classList.remove("is-scrubbing");
  };
  track.addEventListener("pointerup", end);
  track.addEventListener("pointercancel", end);

  $("#playBtn").addEventListener("click", togglePlay);
  $("#btnPrev").addEventListener("click", () => goEra(state.eraIndex - 1));
  $("#btnNext").addEventListener("click", () => goEra(state.eraIndex + 1));

  track.addEventListener("keydown", (e) => {
    if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
      e.preventDefault();
      pause();
      setProgress(state.progress + (e.code === "ArrowLeft" ? -0.01 : 0.01));
    }
  });
}

/* ---------------------------------------------------------------- side panel */
function buildEraRail() {
  const rail = $("#eraRail");
  rail.innerHTML = "";
  state.eras.forEach((era, i) => {
    const b = document.createElement("button");
    b.className = "era-item" + (i === 0 ? " is-active" : "");
    b.dataset.era = i;
    b.innerHTML = `<span class="era-dot"></span><span class="era-name">${era.name}</span><span class="era-yrs">${fmtRange(era)}</span>`;
    b.addEventListener("click", () => {
      goEra(i);
      document.body.classList.remove("panel-open");
    });
    rail.appendChild(b);
  });
}

function renderPanel() {
  const era = state.eras[state.eraIndex];
  if (!era) return;
  const list = $("#panelList");
  list.innerHTML = "";
  if (state.tab === "people") {
    era.people.forEach((p, i) => {
      const card = document.createElement("button");
      card.className = "card card-person art-card";
      card.style.animationDelay = `${Math.min(i * 0.035, 0.3)}s`;
      card.innerHTML = `${mediaThumbHTML("person", p)}<span class="art-body">
        <span class="card-top"><span class="card-name">${p.name}</span><span class="card-title">${p.title || ""}</span></span>
        <span class="card-meta">${p.life || ""}</span>
        <span class="card-desc">${p.desc}</span></span>`;
      card.addEventListener("click", () => {
        focusItem("person", p, { fly: true });
        onMobilePanelClose();
      });
      list.appendChild(card);
    });
  } else if (state.tab === "events") {
    const tol = eventTolerance(era);
    era.events.forEach((ev, i) => {
      const card = document.createElement("button");
      card.className = "card card-event-card art-card" + (ev.year > state.year + tol ? " is-future" : "");
      card.dataset.year = ev.year;
      card.style.animationDelay = `${Math.min(i * 0.035, 0.3)}s`;
      card.innerHTML = `${mediaThumbHTML("event", ev)}<span class="card-event art-body">
          <span class="event-year">${shortYear(ev.year)}</span>
          <span class="event-body">
            <span class="event-name">${ev.name}</span>
            <span class="event-place">${ev.key ? "重要节点 · 点击定位" : "历史事件 · 点击定位"}</span>
          </span>
        </span>`;
      card.addEventListener("click", () => {
        pause();
        if (ev.year > state.year + tol) {
          setProgress(yearToProgress(ev.year, state.eraIndex));
        }
        setTimeout(() => focusItem("event", ev, { fly: true, keepTime: true }), 120);
        onMobilePanelClose();
      });
      list.appendChild(card);
    });
  } else {
    const lms = availableLandmarks();
    state.landmarkIds = lms.map((lm) => lm.name).join("|");
    if (!lms.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = `<b>此时期暂无已建成古迹</b><span>继续沿时间轴向前，古迹会随时代陆续出现。</span>`;
      list.appendChild(empty);
    }
    lms.forEach((lm, i) => {
      const card = document.createElement("button");
      card.className = "card card-landmark art-card";
      card.style.animationDelay = `${Math.min(i * 0.02, 0.25)}s`;
      card.innerHTML = `${mediaThumbHTML("landmark", lm)}<span class="art-body">
        <span class="card-top"><span class="card-name">${lm.name}</span><span class="lm-type">${lm.type}</span></span>
        <span class="card-meta">${lm.yearLabel}</span>
        <span class="card-desc">${lm.desc}</span></span>`;
      card.addEventListener("click", () => {
        focusItem("landmark", lm, { fly: true });
        onMobilePanelClose();
      });
      list.appendChild(card);
    });
  }
  $("#panelFootText").textContent = state.tab === "events" ? "未来事件可点击穿越" : "点击条目，飞越至历史现场";
}

function onMobilePanelClose() {
  if (window.innerWidth <= 900) document.body.classList.remove("panel-open");
}

function setupPanel() {
  $$("#panelTabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.tab = tab.dataset.tab;
      $$("#panelTabs .tab").forEach((t) => t.classList.toggle("is-active", t === tab));
      renderPanel();
    });
  });
  $("#panelToggle").addEventListener("click", () => document.body.classList.toggle("panel-open"));
  $("#panelClose").addEventListener("click", () => document.body.classList.remove("panel-open"));
}

/* ---------------------------------------------------------------- detail */
function openDetailFor(obj, marker = null) {
  const { type, data } = obj;
  const stamp = type === "person" ? "人" : type === "event" ? "事" : type === "landmark" ? "迹" : "都";
  const kind = type === "person" ? "人物志" : type === "event" ? "大事记" : type === "landmark" ? "古迹志" : "都城";
  const meta =
    type === "person" ? `${data.life || ""}${data.title ? " · " + data.title : ""}` :
    type === "event" ? fmtYear(data.year) :
    type === "landmark" ? `${data.yearLabel || ""} · ${data.type || ""}` :
    data.note || "";
  const name = data.name || data.note;
  $("#detailStamp").textContent = stamp;
  $("#detailKind").textContent = kind;
  $("#detailName").textContent = name;
  $("#detailMeta").textContent = meta;
  let desc = data.desc || "";
  if (!desc && type === "capital") {
    const era = state.eras[state.eraIndex];
    desc = `${data.note || ""}。${era ? era.fullName : ""}的政治中心，也是那个时代人口、财富与权力的汇聚之地。`;
  }
  $("#detailDesc").textContent = desc;
  $("#detailCoord").textContent = `北纬 ${Number(data.lat).toFixed(1)}° · 东经 ${Number(data.lon).toFixed(1)}°`;
  $("#detailCard").hidden = false;
  state.detail = { type, data, marker };

  const art = $("#detailArt");
  if (type === "capital") {
    art.style.display = "none";
    art.dataset.key = "";
    art.innerHTML = "";
  } else {
    art.style.display = "";
    const key = thumbKey(type, data);
    art.dataset.key = key;
    art.innerHTML = mediaImageHTML(type, data, key);
    art.onclick = () => openWiki(type, data);
  }
  $("#detailWiki").onclick = () => openWiki(type, data);

  if (state.selected && state.selected !== marker) state.selected.el?.classList.remove("is-selected");
  state.selected = marker;
  marker?.el?.classList.add("is-selected");

  $("#detailFly").onclick = () => {
    flyTo(data.lon, data.lat, { dist: 34 });
  };
}
function closeDetail() {
  $("#detailCard").hidden = true;
  state.detail = null;
  if (state.selected) state.selected.el?.classList.remove("is-selected");
  state.selected = null;
}

/* ---------------------------------------------------------------- 本地百科 · 图集 */
function wikiKey(type, data) {
  if (type === "event") return `event:${data.year}:${data.name}`;
  if (type === "capital") return `capital:${state.eras[state.eraIndex]?.id}:${data.name}`;
  return `${type}:${data.name}`;
}
function buildWikiLookup() {
  const map = new Map();
  for (const era of state.eras) {
    for (const p of era.people) map.set(`person:${p.name}`, { type: "person", data: p, eraId: era.id });
    for (const ev of era.events) map.set(`event:${ev.year}:${ev.name}`, { type: "event", data: ev, eraId: era.id });
    for (const c of era.capitals) map.set(`capital:${era.id}:${c.name}`, { type: "capital", data: c, eraId: era.id });
  }
  for (const lm of state.geo.landmarks) {
    const key = `landmark:${lm.name}`;
    const entry = state.wikiBook?.entries?.[key];
    map.set(key, { type: "landmark", data: lm, eraId: entry?.eraId || null });
  }
  state.wikiLookup = map;
}
function fallbackFacts(type, data, era) {
  const facts = [];
  if (era) facts.push(["所属时期", `${era.name} · ${fmtRange(era)}`]);
  if (type === "person") {
    facts.push(["身份", data.title || "人物"]);
    facts.push(["生卒", data.life || "不详"]);
  } else if (type === "event") {
    facts.push(["发生年代", fmtYear(data.year)]);
    facts.push(["事件类型", data.key ? "重要历史节点" : "历史事件"]);
  } else if (type === "landmark") {
    facts.push(["始建年代", data.yearLabel || "不详"]);
    facts.push(["古迹类型", data.type || "古迹"]);
  } else {
    facts.push(["都城", data.note || data.name]);
  }
  const coord = data.lon != null ? `北纬 ${Number(data.lat).toFixed(1)}° · 东经 ${Number(data.lon).toFixed(1)}°` : "—";
  facts.push(["坐标", coord]);
  return facts;
}
function renderWikiGallery(entry, type, data) {
  const hero = $("#wikiHero");
  const img = $("#wikiHeroImg");
  const empty = $("#wikiHeroEmpty");
  const thumbs = $("#wikiThumbs");
  const credit = $("#wikiCredit");
  const count = $("#wikiImageCount");
  const images = entry?.images || [];
  if (!images.length) {
    state.wikiGallery = { images: [], index: 0, type, data };
    hero.classList.add("no-image");
    img.removeAttribute("src");
    img.style.display = "none";
    img.onclick = null;
    empty.style.display = "";
    empty.textContent = typeChar(type);
    thumbs.innerHTML = "";
    credit.textContent = "暂无本地图片";
    count.textContent = "本地百科";
    $("#wikiFullscreen").hidden = true;
    return;
  }
  state.wikiGallery = { images, index: 0, type, data };
  hero.classList.remove("no-image");
  empty.style.display = "none";
  img.style.display = "";
  $("#wikiFullscreen").hidden = false;
  const show = (index) => {
    const im = images[index];
    if (!im) return;
    state.wikiGallery.index = index;
    img.src = `assets/images/${im.file}`;
    img.alt = im.caption || data.name || data.note || "";
    credit.textContent = `${im.credit || "公开网络资料"}${im.license ? " · " + im.license : ""}`;
    count.textContent = `图集 ${index + 1}/${images.length}`;
    thumbs.querySelectorAll("button").forEach((b, j) => b.classList.toggle("is-active", j === index));
  };
  img.onclick = () => openLightbox(state.wikiGallery?.index || 0);
  img.onerror = () => {
    hero.classList.add("no-image");
    img.style.display = "none";
    empty.style.display = "";
    empty.textContent = typeChar(type);
    $("#wikiFullscreen").hidden = true;
  };
  thumbs.innerHTML = images.map((im, i) =>
    `<button class="${i === 0 ? "is-active" : ""}" data-index="${i}" aria-label="图片 ${i + 1}"><img src="assets/images/${escHTML(im.file)}" alt=""></button>`
  ).join("");
  thumbs.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => show(Number(btn.dataset.index)));
  });
  show(0);
}
function updateLightbox() {
  const g = state.wikiGallery;
  if (!g?.images?.length) return;
  const index = ((state.lightboxIndex ?? 0) + g.images.length) % g.images.length;
  state.lightboxIndex = index;
  const im = g.images[index];
  const img = $("#lbImg");
  img.src = `assets/images/${im.file}`;
  img.alt = im.caption || g.data?.name || g.data?.note || "";
  $("#lbCounter").textContent = `${index + 1} / ${g.images.length}`;
  $("#lbCredit").textContent = `${im.credit || "公开网络资料"}${im.license ? " · " + im.license : ""}`;
  $("#lbPrev").hidden = g.images.length < 2;
  $("#lbNext").hidden = g.images.length < 2;
}
function openLightbox(index = 0) {
  const g = state.wikiGallery;
  if (!g?.images?.length) return;
  state.lightboxIndex = index;
  $("#imageLightbox").hidden = false;
  updateLightbox();
}
function closeLightbox() {
  $("#imageLightbox").hidden = true;
}
function stepLightbox(delta) {
  const g = state.wikiGallery;
  if (!g?.images?.length) return;
  state.lightboxIndex = ((state.lightboxIndex ?? 0) + delta + g.images.length) % g.images.length;
  updateLightbox();
}
function openWiki(type, data, entryKey = null, forceEraId = null) {
  if (!data) return;
  if (state.playing) pause();
  closeWiki(true);
  const key = entryKey || wikiKey(type, data);
  const entry = state.wikiBook?.entries?.[key] || null;
  const eraId = entry?.eraId || forceEraId || state.eras[state.eraIndex]?.id;
  const era = state.eras.find((e) => e.id === eraId) || state.eras[state.eraIndex];
  const name = entry?.title || data.name || data.note;
  const kind = entry?.kind || (type === "person" ? "人物志" : type === "event" ? "大事记" : type === "landmark" ? "古迹志" : "都城志");
  const meta = entry?.meta || (
    type === "person" ? `${data.life || ""}${data.title ? " · " + data.title : ""}` :
    type === "event" ? fmtYear(data.year) :
    type === "landmark" ? `${data.yearLabel || ""} · ${data.type || ""}` :
    data.note || ""
  );
  let intro = entry?.intro || data.desc || "";
  if (!intro && type === "capital") {
    intro = `${data.note || ""}。${era ? era.fullName : ""}的政治中心，也是那个时代人口、财富与权力的汇聚之地。`;
  }
  const facts = entry?.facts || fallbackFacts(type, data, era);
  const sections = entry?.sections || (era ? [
    { title: "时代背景", text: era.summary },
    { title: "本地百科", text: "此条目暂无扩展章节；以上简介、事实与相关条目均来自课件本地存档。" },
  ] : []);
  const related = entry?.related || [];
  $("#wikiKind").textContent = kind;
  $("#wikiName").textContent = name;
  $("#wikiMeta").textContent = meta;
  $("#wikiDesc").textContent = intro;
  $("#wikiFacts").innerHTML = facts.map(([k, v]) => `<div class="wiki-fact"><b>${escHTML(k)}</b><span>${escHTML(v)}</span></div>`).join("");
  $("#wikiSections").innerHTML = sections.map((s) => `<section class="wiki-section"><h4>${escHTML(s.title)}</h4><p>${escHTML(s.text)}</p></section>`).join("");
  $("#wikiRelated").innerHTML = related.length
    ? `<span class="wiki-related-label">相关条目</span><div class="wiki-related-grid">${related.map((r) => `<button class="wiki-related-item" data-key="${escHTML(r.key)}"><b>${escHTML(r.label)}</b><em>${escHTML(r.sub || "")}</em></button>`).join("")}</div>`
    : "";
  state.wiki = { type, data, entryKey: key, eraId };
  $("#wikiModal").hidden = false;
  renderWikiGallery(entry, type, data);
  $("#wikiFly").onclick = () => {
    const targetEraId = type === "landmark" ? state.eras[state.eraIndex]?.id : (state.wiki?.eraId || state.eras[state.eraIndex]?.id);
    const idx = state.eras.findIndex((e) => e.id === targetEraId);
    closeWiki();
    if (idx >= 0 && idx !== state.eraIndex) {
      if (type === "event" && data.year != null) setProgress(yearToProgress(data.year, idx));
      else goEra(idx);
      setTimeout(() => focusItem(type, data, { fly: true }), 650);
    } else {
      focusItem(type, data, { fly: true });
    }
  };
}
function closeWiki(silent = false) {
  if (!silent) $("#wikiModal").hidden = true;
  closeLightbox();
  state.wiki = null;
}

function onMarkerClick(marker, opts = {}) {
  if (!marker || !marker.visible) return;
  if (state.playing) pause();
  openDetailFor({ type: marker.type, data: marker.data }, marker);
  if (opts.fly !== false) {
    flyTo(marker.data.lon, marker.data.lat, { dist: marker.type === "capital" ? 40 : 34 });
  }
}

function focusItem(type, data, opts = {}) {
  const marker = state.allMarkers.find((m) => {
    if (m.type !== type) return false;
    if (type === "event") return m.data.year === data.year && m.data.name === data.name;
    return m.data.name === data.name;
  });
  if (marker && marker.visible) {
    onMarkerClick(marker, opts);
    return;
  }
  if (data.lon != null) flyTo(data.lon, data.lat, { dist: 34 });
  openDetailFor({ type, data }, marker || null);
}

/* ---------------------------------------------------------------- layers & misc UI */
function setupChrome() {
  $$("#layerChips .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const key = chip.dataset.layer;
      state.layers[key] = !state.layers[key];
      chip.classList.toggle("is-on", state.layers[key]);
      if (key === "territory") {
        activateTerritory(state.eras[state.eraIndex].id);
      }
      if (key === "geo" && riversGroup) {
        riversGroup.visible = state.layers.geo;
      }
      if (key === "admin") {
        renderAdminLabels(state.eras[state.eraIndex]);
        if (state.layers.admin && !(state.eras[state.eraIndex].adminUnits || []).length) {
          showToast("此时期暂无可标注的行政区划", 1600);
        }
        updateScreenOverlays();
      }
      updateMarkerVisibility();
      showToast(`${chip.textContent.trim()}图层${state.layers[key] ? "开启" : "关闭"}`, 1200);
    });
  });

  $("#btnRotate").addEventListener("click", () => {
    state.autoRotate = !state.autoRotate;
    $("#btnRotate").classList.toggle("is-on", state.autoRotate);
    showToast(state.autoRotate ? "自动环绕已开启" : "自动环绕已关闭", 1300);
  });
  $("#btnReset").addEventListener("click", resetView);
  $("#btnHelp").addEventListener("click", openHelp);
  $("#modalClose").addEventListener("click", closeHelp);
  $("#helpModal").addEventListener("click", (e) => {
    if (e.target.dataset.closeModal !== undefined) closeHelp();
  });
  $("#detailClose").addEventListener("click", closeDetail);
  $("#wikiClose").addEventListener("click", () => closeWiki());
  $("#wikiModal").addEventListener("click", (e) => {
    if (e.target.dataset.closeWiki !== undefined) closeWiki();
  });
  $("#wikiRelated").addEventListener("click", (e) => {
    const btn = e.target.closest(".wiki-related-item");
    if (!btn) return;
    const ref = state.wikiLookup.get(btn.dataset.key);
    if (ref) openWiki(ref.type, ref.data, btn.dataset.key, ref.eraId);
  });
  $("#wikiFullscreen").addEventListener("click", (e) => {
    e.stopPropagation();
    openLightbox(state.wikiGallery?.index || 0);
  });
  $("#lbClose").addEventListener("click", closeLightbox);
  $("#lbPrev").addEventListener("click", () => stepLightbox(-1));
  $("#lbNext").addEventListener("click", () => stepLightbox(1));
  $("#imageLightbox").addEventListener("click", (e) => {
    if (e.target.id === "imageLightbox") closeLightbox();
  });

  const hint = $("#hint");
  setTimeout(() => hint.classList.add("is-gone"), 12000);
}
function openHelp() { $("#helpModal").hidden = false; }
function closeHelp() { $("#helpModal").hidden = true; }
function hideHint() { $("#hint").classList.add("is-gone"); }

/* ---------------------------------------------------------------- boot */
async function boot() {
  if (location.protocol === "file:") {
    showError("检测到以本地文件方式打开。浏览器会阻止读取地形贴图与数据，请按下方命令启动本地服务后再访问。");
    return;
  }
  const t0 = performance.now();
  setLoad(6, "读取历史地理数据…");
  const res = await fetch("assets/geo.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`地理数据读取失败（HTTP ${res.status}）`);
  const geo = await res.json();
  state.geo = geo;
  state.eras = geo.eras;
  try {
    const wr = await fetch("assets/wiki.json", { cache: "no-store" });
    if (wr.ok) state.wikiBook = await wr.json();
  } catch (e) { state.wikiBook = null; }
  setupMap(geo);
  buildWikiLookup();
  document.title = "山河纪 · 中国历史三维时空图谱";

  setLoad(14, "载入地形、海岸与纹理…");
  initRendererOnly();
  const assets = await loadAssets();
  state.textures = assets;

  setLoad(70, "构筑三维山河…");
  initScene();
  setLoad(82, "点亮疆域与古迹…");
  buildEraRail();
  buildTimeline();
  buildLandmarkMarkers();
  setupPanel();
  setupChrome();
  setupTimeline();
  setupControls();

  // initial era
  const params = new URLSearchParams(location.search);
  let startEra = 0;
  if (params.get("era")) {
    const idx = state.eras.findIndex((e) => e.id === params.get("era"));
    if (idx >= 0) startEra = idx;
  }
  state.progress = 0;
  state.year = state.eras[0].start;
  state.eraIndex = -1;
  setProgress(yearToProgress(state.eras[startEra].defaultYear, startEra), { initial: true });
  if (params.get("tab") === "events" || params.get("tab") === "landmarks") {
    state.tab = params.get("tab");
    $$("#panelTabs .tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === state.tab));
    renderPanel();
  }

  setLoad(94, "校准星辰与光影…");
  setupCamera();
  const elapsedLoad = performance.now() - t0;
  if (elapsedLoad < 900) await delay(900 - elapsedLoad);
  setLoad(100, "山河已就绪");
  await delay(180);
  $("#loading").classList.add("is-done");
  state.started = true;
  document.body.dataset.ready = "1";

  animate(performance.now());
  setTimeout(() => showToast("拖动底栏，穿越两千年", 2600), 1400);
  if (params.get("play") === "1") setTimeout(togglePlay, 1800);
}

function initRendererOnly() {
  const canvas = $("#scene");
  try {
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: true, powerPreference: "high-performance",
    });
  } catch (e) {
    throw new Error("当前浏览器无法启用 WebGL，请使用新版 Chrome / Edge 打开。");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setClearColor(0x000000, 0);
}

/* ---------------------------------------------------------------- main loop */
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;
  elapsed += dt;

  updatePlayback(dt, now);
  updateCamera(dt);
  updateTerritories(dt);
  updateMarkerAnimation(dt);
  updateScreenOverlays();

  if (waterMat) waterMat.uniforms.uTime.value = elapsed;
  for (const mat of riverMats) mat.uniforms.uTime.value = elapsed;
  if (starField) starField.rotation.y += dt * 0.0015;
  if (sunSprite) sunSprite.material.opacity = 0.18 + Math.sin(elapsed * 0.2) * 0.03;

  // territory tag positions need current project; done in updateScreenOverlays
  renderer.render(scene, camera);
}

/* ---------------------------------------------------------------- start */
boot().catch((err) => {
  console.error(err);
  showError(err?.message || "课件初始化失败，请检查控制台日志。");
});
window.__shanhe = { state, cam, setProgress, setYear, goEra, flyTo, resetView };
