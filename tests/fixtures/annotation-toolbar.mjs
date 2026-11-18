export async function showTextOptions(evaluate, waitFor) {
  await evaluate(`(() => {
    const tool = document.querySelector('[aria-label="Add text"]')
    if (tool.getAttribute('aria-pressed') !== 'true') tool.click()
  })()`)
  await waitFor(`document.querySelector('input[aria-label="Text size"]') !== null`)
}

export async function chooseTextSize(evaluate, waitFor, size) {
  await showTextOptions(evaluate, waitFor)
  await evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Text size"]')
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '${size}')
    input.dispatchEvent(new Event('input', {bubbles:true}))
    input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}))
  })()`)
  await waitFor(`document.querySelector('input[aria-label="Text size"]').value === '${size}'`)
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
