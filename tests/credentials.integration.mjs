import electron from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { aiModules } from './fixtures/ai-modules.mjs'

const { app, safeStorage } = electron
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lepis-credentials-'))
app.setPath('userData', directory)
const modules = aiModules()
const { CredentialStore } = modules.load('credentials')
const platform = Object.getOwnPropertyDescriptor(process, 'platform')
const original = {
  isEncryptionAvailable: safeStorage.isEncryptionAvailable,
  encryptString: safeStorage.encryptString,
  decryptString: safeStorage.decryptString,
  getSelectedStorageBackend: safeStorage.getSelectedStorageBackend
}

app
  .whenReady()
  .then(async () => {
    // Isolate the platform guard from Keychain access; all stored values are test fixtures.
    safeStorage.isEncryptionAvailable = () => true
    safeStorage.encryptString = (text) => Buffer.from(`fixture:${text}`)
    safeStorage.decryptString = (data) => data.toString().slice('fixture:'.length)
    if (process.platform === 'darwin')
      assert.equal(typeof safeStorage.getSelectedStorageBackend, 'undefined')
    const store = new CredentialStore(path.join(directory, 'secure'))
    const credentials = await store.load()
    await store.update(() => {})
    const reopened = new CredentialStore(path.join(directory, 'secure'))
    assert.equal((await reopened.load()).hostId, credentials.hostId)
    assert.equal(fs.statSync(path.join(directory, 'secure/credentials.enc')).mode & 0o777, 0o600)
    console.log('PASS: credential persistence works with the real macOS safeStorage API shape')

    await Promise.all([
      store.update((value) => {
        value.keys.openai = 'fixture-openai'
      }),
      store.update((value) => {
        value.keys.google = 'fixture-google'
      })
    ])
    assert.deepEqual((await new CredentialStore(path.join(directory, 'secure')).load()).keys, {
      openai: 'fixture-openai',
      google: 'fixture-google'
    })
    const blocked = path.join(directory, 'secure/credentials.enc.tmp')
    fs.mkdirSync(blocked)
    await assert.rejects(
      store.update((value) => {
        value.keys.openai = 'unsaved-fixture'
      })
    )
    assert.ok(
      (await store.load()).keys.openai === 'fixture-openai',
      'failed writes must not publish credentials'
    )
    fs.rmdirSync(blocked)
    await store.update((value) => {
      value.keys.openai = 'saved-fixture'
    })
    console.log('PASS: credential updates are serialized, atomic and recover after write failure')

    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' })
    safeStorage.getSelectedStorageBackend = () => 'basic_text'
    await assert.rejects(
      new CredentialStore(path.join(directory, 'plaintext')).update(() => {}),
      /Secure system storage is unavailable/
    )
    assert.equal(fs.existsSync(path.join(directory, 'plaintext/credentials.enc')), false)
    await assert.rejects(
      new CredentialStore(path.join(directory, 'secure')).load(),
      /storage|protection/
    )
    safeStorage.getSelectedStorageBackend = () => 'gnome_libsecret'
    await new CredentialStore(path.join(directory, 'linux-secure')).update(() => {})
    safeStorage.isEncryptionAvailable = () => false
    await assert.rejects(
      new CredentialStore(path.join(directory, 'unavailable')).update(() => {}),
      /Secure system storage is unavailable/
    )
    console.log('PASS: Linux plaintext storage and unavailable encryption remain rejected')
  })
  .then(() => finish(0))
  .catch((error) => {
    console.error(error)
    finish(1)
  })

function finish(code) {
  Object.defineProperty(process, 'platform', platform)
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) delete safeStorage[name]
    else safeStorage[name] = value
  }
  modules.dispose()
  fs.rmSync(directory, { recursive: true, force: true })
  app.exit(code)
}
