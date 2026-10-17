// Keep DOM focus and native input tests independent of macOS foreground activation policy.
export async function enableTestFocus(window) {
  if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach('1.3')
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true
  })
  window.webContents.focus()
}
