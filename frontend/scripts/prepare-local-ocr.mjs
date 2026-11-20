import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = join(frontendRoot, 'public', 'tesseract')
const coreRoot = join(frontendRoot, 'node_modules', 'tesseract.js-core')
const coreFiles = [
  'tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-lstm.wasm',
]

mkdirSync(join(publicRoot, 'core'), { recursive: true })
copyFileSync(
  join(frontendRoot, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'),
  join(publicRoot, 'worker.min.js'),
)
copyFileSync(join(frontendRoot, 'spa.traineddata'), join(publicRoot, 'spa.traineddata'))

for (const filename of coreFiles) {
  copyFileSync(join(coreRoot, filename), join(publicRoot, 'core', filename))
}
