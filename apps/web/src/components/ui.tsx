import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(active: boolean, containerRef: RefObject<HTMLElement | null>, restoreRef?: RefObject<HTMLElement | null>) {
  const restoreNode = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!active) return undefined
    restoreNode.current = restoreRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    const container = containerRef.current
    if (!container) return undefined
    const focusables = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => !element.hasAttribute('disabled'))
    const first = focusables()[0]
    window.setTimeout(() => (first ?? container).focus(), 0)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = focusables()
      if (!items.length) { event.preventDefault(); return }
      const current = document.activeElement
      const index = items.indexOf(current as HTMLElement)
      if (event.shiftKey && (index <= 0 || current === container)) { event.preventDefault(); items[items.length - 1].focus() }
      else if (!event.shiftKey && (index === items.length - 1 || current === container)) { event.preventDefault(); items[0].focus() }
    }
    container.addEventListener('keydown', onKeyDown)
    return () => {
      container.removeEventListener('keydown', onKeyDown)
      window.setTimeout(() => restoreNode.current?.focus(), 0)
    }
  }, [active, containerRef, restoreRef])
}

export function AccessibleDialog({ open, onClose, titleId, children, className = '' }: { open: boolean; onClose: () => void; titleId: string; children: ReactNode; className?: string }) {
  const dialogRef = useRef<HTMLElement>(null)
  useFocusTrap(open, dialogRef)
  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); document.body.style.overflow = previousOverflow }
  }, [open, onClose])
  if (!open) return null
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="presentation">
    <section ref={dialogRef} tabIndex={-1} className={className} role="dialog" aria-modal="true" aria-labelledby={titleId}>{children}</section>
  </div>
}

export function Button({children, variant='primary', className='', ...props}: React.ButtonHTMLAttributes<HTMLButtonElement> & {variant?: 'primary'|'secondary'|'ghost'|'danger'; children: ReactNode}) { const styles={primary:'bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-black dark:hover:bg-neutral-200',secondary:'border border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-800 dark:bg-black dark:hover:bg-neutral-900',ghost:'hover:bg-neutral-100 dark:hover:bg-neutral-900',danger:'border border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400'}; return <button className={`focus-ring inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`} {...props}>{children}</button> }
export function IconButton({label, children, className='', ...props}: React.ButtonHTMLAttributes<HTMLButtonElement> & {label: string; children: ReactNode}) { return <Button {...props} variant="ghost" className={`px-2 ${className}`} aria-label={label}>{children}</Button> }
export function Field({label, ...props}: React.InputHTMLAttributes<HTMLInputElement> & {label: string}) { return <label className="block text-sm"><span className="mb-1.5 block font-medium text-neutral-700 dark:text-neutral-300">{label}</span><input className="focus-ring w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-white" {...props}/></label> }
export function Card({children, className=''}:{children:ReactNode;className?:string}) { return <section className={`rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 ${className}`}>{children}</section> }
export function Empty({title, detail}:{title:string;detail:string}) { return <div className="border border-dashed border-neutral-200 px-6 py-12 text-center dark:border-neutral-800"><p className="text-sm font-medium">{title}</p><p className="mt-1 text-sm text-neutral-500">{detail}</p></div> }
export function Notice({children, tone='error'}:{children:ReactNode;tone?:'error'|'success'|'neutral'}) { const error = tone === 'error'; return <div role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'} className={`rounded-md border px-3 py-2 text-sm ${error?'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400':tone==='success'?'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-400':'border-neutral-200 bg-neutral-50 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300'}`}>{children}</div> }
