import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function moduleUrl(name, imports = {}) {
  let source = await readFile(new URL(`../../src/main/${name}.ts`, import.meta.url), 'utf8')
  for (const [name, url] of Object.entries(imports))
    source = source.replaceAll(`'${name}'`, JSON.stringify(url))
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  })
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
}
const url = await moduleUrl('signatures', { './atomic-write': await moduleUrl('atomic-write') })
export const { createSignatureStore } = await import(url)
