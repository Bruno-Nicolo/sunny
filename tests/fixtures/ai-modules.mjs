import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'

export function aiModules() {
  const root = path.resolve(import.meta.dirname, '../..')
  fs.mkdirSync(path.join(root, 'out'), { recursive: true })
  const directory = fs.mkdtempSync(path.join(root, 'out', 'ai-test-'))
  for (const relative of ['src/main/ai', 'src/shared']) {
    fs.mkdirSync(path.join(directory, relative), { recursive: true })
    for (const file of fs
      .readdirSync(path.join(root, relative))
      .filter((file) => file.endsWith('.ts'))) {
      const source = fs.readFileSync(path.join(root, relative, file), 'utf8')
      const { outputText } = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true
        }
      })
      fs.writeFileSync(path.join(directory, relative, file.replace(/\.ts$/, '.js')), outputText)
    }
  }
  const require = createRequire(import.meta.url)
  return {
    load(name) {
      return require(path.join(directory, 'src/main/ai', `${name}.js`))
    },
    dispose() {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
}
