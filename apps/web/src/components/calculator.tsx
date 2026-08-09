import * as React from "react"
import { Copy, GripHorizontal, X } from "lucide-react"

import {
  actionForKey,
  calcReducer,
  initialCalc,
  tapeAsText,
  type CalcAction,
} from "@/lib/calculator"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * The desk calculator.
 *
 * An early-80s office machine, evoked rather than copied: a muted plastic body,
 * an LCD panel with the faint ghost segments showing behind the live digits,
 * chunky keys that visibly depress, and a distinct colour for the operator
 * column and for clear.
 *
 * It exists because this gets used in the middle of a quotation, so it floats
 * over whatever screen you are on, remembers where you put it, and never needs
 * the mouse: every key has a keyboard equivalent, Enter is equals, Escape
 * closes it.
 */

const STORAGE_KEY = "attendance.calculator.position.v1"

/** The ghost segments. Every segment of an eight-digit LCD, lit faintly. */
const GHOST = "88888888.88"

interface KeySpec {
  label: React.ReactNode
  action: CalcAction
  /** Which part of the keypad it belongs to — drives the colour. */
  tone?: "digit" | "operator" | "clear" | "memory"
  wide?: boolean
  srLabel?: string
}

const KEYS: KeySpec[] = [
  { label: "MC", action: { type: "memoryClear" }, tone: "memory", srLabel: "Memory clear" },
  { label: "MR", action: { type: "memoryRecall" }, tone: "memory", srLabel: "Memory recall" },
  { label: "M−", action: { type: "memorySubtract" }, tone: "memory", srLabel: "Memory subtract" },
  { label: "M+", action: { type: "memoryAdd" }, tone: "memory", srLabel: "Memory add" },

  { label: "GT", action: { type: "grandTotalRecall" }, tone: "memory", srLabel: "Grand total" },
  { label: "CE", action: { type: "clearEntry" }, tone: "clear", srLabel: "Clear entry" },
  { label: "AC", action: { type: "clearAll" }, tone: "clear", srLabel: "Clear all" },
  { label: "÷", action: { type: "operator", value: "/" }, tone: "operator", srLabel: "Divide" },

  { label: "7", action: { type: "digit", value: "7" } },
  { label: "8", action: { type: "digit", value: "8" } },
  { label: "9", action: { type: "digit", value: "9" } },
  { label: "×", action: { type: "operator", value: "*" }, tone: "operator", srLabel: "Multiply" },

  { label: "4", action: { type: "digit", value: "4" } },
  { label: "5", action: { type: "digit", value: "5" } },
  { label: "6", action: { type: "digit", value: "6" } },
  { label: "−", action: { type: "operator", value: "-" }, tone: "operator", srLabel: "Subtract" },

  { label: "1", action: { type: "digit", value: "1" } },
  { label: "2", action: { type: "digit", value: "2" } },
  { label: "3", action: { type: "digit", value: "3" } },
  { label: "+", action: { type: "operator", value: "+" }, tone: "operator", srLabel: "Add" },

  { label: "0", action: { type: "digit", value: "0" } },
  { label: ".", action: { type: "decimal" }, srLabel: "Decimal point" },
  { label: "%", action: { type: "percent" }, srLabel: "Percent" },
  { label: "=", action: { type: "equals" }, tone: "operator", srLabel: "Equals" },
]

const TONE_CLASS: Record<NonNullable<KeySpec["tone"]> | "default", string> = {
  default:
    "bg-[oklch(0.93_0.005_90)] text-neutral-800 dark:bg-[oklch(0.32_0.005_90)] dark:text-neutral-100",
  digit:
    "bg-[oklch(0.93_0.005_90)] text-neutral-800 dark:bg-[oklch(0.32_0.005_90)] dark:text-neutral-100",
  // The operator column is the one a hand finds without looking.
  operator: "bg-[oklch(0.62_0.13_55)] text-white dark:bg-[oklch(0.55_0.14_55)]",
  clear: "bg-[oklch(0.58_0.16_25)] text-white dark:bg-[oklch(0.52_0.17_25)]",
  memory: "bg-[oklch(0.86_0.01_90)] text-neutral-600 dark:bg-[oklch(0.27_0.01_90)] dark:text-neutral-300",
}

export function Calculator({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, dispatch] = React.useReducer(calcReducer, initialCalc)
  const [pressed, setPressed] = React.useState<string | null>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)

  const [position, setPosition] = React.useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return JSON.parse(stored) as { x: number; y: number }
    } catch {
      /* a corrupt entry is not worth failing over */
    }
    return { x: 0, y: 0 }
  })

  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(position))
    } catch {
      /* private mode */
    }
  }, [position])

  /**
   * Drag with 1:1 tracking from where it was grabbed (apple-design §2).
   * Pointer capture keeps it following even when the pointer leaves the strip,
   * and only `transform` moves, so it stays on the compositor.
   */
  const dragFrom = React.useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragFrom.current = { x: event.clientX - position.x, y: event.clientY - position.y }
  }
  const onPointerMove = (event: React.PointerEvent) => {
    if (!dragFrom.current) return
    setPosition({ x: event.clientX - dragFrom.current.x, y: event.clientY - dragFrom.current.y })
  }
  const endDrag = () => {
    dragFrom.current = null
  }

  // Keyboard: every key, and Escape closes. Keys the calculator does not own
  // fall through, so typing elsewhere still works while it is open.
  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose()
        return
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const action = actionForKey(event.key)
      if (!action) return
      event.preventDefault()
      dispatch(action)
      setPressed(event.key)
      window.setTimeout(() => setPressed(null), 90)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const copyTape = () => {
    void navigator.clipboard?.writeText(tapeAsText(state.tape))
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Calculator"
      className="fixed bottom-6 right-6 z-50 w-[17rem] select-none rounded-xl border border-black/20 bg-[oklch(0.88_0.008_90)] shadow-2xl dark:border-white/10 dark:bg-[oklch(0.24_0.008_90)]"
      style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
    >
      {/* Grab strip. The whole header drags; the close button does not. */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="flex cursor-grab items-center justify-between px-2 py-1.5 active:cursor-grabbing"
      >
        <GripHorizontal className="size-3.5 text-neutral-500" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
          Calculator
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-5 text-neutral-500"
          aria-label="Close calculator"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {/* The LCD. Ghost segments sit behind the live value, as on the real thing. */}
      <div className="mx-2 rounded-md border border-black/25 bg-[oklch(0.84_0.045_150)] px-2 py-1.5 shadow-inner dark:border-black/40 dark:bg-[oklch(0.42_0.045_150)]">
        <div className="flex items-center justify-between text-[9px] font-medium text-neutral-700/70 dark:text-neutral-200/60">
          <span>{state.memory !== 0 ? "M" : " "}</span>
          <span>{state.grandTotal !== 0 ? "GT" : " "}</span>
        </div>
        <div className="relative text-right font-mono text-2xl leading-none">
          {/*
            Faint enough to read as unlit segments rather than as content. At
            10% they were legible as "88888888.88" and competed with the value.
          */}
          <span aria-hidden className="block text-neutral-900/[0.055] dark:text-white/[0.07]">
            {GHOST}
          </span>
          <span className="absolute inset-0 block truncate text-neutral-900 dark:text-white">
            {state.display}
          </span>
        </div>
        <p className="h-3 text-right text-[9px] text-neutral-700/70 dark:text-neutral-200/60">
          {state.error ?? (state.pending ? "pending" : " ")}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-1.5 p-2">
        {KEYS.map((key) => (
          <button
            key={String(key.srLabel ?? key.label)}
            type="button"
            aria-label={key.srLabel ?? String(key.label)}
            // Respond on pointer-down, not on release (apple-design §1).
            onPointerDown={() => {
              dispatch(key.action)
              setPressed(String(key.label))
              window.setTimeout(() => setPressed(null), 90)
            }}
            className={cn(
              "h-9 rounded-md border-b-2 border-black/25 text-sm font-semibold shadow-sm",
              "transition-transform duration-75 active:translate-y-px active:border-b",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              "motion-reduce:transition-none",
              TONE_CLASS[key.tone ?? "default"],
              pressed === String(key.label) && "translate-y-px border-b"
            )}
          >
            {key.label}
          </button>
        ))}
      </div>

      {state.tape.length > 0 ? (
        <div className="border-t border-black/10 px-2 py-1.5 dark:border-white/10">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-neutral-500">Tape</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1 text-[10px]"
              onClick={copyTape}
              aria-label="Copy the tape"
            >
              <Copy className="size-3" />
              Copy
            </Button>
          </div>
          <div className="max-h-20 overflow-y-auto overscroll-contain font-mono text-[10px] text-neutral-600 dark:text-neutral-300">
            {state.tape.map((line, index) => (
              <p key={`${line}-${index}`} className="truncate text-right">
                {line}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
