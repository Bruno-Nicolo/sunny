import type { AnnotationInsertionPoint } from '../types'

type Options = {
  container: HTMLElement
  signal: AbortSignal
  size(page: HTMLElement, image: HTMLImageElement): { width: number; height: number }
  insert(point: AnnotationInsertionPoint, image: HTMLImageElement): Promise<void>
}

// Placement owns no document content until the user clicks a page. Aborting releases every resource.
export async function placeImage(
  src: string,
  { container, signal, size, insert }: Options
): Promise<void> {
  const preview = document.createElement('img')
  preview.src = src
  await preview.decode()
  if (signal.aborted) return
  await new Promise<void>((resolve, reject) => {
    const listeners = new AbortController()
    const hint = document.createElement('div')
    hint.className = 'signature-placement-hint'
    hint.textContent = 'Click a page to place the signature · Esc to cancel'
    hint.setAttribute('role', 'status')
    preview.className = 'signature-placement-preview'
    preview.alt = ''
    preview.hidden = true
    document.body.append(preview, hint)
    container.classList.add('image-placement-active')
    function finish(): void {
      listeners.abort()
      signal.removeEventListener('abort', cancel)
      preview.remove()
      hint.remove()
      container.classList.remove('image-placement-active')
    }
    function cancel(): void {
      finish()
      resolve()
    }
    function pageAt(event: MouseEvent): HTMLElement | null {
      const page = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('.page')
      return page && container.contains(page) ? page : null
    }
    signal.addEventListener('abort', cancel, { once: true })
    const options = { capture: true, signal: listeners.signal }
    window.addEventListener(
      'pointermove',
      (event) => {
        const page = pageAt(event)
        preview.hidden = !page
        if (!page) return
        const { width, height } = size(page, preview)
        Object.assign(preview.style, {
          width: `${width}px`,
          height: `${height}px`,
          left: `${event.clientX - width / 2}px`,
          top: `${event.clientY - height / 2}px`
        })
      },
      options
    )
    for (const name of ['pointerdown', 'pointerup'] as const) {
      window.addEventListener(
        name,
        (event) => {
          if (event.button !== 0 || !pageAt(event)) return
          event.preventDefault()
          event.stopImmediatePropagation()
        },
        options
      )
    }
    window.addEventListener(
      'click',
      (event) => {
        if (event.button !== 0 || !pageAt(event)) return
        event.preventDefault()
        event.stopImmediatePropagation()
        finish()
        void insert({ clientX: event.clientX, clientY: event.clientY }, preview).then(
          resolve,
          reject
        )
      },
      options
    )
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopImmediatePropagation()
        cancel()
      },
      options
    )
    window.addEventListener('blur', cancel, { signal: listeners.signal })
    container.addEventListener(
      'scroll',
      () => {
        preview.hidden = true
      },
      { signal: listeners.signal }
    )
  })
}
