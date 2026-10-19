import * as THREE from 'three'

/**
 * 平滑緩動（easeInOutSine）
 * @param {number} x 0~1
 * @returns {number}
 */
export function ease(x) {
  return -(Math.cos(Math.PI * x) - 1) / 2
}

/**
 * 夾限在 0~1
 * @param {number} x
 * @returns {number}
 */
export function clamp01(x) {
  return Math.min(1, Math.max(0, x))
}

/**
 * 找出時間 t 所在的關鍵影格區段
 * @param {Array<[number, any]>} keys 依時間排序的關鍵影格
 * @param {number} t
 * @returns {{ a: [number, any], b: [number, any], k: number }}
 */
function locate(keys, t) {
  if (t <= keys[0][0]) {
    return { a: keys[0], b: keys[0], k: 0 }
  }
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t <= b[0]) {
      return { a, b, k: ease(clamp01((t - a[0]) / (b[0] - a[0]))) }
    }
  }
  const last = keys[keys.length - 1]
  return { a: last, b: last, k: 0 }
}

/**
 * 建立數值軌道
 * @param {Array<[number, number]>} keys
 * @returns {(t: number) => number}
 */
export function numTrack(keys) {
  return (t) => {
    const { a, b, k } = locate(keys, t)
    return a[1] + (b[1] - a[1]) * k
  }
}

/**
 * 建立顏色軌道（在線性色彩空間內插值）
 * @param {Array<[number, string]>} keys
 * @returns {(t: number, target: THREE.Color) => THREE.Color}
 */
export function colorTrack(keys) {
  const colorKeys = keys.map(([time, hex]) => [time, new THREE.Color(hex)])
  return (t, target) => {
    const { a, b, k } = locate(colorKeys, t)
    return target.copy(a[1]).lerp(b[1], k)
  }
}

/**
 * 建立攝影機路徑：以 Catmull-Rom 曲線串接關鍵點，時間以分段線性對應到曲線參數
 * @param {Array<{ t: number, pos: number[], target: number[] }>} keys
 * @returns {(t: number, cam: THREE.PerspectiveCamera) => void}
 */
export function cameraTrack(keys) {
  const posCurve = new THREE.CatmullRomCurve3(
    keys.map((key) => new THREE.Vector3(...key.pos)),
    false,
    'centripetal',
  )
  const targetCurve = new THREE.CatmullRomCurve3(
    keys.map((key) => new THREE.Vector3(...key.target)),
    false,
    'centripetal',
  )
  const segments = keys.length - 1
  const tmpTarget = new THREE.Vector3()

  return (t, cam) => {
    let u = 0
    if (t >= keys[segments].t) {
      u = 1
    } else if (t > keys[0].t) {
      for (let i = 0; i < segments; i++) {
        if (t <= keys[i + 1].t) {
          const local = (t - keys[i].t) / (keys[i + 1].t - keys[i].t)
          u = (i + local) / segments
          break
        }
      }
    }
    posCurve.getPoint(u, cam.position)
    targetCurve.getPoint(u, tmpTarget)
    // 手持般的微幅漂移
    cam.position.x += Math.sin(t * 0.37) * 0.04
    cam.position.y += Math.sin(t * 0.53 + 1.3) * 0.025
    cam.lookAt(tmpTarget)
  }
}
