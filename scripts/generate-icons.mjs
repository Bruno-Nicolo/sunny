import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = join(root, 'resources/branding/sunny-solid.png')
const temporary = mkdtempSync(join(tmpdir(), 'sunny-icons-'))
const iconset = join(temporary, 'Sunny.iconset')

try {
  mkdirSync(iconset)
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = size * scale
      const filename = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`
      execFileSync(
        'sips',
        ['-z', String(pixels), String(pixels), source, '--out', join(iconset, filename)],
        { stdio: 'ignore' }
      )
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(root, 'build/icon.icns')])
  copyFileSync(join(iconset, 'icon_512x512@2x.png'), join(root, 'build/icon.png'))
  copyFileSync(join(root, 'build/icon.png'), join(root, 'resources/icon.png'))
  execFileSync(
    'sips',
    [
      '-s',
      'format',
      'ico',
      join(iconset, 'icon_256x256.png'),
      '--out',
      join(root, 'build/icon.ico')
    ],
    { stdio: 'ignore' }
  )
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
