/** 共用雜訊函式 */
export const NOISE = /* glsl */ `
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x),
        mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
        mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}
`

/** 海浪高度（需與 JS 版 waveHeight 保持一致） */
export const WAVES = /* glsl */ `
float waves(vec2 p, float t) {
  float h = 0.0;
  h += sin(p.x * 0.35 + t * 0.9) * 0.32;
  h += sin(p.y * 0.5 - t * 1.1 + p.x * 0.2) * 0.2;
  h += sin((p.x + p.y) * 0.9 + t * 1.7) * 0.08;
  h += sin((p.x * 1.7 - p.y * 1.3) + t * 2.3) * 0.04;
  return h;
}
`

/* ---------------- 天空 ---------------- */
export const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`

export const skyFrag = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uSunSize;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float k = smoothstep(0.0, 0.45, d.y);
  vec3 col = mix(uHorizon, uTop, k);
  // 扁平的太陽圓盤，外圍一圈淡光暈
  float s = dot(d, normalize(uSunDir));
  float disk = smoothstep(uSunSize - 0.0004, uSunSize, s);
  float halo = smoothstep(uSunSize - 0.02, uSunSize, s) * 0.18;
  col = mix(col, uSunColor, clamp(disk + halo, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`

/* ---------------- 地面 / 海 ---------------- */
export const waterVert = /* glsl */ `
${WAVES}
uniform float uTime;
uniform float uSpread;
uniform float uWaveAmp;
uniform float uRippleAmp;
uniform vec2 uCenter;
varying vec3 vWorld;
varying float vMask;
varying float vH;
varying float vDist;
varying vec3 vNormal;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float d = distance(w.xz, uCenter);
  float mask = 1.0 - smoothstep(uSpread - 1.2, uSpread, d);
  float ripple = sin(d * 5.0 - uTime * 3.2) * exp(-d * 0.35) * uRippleAmp;
  float h = mask * (waves(w.xz, uTime) * uWaveAmp + ripple);
  // 以有限差分求平滑法線，讓色階邊界柔順
  float e = 0.08;
  vec2 px = w.xz + vec2(e, 0.0);
  vec2 pz = w.xz + vec2(0.0, e);
  float dx = distance(px, uCenter);
  float dz = distance(pz, uCenter);
  float hx = (1.0 - smoothstep(uSpread - 1.2, uSpread, dx)) * (waves(px, uTime) * uWaveAmp + sin(dx * 5.0 - uTime * 3.2) * exp(-dx * 0.35) * uRippleAmp);
  float hz = (1.0 - smoothstep(uSpread - 1.2, uSpread, dz)) * (waves(pz, uTime) * uWaveAmp + sin(dz * 5.0 - uTime * 3.2) * exp(-dz * 0.35) * uRippleAmp);
  vNormal = normalize(vec3(h - hx, e, h - hz));
  w.y += h;
  vWorld = w.xyz;
  vMask = mask;
  vH = h;
  vDist = d;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

export const waterFrag = /* glsl */ `
${NOISE}
uniform vec3 uSunDir;
uniform vec3 uFloor;
uniform vec3 uFloorLine;
uniform vec3 uZima;
uniform vec3 uZimaLight;
uniform vec3 uDeep;
uniform vec3 uFog;
uniform float uFogNear;
uniform float uFogFar;
uniform float uSpread;
uniform float uWaveAmp;
uniform float uTime;
varying vec3 vWorld;
varying float vMask;
varying float vH;
varying float vDist;
varying vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  vec3 sun = normalize(uSunDir);
  float diff = dot(n, sun);

  // 白色磁磚地面（Zima 的泳池）
  vec2 g = abs(fract(vWorld.xz * 0.6) - 0.5);
  float lineWidth = fwidth(vWorld.x * 0.6) + fwidth(vWorld.z * 0.6);
  float line = 1.0 - smoothstep(0.0, 0.012 + lineWidth, 0.5 - max(g.x, g.y));
  // 遠處線條淡出，避免閃爍
  line *= 1.0 - smoothstep(6.0, 22.0, distance(vWorld, cameraPosition));
  vec3 floorCol = mix(uFloor, uFloorLine, line * 0.6);

  // 賽璐璐式三階水色
  float base = sun.y;
  vec3 water = uDeep;
  water = mix(water, uZima, smoothstep(base - 0.06, base - 0.04, diff));
  water = mix(water, uZimaLight, smoothstep(base + 0.05, base + 0.07, diff));
  // 浪尖白沫
  float amp = max(uWaveAmp, 0.001);
  float foamN = vnoise(vec3(vWorld.xz * 1.6, uTime * 0.4));
  float foam = smoothstep(0.5, 0.53, vH / amp + foamN * 0.15) * smoothstep(0.25, 0.5, uWaveAmp);
  water = mix(water, vec3(0.95, 0.98, 1.0), foam * 0.9);

  vec3 col = mix(floorCol, water, vMask);
  // 擴散前緣的一道白線
  float front = smoothstep(uSpread - 1.0, uSpread - 0.55, vDist) * (1.0 - smoothstep(uSpread - 0.55, uSpread - 0.1, vDist));
  col = mix(col, vec3(1.0), front * step(0.01, uSpread) * 0.8);

  float f = smoothstep(uFogNear, uFogFar, distance(vWorld, cameraPosition));
  col = mix(col, uFog, f);
  gl_FragColor = vec4(col, 1.0);
}
`

/* ---------------- 躺著的人 ---------------- */
export const figureVert = /* glsl */ `
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  vLocal = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const figureFrag = /* glsl */ `
${NOISE}
uniform vec3 uSunDir;
uniform vec3 uBase;
uniform vec3 uShade;
uniform vec3 uZima;
uniform vec3 uHeartPos;
uniform float uDissolve;
uniform float uHeart;
uniform float uHeartSpread;
uniform float uTime;
uniform vec3 uInk;
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  float n = fbm(vLocal * 5.0);
  // 由腳往頭的方向消散
  float d = n * 0.55 + (1.0 - clamp((vLocal.x + 1.0) / 1.9, 0.0, 1.0)) * 0.45;
  if (d < uDissolve) discard;

  // 剪影：近乎平塗的墨色，邊緣一道細微的逆光
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - clamp(dot(normalize(vN), viewDir), 0.0, 1.0), 4.0);
  float lit = smoothstep(0.55, 0.75, rim);
  // 沿身體方向的乾筆筆觸
  float stroke = fbm(vec3(vLocal.x * 2.5, vLocal.y * 38.0, vLocal.z * 38.0));
  vec3 col = uInk * (0.82 + stroke * 0.4);
  col = mix(col, uShade, lit * 0.35);

  // 胸口的悲傷：發光並沿身體擴散
  float hd = distance(vLocal, uHeartPos);
  float pulse = 0.7 + 0.3 * sin(uTime * 4.4);
  float glow = exp(-hd * 9.0) * uHeart * pulse;
  float spread = (1.0 - smoothstep(uHeartSpread - 0.18, uHeartSpread, hd + (n - 0.5) * 0.35)) * step(0.001, uHeartSpread);
  col = mix(col, mix(uZima * 0.55, uZima, lit), spread * 0.9);
  col += uZima * glow * 1.6;

  // 消散邊緣
  float edge = 1.0 - smoothstep(0.0, 0.035, d - uDissolve);
  col = mix(col, vec3(1.2), edge * step(0.001, uDissolve));
  gl_FragColor = vec4(col, 1.0);
}
`

/* ---------------- 浪花粒子 ---------------- */
export const foamVert = /* glsl */ `
attribute vec4 aRand;
uniform float uTime;
uniform float uStart;
uniform float uDur;
uniform float uBaseY;
uniform float uPixel;
varying float vLife;
void main() {
  float born = uStart + aRand.x * uDur;
  float age = uTime - born;
  float life = 3.5 + aRand.y * 2.5;
  vLife = clamp(age / life, 0.0, 1.0);
  if (age < 0.0 || age > life) {
    gl_PointSize = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 p = position;
  p.y += uBaseY;
  p.y += (0.25 + aRand.y * 0.6) * age - 0.07 * age * age;
  p.x += (aRand.z - 0.5) * 0.9 * age + 0.3 * age;
  p.z += (aRand.w - 0.5) * 0.9 * age;
  p.y += sin(age * 2.0 + aRand.x * 20.0) * 0.03;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPixel * (0.6 + aRand.w * 1.6) * (1.0 - vLife * 0.7) / -mv.z;
}
`

export const foamFrag = /* glsl */ `
uniform vec3 uZima;
varying float vLife;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.15, d) * (1.0 - vLife);
  vec3 col = mix(vec3(1.0), uZima, smoothstep(0.1, 0.8, vLife));
  gl_FragColor = vec4(col * a, a);
}
`

/* ---------------- 接觸陰影 ---------------- */
export const shadowFrag = /* glsl */ `
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec2 q = (vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.2, 1.0, length(q))) * uOpacity;
  gl_FragColor = vec4(vec3(0.25, 0.27, 0.3), a);
}
`

export const uvVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/* ---------------- 後製：顆粒、暗角、Zima 方框、淡入淡出 ---------------- */
export const PostShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uFade: { value: 0 },
    uFrame: { value: 0 },
    uAspect: { value: 16 / 9 },
    uGrain: { value: 0.045 },
    uPaper: { value: null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    ${NOISE}
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uFade;
    uniform float uFrame;
    uniform float uAspect;
    uniform float uGrain;
    uniform vec3 uPaper;
    varying vec2 vUv;
    float hash2(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec2 q = vUv - 0.5;
      q.x *= uAspect;

      // 手繪感：低頻紙紋
      float paper = fbm(vec3(vUv * vec2(uAspect, 1.0) * 6.0, 0.0));
      c *= 0.94 + paper * 0.12;

      // 筆觸：沿緩慢變化的方向拉長的雜訊，像畫布上的刷痕
      vec2 bp = vUv * vec2(uAspect, 1.0);
      float ang = 0.45 + (fbm(vec3(bp * 0.8, 7.0)) - 0.47) * 0.7;
      vec2 dir = vec2(cos(ang), sin(ang));
      vec2 r = vec2(dot(bp, dir), dot(bp, vec2(-dir.y, dir.x)));
      float stroke = fbm(vec3(r.x * 3.0, r.y * 120.0, 2.0)) * 0.65 + fbm(vec3(r.x * 9.0, r.y * 320.0, 5.0)) * 0.35;
      c *= 0.94 + stroke * 0.12;

      // 暗角
      float vig = smoothstep(1.05, 0.3, length(q * vec2(0.85, 1.0)));
      c *= mix(0.72, 1.0, vig);

      // Zima 的方框：畫面縮成一塊藍色方形
      float s = mix(1.3, 0.24, uFrame);
      float inside = (1.0 - smoothstep(s - 0.002, s, abs(q.x))) * (1.0 - smoothstep(s - 0.002, s, abs(q.y)));
      vec3 paperCol = uPaper * (0.97 + paper * 0.06);
      c = mix(paperCol, c, inside);

      // 底片顆粒
      float g = hash2(vUv * vec2(1931.0, 1087.0) + fract(uTime * 7.13) * 91.7) - 0.5;
      c += g * uGrain;

      c *= uFade;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
}
