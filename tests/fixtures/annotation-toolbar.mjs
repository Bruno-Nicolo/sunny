export async function showTextOptions(evaluate, waitFor) {
  await evaluate(`(() => {
    const tool = document.querySelector('[aria-label="Add text"]')
    if (tool.getAttribute('aria-pressed') !== 'true') tool.click()
  })()`)
  await waitFor(`document.querySelector('[role="combobox"][aria-label="Text size"]') !== null`)
}

export async function chooseTextSize(evaluate, waitFor, size) {
  await showTextOptions(evaluate, waitFor)
  await evaluate(`(() => {
    const trigger = document.querySelector('[role="combobox"][aria-label="Text size"]')
    trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true, cancelable:true}))
  })()`)
  await waitFor(`document.querySelector('[role="option"]') !== null`)
  await evaluate(`(() => {
    const option = [...document.querySelectorAll('[role="option"]')].find(el => el.textContent.trim() === '${size} pt')
    if (!option) throw new Error('Missing text size: ${size}')
    option.focus()
    option.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}))
  })()`)
  await waitFor(
    `document.querySelector('[role="combobox"][aria-label="Text size"]').textContent.trim() === '${size} pt' && !document.querySelector('[role="listbox"]')`
  )
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
