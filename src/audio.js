/**
 * 生成式配樂：環境長音、心跳、海浪噪音與鐘聲。
 * 同一份編排同時供即時播放（AudioContext）與離線算圖（OfflineAudioContext）使用。
 */

export const DURATION = 60

/**
 * 產生簡易殘響脈衝
 * @param {BaseAudioContext} ctx
 * @param {number} seconds
 * @returns {AudioBuffer}
 */
function makeImpulse(ctx, seconds) {
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2)
    }
  }
  return buffer
}

/**
 * 產生粉紅噪音（海浪基底）
 * @param {BaseAudioContext} ctx
 * @param {number} seconds
 * @returns {AudioBuffer}
 */
function makeNoise(ctx, seconds) {
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    let b0 = 0
    let b1 = 0
    let b2 = 0
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      b0 = 0.99765 * b0 + white * 0.099046
      b1 = 0.963 * b1 + white * 0.2965164
      b2 = 0.57 * b2 + white * 1.0526913
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.12
    }
  }
  return buffer
}

/**
 * 和弦段落：每段一組長音，前後交叉淡入淡出
 * @type {Array<{ start: number, end: number, notes: number[] }>}
 */
const CHORDS = [
  { start: 0, end: 16, notes: [110, 164.81, 220, 329.63] }, // Am
  { start: 14, end: 27, notes: [87.31, 130.81, 220, 261.63] }, // F
  { start: 25, end: 38, notes: [73.42, 110, 174.61, 220] }, // Dm
  { start: 36, end: 48, notes: [110, 164.81, 246.94, 329.63] }, // Asus2
  { start: 46, end: 56, notes: [65.41, 98, 164.81, 329.63] }, // C
  { start: 54, end: 60, notes: [110, 164.81, 220, 329.63, 493.88] }, // Am(add9)
]

/**
 * 依 60 秒的時間軸排程所有聲音
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} destination
 * @param {number} t0 影片 0 秒對應的 context 時間
 */
export function scheduleScore(ctx, destination, t0) {
  const at = (s) => Math.max(ctx.currentTime, t0 + s)

  const master = ctx.createGain()
  master.gain.setValueAtTime(0, at(0))
  master.gain.linearRampToValueAtTime(0.9, at(3))
  master.gain.setValueAtTime(0.9, at(56.5))
  master.gain.linearRampToValueAtTime(0, at(DURATION))
  master.connect(destination)

  const reverb = ctx.createConvolver()
  reverb.buffer = makeImpulse(ctx, 4.5)
  const wet = ctx.createGain()
  wet.gain.value = 0.55
  reverb.connect(wet).connect(master)
  const dry = ctx.createGain()
  dry.gain.value = 0.6
  dry.connect(master)

  // 長音
  const padFilter = ctx.createBiquadFilter()
  padFilter.type = 'lowpass'
  padFilter.Q.value = 0.4
  padFilter.frequency.setValueAtTime(500, at(0))
  padFilter.frequency.linearRampToValueAtTime(900, at(14))
  padFilter.frequency.linearRampToValueAtTime(420, at(28))
  padFilter.frequency.linearRampToValueAtTime(1400, at(44))
  padFilter.frequency.linearRampToValueAtTime(700, at(60))
  padFilter.connect(dry)
  padFilter.connect(reverb)

  for (const chord of CHORDS) {
    const env = ctx.createGain()
    env.gain.setValueAtTime(0, at(chord.start))
    env.gain.linearRampToValueAtTime(0.05, at(chord.start + 2.5))
    env.gain.setValueAtTime(0.05, at(chord.end - 2.5))
    env.gain.linearRampToValueAtTime(0, at(chord.end))
    env.connect(padFilter)
    for (const freq of chord.notes) {
      for (const detune of [-7, 6]) {
        const osc = ctx.createOscillator()
        osc.type = freq < 100 ? 'sine' : 'triangle'
        osc.frequency.value = freq
        osc.detune.value = detune
        osc.connect(env)
        osc.start(at(chord.start))
        osc.stop(at(chord.end) + 0.1)
      }
    }
  }

  // 心跳：悲傷懸浮在胸口
  for (let s = 27.5; s < 37; s += 1.15) {
    for (const [offset, level] of [[0, 0.5], [0.24, 0.32]]) {
      const start = at(s + offset)
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(70, start)
      osc.frequency.exponentialRampToValueAtTime(38, start + 0.25)
      g.gain.setValueAtTime(0, start)
      g.gain.linearRampToValueAtTime(level, start + 0.015)
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.4)
      osc.connect(g)
      g.connect(dry)
      osc.start(start)
      osc.stop(start + 0.45)
    }
  }

  // 海浪：粉紅噪音 + 低通，音量隨浪起伏
  const noise = ctx.createBufferSource()
  noise.buffer = makeNoise(ctx, 8)
  noise.loop = true
  const noiseFilter = ctx.createBiquadFilter()
  noiseFilter.type = 'lowpass'
  noiseFilter.frequency.value = 650
  const noiseGain = ctx.createGain()
  const curveStart = 28
  const curveLength = DURATION - curveStart
  const curve = new Float32Array(curveLength * 20)
  for (let i = 0; i < curve.length; i++) {
    const s = curveStart + i / 20
    const presence = Math.min(1, Math.max(0, (s - 30) / 10)) * Math.min(1, Math.max(0, (60 - s) / 8))
    const swell = 0.55 + 0.45 * Math.sin(s * 0.9) * Math.sin(s * 0.37 + 1)
    curve[i] = 0.9 * presence * swell
  }
  noiseGain.gain.value = 0
  // 若從中途開始播放（?t=），把已經過去的曲線切掉
  const skipped = Math.max(0, ctx.currentTime - (t0 + curveStart))
  const skipIndex = Math.min(curve.length - 2, Math.floor(skipped * 20))
  noiseGain.gain.setValueCurveAtTime(
    curve.subarray(skipIndex),
    t0 + curveStart + skipIndex / 20,
    curveLength - skipIndex / 20 - 0.05,
  )
  noise.connect(noiseFilter).connect(noiseGain)
  noiseGain.connect(dry)
  noiseGain.connect(reverb)
  noise.start(at(0))
  noise.stop(at(DURATION))

  // 鐘聲
  const bells = [
    [1.0, 659.25],
    [7.0, 880],
    [17.0, 587.33],
    [37.0, 987.77],
    [47.0, 783.99],
    [55.0, 880],
    [55.6, 1318.5],
  ]
  for (const [s, freq] of bells) {
    const start = at(s)
    for (const [ratio, level] of [[1, 0.09], [2.01, 0.03], [3.03, 0.015]]) {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq * ratio
      g.gain.setValueAtTime(0, start)
      g.gain.linearRampToValueAtTime(level, start + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0005, start + 4.5 / ratio)
      osc.connect(g)
      g.connect(reverb)
      g.connect(dry)
      osc.start(start)
      osc.stop(start + 5)
    }
  }
}

/**
 * 離線算出整段配樂並編碼成 WAV
 * @returns {Promise<ArrayBuffer>}
 */
export async function renderScoreWav() {
  const sampleRate = 48000
  const ctx = new OfflineAudioContext(2, sampleRate * DURATION, sampleRate)
  scheduleScore(ctx, ctx.destination, 0)
  const buffer = await ctx.startRendering()
  return encodeWav(buffer)
}

/**
 * 將 AudioBuffer 編碼為 16-bit PCM WAV
 * @param {AudioBuffer} buffer
 * @returns {ArrayBuffer}
 */
function encodeWav(buffer) {
  const channels = buffer.numberOfChannels
  const frames = buffer.length
  const dataSize = frames * channels * 2
  const out = new ArrayBuffer(44 + dataSize)
  const view = new DataView(out)
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  const data = []
  for (let ch = 0; ch < channels; ch++) data.push(buffer.getChannelData(ch))
  let offset = 44
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const s = Math.max(-1, Math.min(1, data[ch][i]))
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      offset += 2
    }
  }
  return out
}
