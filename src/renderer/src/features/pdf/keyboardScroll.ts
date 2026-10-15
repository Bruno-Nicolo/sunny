// Accumulate arrow-key steps without restarting the animation on keyboard repeats.
export function createKeyboardScroll(container: HTMLElement, signal: AbortSignal) {
  let frame: number | null = null
  let targetLeft = 0
  let targetTop = 0
  let previousTime = 0
  let lastLeft = 0
  let lastTop = 0
  let left = 0
  let top = 0

  const stop = (): void => {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
  }

  const animate = (time: number): void => {
    if (container.scrollLeft !== lastLeft || container.scrollTop !== lastTop) {
      stop()
      return
    }
    const fraction = 1 - Math.exp(-(time - previousTime) / 55)
    previousTime = time
    left += (targetLeft - left) * fraction
    top += (targetTop - top) * fraction
    const finished = Math.abs(targetLeft - left) < 1 && Math.abs(targetTop - top) < 1
    container.scrollTo({
      left: finished ? targetLeft : left,
      top: finished ? targetTop : top,
      behavior: 'instant'
    })
    lastLeft = container.scrollLeft
    lastTop = container.scrollTop
    frame = finished ? null : requestAnimationFrame(animate)
  }

  container.addEventListener('wheel', stop, { passive: true, signal })
  container.addEventListener('pointerdown', stop, { signal })
  window.addEventListener('blur', stop, { signal })
  signal.addEventListener('abort', stop, { once: true })

  return (deltaLeft: number, deltaTop: number): void => {
    if (signal.aborted) return
    if (frame !== null && (container.scrollLeft !== lastLeft || container.scrollTop !== lastTop)) {
      stop()
    }
    if (frame === null) {
      targetLeft = lastLeft = left = container.scrollLeft
      targetTop = lastTop = top = container.scrollTop
      previousTime = performance.now()
    }
    targetLeft = Math.max(
      0,
      Math.min(container.scrollWidth - container.clientWidth, targetLeft + deltaLeft)
    )
    targetTop = Math.max(
      0,
      Math.min(container.scrollHeight - container.clientHeight, targetTop + deltaTop)
    )
    if (frame === null) frame = requestAnimationFrame(animate)
  }
}
