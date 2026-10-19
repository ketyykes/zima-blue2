/**
 * 逐格算圖並輸出 mp4：
 *   pnpm render                 → out/nami.mp4（1920x1080、30fps）
 *   pnpm render --fps 24 --scale 0.5
 *   pnpm render --stills 3,20,33,44,50,59   → 只輸出指定秒數的靜態截圖
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { parseArgs } from 'node:util'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'

const { values } = parseArgs({
  options: {
    fps: { type: 'string', default: '30' },
    scale: { type: 'string', default: '1' },
    stills: { type: 'string' },
    chrome: { type: 'string', default: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
  },
})

const DURATION = 60
const FPS = Number(values.fps)
const WIDTH = Math.round(1920 * Number(values.scale))
const HEIGHT = Math.round(1080 * Number(values.scale))
const OUT_DIR = new URL('../out/', import.meta.url).pathname

await mkdir(OUT_DIR, { recursive: true })

const server = await createServer({ logLevel: 'error', server: { port: 5199, strictPort: false } })
await server.listen()
const url = server.resolvedUrls.local[0]

const browser = await puppeteer.launch({
  executablePath: values.chrome,
  headless: true,
  args: ['--hide-scrollbars', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
})

try {
  const page = await browser.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warn') console.log('[page]', msg.text())
  })
  page.on('pageerror', (err) => console.error('[page error]', err))
  await page.goto(`${url}?render=1`, { waitUntil: 'load' })
  await page.waitForFunction('window.__ready === true', { timeout: 60000 })
  await page.evaluate(() => document.fonts.ready)

  if (values.stills) {
    for (const s of values.stills.split(',').map(Number)) {
      await page.evaluate((t) => window.__renderFrame(t), s)
      const file = `${OUT_DIR}still-${String(s).padStart(2, '0')}.jpg`
      await page.screenshot({ path: file, type: 'jpeg', quality: 90 })
      console.log('寫入', file)
    }
  } else {
    console.log('算出配樂…')
    const b64 = await page.evaluate(() => window.__renderAudio())
    const wavPath = `${OUT_DIR}score.wav`
    await writeFile(wavPath, Buffer.from(b64, 'base64'))

    const mp4Path = `${OUT_DIR}nami.mp4`
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-y', '-loglevel', 'error',
        '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
        '-i', wavPath,
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart',
        mp4Path,
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    )

    const total = DURATION * FPS
    const started = Date.now()
    for (let i = 0; i < total; i++) {
      await page.evaluate((t) => window.__renderFrame(t), i / FPS)
      const frame = await page.screenshot({ type: 'jpeg', quality: 95 })
      if (!ffmpeg.stdin.write(frame)) await once(ffmpeg.stdin, 'drain')
      if (i % FPS === 0) {
        const elapsed = (Date.now() - started) / 1000
        const eta = (elapsed / (i + 1)) * (total - i - 1)
        process.stdout.write(`\r影格 ${i}/${total}，剩餘約 ${eta.toFixed(0)} 秒   `)
      }
    }
    ffmpeg.stdin.end()
    await once(ffmpeg, 'close')
    console.log(`\n完成：${mp4Path}`)
  }
} finally {
  await browser.close()
  await server.close()
}
