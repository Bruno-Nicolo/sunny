export const textSizeSlider = `document.querySelector('[role="slider"][aria-label="Text size"]')`

export async function showTextOptions(evaluate, waitFor) {
  await evaluate(`(() => {
    const tool = document.querySelector('[aria-label="Add text"]')
    if (tool.getAttribute('aria-pressed') !== 'true') tool.click()
  })()`)
  await waitFor(`${textSizeSlider} !== null`)
}

export async function chooseTextSize(webContents, waitFor, size) {
  const evaluate = (code) => webContents.executeJavaScript(code)
  await showTextOptions(evaluate, waitFor)
  if ((await evaluate(`Number(${textSizeSlider}.getAttribute('aria-valuenow'))`)) === size) return
  webContents.focus()
  const { startX, x, y } = await evaluate(`(() => {
    const thumb = ${textSizeSlider}
    const handle = thumb.getBoundingClientRect()
    const track = thumb.closest('[data-slot="slider"]').getBoundingClientRect()
    const min = Number(thumb.getAttribute('aria-valuemin'))
    const max = Number(thumb.getAttribute('aria-valuemax'))
    return {
      startX: Math.round(handle.left + handle.width / 2),
      x: Math.round(track.left + track.width * (${size} - min) / (max - min)),
      y: Math.round(track.top + track.height / 2)
    }
  })()`)
  webContents.sendInputEvent({ type: 'mouseMove', x: startX, y })
  webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x: startX, y, clickCount: 1 })
  try {
    webContents.sendInputEvent({ type: 'mouseMove', modifiers: ['leftButtonDown'], x, y })
    await waitFor(`${textSizeSlider}.getAttribute('aria-valuenow') === '${size}'`)
  } finally {
    webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x, y, clickCount: 1 })
  }
}

export async function chooseHighlightColor(evaluate, waitFor, color) {
  await evaluate(`(() => {
    const tool = document.querySelector('[aria-label="Highlight text"]')
    if (tool.getAttribute('aria-pressed') !== 'true') tool.click()
  })()`)
  await waitFor(`document.querySelector('[aria-label="Highlight color"]') !== null`)
  await evaluate(
    `document.querySelector('[aria-label="Highlight color"] [aria-label="${color}"]').click()`
  )
  await waitFor(
    `document.querySelector('[aria-label="Highlight color"] [aria-label="${color}"]').getAttribute('aria-pressed') === 'true'`
  )
}
