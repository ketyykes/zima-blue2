import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { numTrack, colorTrack, cameraTrack, clamp01 } from './timeline.js'
import { DURATION, scheduleScore, renderScoreWav } from './audio.js'
import {
  skyVert,
  skyFrag,
  waterVert,
  waterFrag,
  figureVert,
  figureFrag,
  foamVert,
  foamFrag,
  shadowFrag,
  uvVert,
  PostShader,
} from './shaders.js'

const params = new URLSearchParams(location.search)
const RENDER_MODE = params.has('render')
const START_OFFSET = Number(params.get('t') ?? 0)

/* ================= 色彩 ================= */
const ZIMA = new THREE.Color('#12a5de')
const ZIMA_LIGHT = new THREE.Color('#6fd0f2')
const DEEP = new THREE.Color('#0a4f7c')
const PAPER = new THREE.Color('#f1ede4')

/* ================= 基本設定 ================= */
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('stage'))
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: RENDER_MODE })
renderer.setPixelRatio(RENDER_MODE ? 1 : Math.min(window.devicePixelRatio, 2))

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(0xffffff, 25, 95)
const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.05, 1200)

const sunDir = new THREE.Vector3()

/* ================= 天空 ================= */
const skyUniforms = {
  uTop: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uSunColor: { value: new THREE.Color('#fff4e2') },
  uSunDir: { value: sunDir },
  uSunSize: { value: 0.9993 },
}
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(800, 48, 24),
  new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
  }),
)
sky.renderOrder = -1
scene.add(sky)

/* ================= 地面 / 海 ================= */
const waterGeometry = new THREE.PlaneGeometry(320, 320, 480, 480)
waterGeometry.rotateX(-Math.PI / 2)
const waterUniforms = {
  uTime: { value: 0 },
  uSpread: { value: 0 },
  uWaveAmp: { value: 0 },
  uRippleAmp: { value: 0 },
  uCenter: { value: new THREE.Vector2(-0.5, 0) },
  uSunDir: { value: sunDir },
  uFloor: { value: new THREE.Color('#ebe6dc') },
  uFloorLine: { value: new THREE.Color('#c9c4ba') },
  uZima: { value: ZIMA },
  uZimaLight: { value: ZIMA_LIGHT },
  uDeep: { value: DEEP },
  uFog: { value: new THREE.Color() },
  uFogNear: { value: 25 },
  uFogFar: { value: 95 },
}
const water = new THREE.Mesh(
  waterGeometry,
  new THREE.ShaderMaterial({ vertexShader: waterVert, fragmentShader: waterFrag, uniforms: waterUniforms }),
)
scene.add(water)

/**
 * JS 版海浪高度，供方舟漂浮使用（與 shader 中 waves() 相同）
 * @param {number} x
 * @param {number} z
 * @param {number} t
 * @returns {number}
 */
function waveHeight(x, z, t) {
  let h = 0
  h += Math.sin(x * 0.35 + t * 0.9) * 0.32
  h += Math.sin(z * 0.5 - t * 1.1 + x * 0.2) * 0.2
  h += Math.sin((x + z) * 0.9 + t * 1.7) * 0.08
  h += Math.sin(x * 1.7 - z * 1.3 + t * 2.3) * 0.04
  return h
}

/* ================= 躺著的人 ================= */
/**
 * 以膠囊與球體拼出一個仰躺的人形（頭朝 -x）
 * @returns {THREE.BufferGeometry}
 */
function buildFigureGeometry() {
  const parts = []
  /**
   * @param {THREE.BufferGeometry} geo
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {boolean} [horizontal]
   */
  const add = (geo, x, y, z, horizontal = true) => {
    if (horizontal) geo.rotateZ(Math.PI / 2)
    geo.translate(x, y, z)
    parts.push(geo)
  }
  add(new THREE.SphereGeometry(0.12, 32, 24), -0.86, 0.13, 0, false) // 頭
  add(new THREE.CapsuleGeometry(0.05, 0.08, 8, 16), -0.73, 0.12, 0) // 頸
  add(new THREE.CapsuleGeometry(0.15, 0.42, 12, 32), -0.36, 0.15, 0) // 軀幹
  add(new THREE.CapsuleGeometry(0.075, 0.74, 8, 24), 0.44, 0.08, 0.085) // 腿
  add(new THREE.CapsuleGeometry(0.075, 0.74, 8, 24), 0.44, 0.08, -0.085)
  add(new THREE.CapsuleGeometry(0.05, 0.5, 8, 16), -0.27, 0.06, 0.215) // 手
  add(new THREE.CapsuleGeometry(0.05, 0.5, 8, 16), -0.27, 0.06, -0.215)
  add(new THREE.SphereGeometry(0.06, 16, 12), 0.88, 0.1, 0.085, false) // 腳
  add(new THREE.SphereGeometry(0.06, 16, 12), 0.88, 0.1, -0.085, false)
  const nonIndexed = parts.map((g) => (g.index ? g.toNonIndexed() : g))
  return mergeGeometries(nonIndexed)
}

const HEART_LOCAL = new THREE.Vector3(-0.48, 0.27, 0.05)
const figureGeometry = buildFigureGeometry()
const figureUniforms = {
  uSunDir: { value: sunDir },
  uBase: { value: new THREE.Color('#e4ddd2') },
  uShade: { value: new THREE.Color('#a9adb3') },
  uInk: { value: new THREE.Color('#1c2733') },
  uZima: { value: ZIMA },
  uHeartPos: { value: HEART_LOCAL },
  uDissolve: { value: 0 },
  uHeart: { value: 0 },
  uHeartSpread: { value: 0 },
  uTime: { value: 0 },
}
const figure = new THREE.Group()
const figureMesh = new THREE.Mesh(
  figureGeometry,
  new THREE.ShaderMaterial({ vertexShader: figureVert, fragmentShader: figureFrag, uniforms: figureUniforms }),
)
figure.add(figureMesh)
scene.add(figure)

// 胸口的光
const glowTexture = (() => {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
})()
const heartGlow = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: glowTexture,
    color: ZIMA_LIGHT,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0,
  }),
)
heartGlow.position.copy(HEART_LOCAL).add(new THREE.Vector3(0, 0.03, 0))
figure.add(heartGlow)

// 接觸陰影
const shadowUniforms = { uOpacity: { value: 0.55 } }
const contactShadow = new THREE.Mesh(
  new THREE.PlaneGeometry(2.3, 0.75),
  new THREE.ShaderMaterial({
    vertexShader: uvVert,
    fragmentShader: shadowFrag,
    uniforms: shadowUniforms,
    transparent: true,
    depthWrite: false,
  }),
)
contactShadow.rotation.x = -Math.PI / 2
contactShadow.position.set(-0.02, 0.003, 0)
scene.add(contactShadow)

/* ================= 浪花粒子 ================= */
const FOAM_COUNT = 9000
const foamPositions = new Float32Array(FOAM_COUNT * 3)
const foamRand = new Float32Array(FOAM_COUNT * 4)
{
  const src = figureGeometry.attributes.position
  for (let i = 0; i < FOAM_COUNT; i++) {
    const v = Math.floor(Math.random() * src.count)
    foamPositions[i * 3] = src.getX(v)
    foamPositions[i * 3 + 1] = src.getY(v)
    foamPositions[i * 3 + 2] = src.getZ(v)
    // 讓腳先化為浪花，頭最後
    const headness = clamp01((0.9 - src.getX(v)) / 1.9)
    foamRand[i * 4] = clamp01(headness * 0.7 + Math.random() * 0.3)
    foamRand[i * 4 + 1] = Math.random()
    foamRand[i * 4 + 2] = Math.random()
    foamRand[i * 4 + 3] = Math.random()
  }
}
const foamGeometry = new THREE.BufferGeometry()
foamGeometry.setAttribute('position', new THREE.BufferAttribute(foamPositions, 3))
foamGeometry.setAttribute('aRand', new THREE.BufferAttribute(foamRand, 4))
const foamUniforms = {
  uTime: { value: 0 },
  uStart: { value: 38.5 },
  uDur: { value: 7.5 },
  uBaseY: { value: 0 },
  uPixel: { value: 40 },
  uZima: { value: ZIMA_LIGHT },
}
const foam = new THREE.Points(
  foamGeometry,
  new THREE.ShaderMaterial({
    vertexShader: foamVert,
    fragmentShader: foamFrag,
    uniforms: foamUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }),
)
foam.frustumCulled = false
scene.add(foam)

/* ================= 方舟 ================= */
const ark = new THREE.Group()
{
  const hull = new THREE.Shape()
  hull.moveTo(-2.4, 0.5)
  hull.lineTo(2.6, 0.5)
  hull.lineTo(1.8, -0.35)
  hull.lineTo(-1.9, -0.35)
  hull.closePath()
  const hullGeo = new THREE.ExtrudeGeometry(hull, { depth: 1.2, bevelEnabled: false })
  hullGeo.translate(0, 0, -0.6)
  const arkMaterial = new THREE.MeshBasicMaterial({ color: '#163650' })
  ark.add(new THREE.Mesh(hullGeo, arkMaterial))
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 0.9), arkMaterial)
  cabin.position.set(-0.2, 0.85, 0)
  ark.add(cabin)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 1.1), arkMaterial)
  roof.position.set(-0.2, 1.24, 0)
  ark.add(roof)
}
ark.position.set(-9, 0, -46)
ark.rotation.y = 0.25
ark.visible = false
scene.add(ark)

/* ================= 後製 ================= */
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(new THREE.Vector2(1920, 1080), 0.22, 0.5, 0.97)
composer.addPass(bloom)
PostShader.uniforms.uPaper.value = PAPER
const post = new ShaderPass(PostShader)
composer.addPass(post)
composer.addPass(new OutputPass())

/* ================= 時間軸 ================= */
const camTrack = cameraTrack([
  { t: 0, pos: [0.4, 0.8, 7.2], target: [-0.2, 0.25, 0] },
  { t: 8, pos: [0.0, 0.7, 4.6], target: [-0.1, 0.2, 0] },
  { t: 16, pos: [2.3, 1.0, 3.2], target: [-0.2, 0.2, 0] },
  { t: 24, pos: [1.3, 2.0, 2.2], target: [-0.45, 0.2, 0] },
  { t: 32, pos: [-0.3, 2.6, 2.1], target: [-0.45, 0.1, 0] },
  { t: 40, pos: [0.0, 1.9, 5.2], target: [0, 0, 0] },
  { t: 48, pos: [0.0, 2.1, 9.0], target: [0, 0.8, -40] },
  { t: 54, pos: [0.0, 2.8, 11.0], target: [0, 0.5, -40] },
  { t: 60, pos: [0.0, 22.0, 0.6], target: [0, 0, 0] },
])

const skyTop = colorTrack([
  [0, '#c7d2d6'],
  [12, '#c2ccd1'],
  [22, '#8d99a2'],
  [30, '#3a5a75'],
  [40, '#0f4468'],
  [50, '#0d4266'],
  [55, '#9fb7c2'],
  [58, '#e4ebed'],
])
const skyHorizon = colorTrack([
  [0, '#efe3d1'],
  [12, '#f0d9c2'],
  [22, '#c8c3bb'],
  [30, '#a7bac8'],
  [40, '#86c6dd'],
  [50, '#a5d8e7'],
  [58, '#f3efe7'],
])
const sunElevation = numTrack([
  [0, 7],
  [20, 4],
  [30, 14],
  [45, 24],
  [52, 30],
  [60, 72],
])
const sunAzimuth = numTrack([
  [0, -0.75],
  [30, -0.5],
  [60, -0.2],
])

const fade = numTrack([
  [0, 0],
  [2.5, 0],
  [6, 1],
  [59.2, 1],
  [60, 0],
])
const frameAmount = numTrack([
  [55.5, 0],
  [59, 1],
])
const spread = numTrack([
  [29, 0],
  [34, 2.6],
  [38, 7],
  [42, 220],
])
const waveAmp = numTrack([
  [33, 0],
  [38, 0.25],
  [43, 1],
  [50, 1.15],
  [55, 0.6],
  [60, 0.06],
])
const rippleAmp = numTrack([
  [28, 0],
  [31, 0.035],
  [36, 0.07],
  [42, 0],
])
const heart = numTrack([
  [26.5, 0],
  [29.5, 1],
  [38, 1],
  [42, 0],
])
const heartSpread = numTrack([
  [30, 0],
  [36.5, 1.6],
])
const sinkY = numTrack([
  [36, 0],
  [40, -0.22],
  [46, -0.75],
])
const dissolve = numTrack([
  [38.5, 0],
  [46, 1.05],
])

/** @type {Array<{ start: number, end: number, html: string, tone: 'light' | 'dark', title?: boolean }>} */
const CUES = [
  { start: 0.6, end: 5.4, html: '浪<small>在躺著的人，陷下去變成浪花</small>', tone: 'light', title: true },
  { start: 7.0, end: 12.6, html: '終其一生，我都在想著初見的光景。', tone: 'dark' },
  { start: 16.6, end: 21.4, html: '我無法忘記就在那天凌晨，', tone: 'dark' },
  { start: 21.6, end: 26.4, html: '妳逐漸衰弱與枯槁的模樣，在最後遺落了時間。', tone: 'dark' },
  { start: 27.0, end: 31.6, html: '原來悲傷是實際存在的，', tone: 'dark' },
  { start: 31.8, end: 36.4, html: '懸浮在那裡，胸口靠近心臟的位置。', tone: 'light' },
  { start: 37.2, end: 41.6, html: '我會不會在成為浪的時候，', tone: 'light' },
  { start: 41.8, end: 46.2, html: '離你比較近。', tone: 'light' },
  { start: 47.0, end: 50.8, html: '祈禱哪一天我將漂流到你踐踏的浪花，', tone: 'light' },
  { start: 51.0, end: 54.8, html: '或是渡你曾經搭載的方舟。', tone: 'light' },
  { start: 55.6, end: 59.2, html: '隨波逐流，是最好的解套。', tone: 'dark' },
]
const captionLayer = /** @type {HTMLElement} */ (document.getElementById('captions'))
const cueElements = CUES.map((cue) => {
  const el = document.createElement('div')
  el.className = `cue ${cue.tone}${cue.title ? ' title' : ''}`
  el.innerHTML = cue.html
  captionLayer.appendChild(el)
  return el
})

/**
 * 依時間更新字幕透明度（以程式計算，確保逐格算圖結果一致）
 * @param {number} t
 */
function updateCaptions(t) {
  const fadeTime = 0.9
  CUES.forEach((cue, i) => {
    const fadeIn = clamp01((t - cue.start) / fadeTime)
    const fadeOut = clamp01((cue.end - t) / fadeTime)
    const a = Math.min(fadeIn, fadeOut)
    const el = cueElements[i]
    el.style.opacity = String(a)
    el.style.filter = `blur(${((1 - a) * 6).toFixed(2)}px)`
  })
}

/* ================= 每格更新 ================= */
/**
 * 將整個場景設定到時間 t（秒）
 * @param {number} t
 */
function update(t) {
  // 光線與天空
  const el = THREE.MathUtils.degToRad(sunElevation(t))
  const az = sunAzimuth(t)
  sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize()
  skyTop(t, skyUniforms.uTop.value)
  skyHorizon(t, skyUniforms.uHorizon.value)
  scene.fog.color.copy(skyUniforms.uHorizon.value)
  waterUniforms.uFog.value.copy(skyUniforms.uHorizon.value)

  // 地面化為海
  waterUniforms.uTime.value = t
  waterUniforms.uSpread.value = spread(t)
  waterUniforms.uWaveAmp.value = waveAmp(t)
  waterUniforms.uRippleAmp.value = rippleAmp(t)

  // 人：悲傷、下沉、消散
  const heartValue = heart(t)
  figureUniforms.uTime.value = t
  figureUniforms.uHeart.value = heartValue
  figureUniforms.uHeartSpread.value = heartSpread(t)
  figureUniforms.uDissolve.value = dissolve(t)
  figure.position.y = sinkY(t)
  figure.rotation.z = sinkY(t) * 0.12
  figure.visible = dissolve(t) < 1.0
  const pulse = 0.85 + 0.15 * Math.sin(t * 4.4)
  heartGlow.material.opacity = heartValue * 0.9
  heartGlow.scale.setScalar(0.55 * pulse * (0.6 + heartValue * 0.4))
  shadowUniforms.uOpacity.value = 0.55 * (1 - clamp01(spread(t) / 1.2))

  foamUniforms.uTime.value = t
  foamUniforms.uBaseY.value = figure.position.y

  // 方舟
  ark.visible = t > 42 && t < 58
  if (ark.visible) {
    const amp = waveAmp(t)
    ark.position.x = -9 + (t - 42) * 0.25
    ark.position.y = waveHeight(ark.position.x, ark.position.z, t) * amp - 0.15
    ark.rotation.z = Math.sin(t * 0.9) * 0.05 * amp
  }

  camTrack(t, camera)

  // 後製
  post.uniforms.uTime.value = t
  post.uniforms.uFade.value = fade(t)
  post.uniforms.uFrame.value = frameAmount(t)

  updateCaptions(t)
}

/* ================= 尺寸 ================= */
function resize() {
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setSize(w, h, false)
  composer.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  post.uniforms.uAspect.value = w / h
  foamUniforms.uPixel.value = 42 * renderer.getPixelRatio() * (h / 1080)
}
window.addEventListener('resize', resize)
resize()

/**
 * 繪製某一時間點的畫面
 * @param {number} t
 */
function renderAt(t) {
  update(Math.min(Math.max(t, 0), DURATION))
  composer.render()
}

/* ================= 播放 / 算圖 ================= */
const startButton = /** @type {HTMLButtonElement} */ (document.getElementById('start'))

if (RENDER_MODE) {
  startButton.remove()
  // 供 scripts/render.mjs 逐格呼叫
  window.__renderFrame = (t) => renderAt(t)
  window.__renderAudio = async () => {
    const wav = await renderScoreWav()
    const bytes = new Uint8Array(wav)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return btoa(binary)
  }
  renderAt(0)
  window.__ready = true
} else {
  renderAt(START_OFFSET)

  /** @type {AudioContext | null} */
  let audioCtx = null
  let clockStart = 0

  const play = async () => {
    startButton.classList.add('hidden')
    audioCtx?.close()
    audioCtx = new AudioContext()
    await audioCtx.resume()
    clockStart = audioCtx.currentTime - START_OFFSET
    scheduleScore(audioCtx, audioCtx.destination, clockStart)

    const tick = () => {
      const t = audioCtx.currentTime - clockStart
      renderAt(t)
      if (t < DURATION) {
        requestAnimationFrame(tick)
      } else {
        startButton.querySelector('.start-hint').textContent = '再看一次'
        startButton.classList.remove('hidden')
      }
    }
    requestAnimationFrame(tick)
  }
  startButton.addEventListener('click', play)
}
