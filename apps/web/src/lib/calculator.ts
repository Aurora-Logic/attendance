/**
 * A desk calculator's brain.
 *
 * Kept apart from the keys and the case because this gets used mid-quotation:
 * somebody works out a price here and types the answer onto a line. A rounding
 * artefact or a mishandled chain is a wrong quotation, so the semantics are
 * tested on their own.
 *
 * The behaviour copied is the ordinary desk calculator, not a scientific one:
 *
 *  - No operator precedence. `2 + 3 × 4` is 20, because each operator commits
 *    the one before it. That is what the machine on the desk does, and a person
 *    reaching for this expects the same answer.
 *  - `=` repeats the last operation. `2 + 3 =` gives 5, `=` again gives 8.
 *  - Percent is relative to the pending left-hand side: `200 + 10 %` is 220,
 *    not 200.1. On × and ÷ it is a plain hundredth.
 *  - GT accumulates every `=` result until cleared.
 */

export type CalcOperator = "+" | "-" | "*" | "/"

export interface CalcState {
  /** What the display shows, as a string so "5." and "5.00" survive typing. */
  display: string
  /** Left-hand side of a pending operation. */
  accumulator: number | null
  pending: CalcOperator | null
  /** Repeated on each subsequent `=`. */
  lastOperation: { operator: CalcOperator; operand: number } | null
  memory: number
  grandTotal: number
  /** Newest first: what was worked out, for copying out. */
  tape: string[]
  /** Set when the last action produced a result, so a digit starts fresh. */
  overwrite: boolean
  error: string | null
}

export const initialCalc: CalcState = {
  display: "0",
  accumulator: null,
  pending: null,
  lastOperation: null,
  memory: 0,
  grandTotal: 0,
  tape: [],
  overwrite: true,
  error: null,
}

/** Ten significant digits, and no floating-point dust. */
export function formatDisplay(value: number): string {
  if (!Number.isFinite(value)) return "Error"
  // 0.1 + 0.2 must read 0.3, and 1/3 must not run off the display.
  const rounded = Number.parseFloat(value.toPrecision(12))
  if (Object.is(rounded, -0)) return "0"
  const text = String(rounded)
  if (text.replace(/[-.]/g, "").length <= 12) return text
  return rounded.toExponential(6)
}

const OPERATOR_LABEL: Record<CalcOperator, string> = {
  "+": "+",
  "-": "−",
  "*": "×",
  "/": "÷",
}

const apply = (left: number, operator: CalcOperator, right: number): number => {
  switch (operator) {
    case "+":
      return left + right
    case "-":
      return left - right
    case "*":
      return left * right
    case "/":
      return right === 0 ? Number.NaN : left / right
  }
}

const TAPE_LIMIT = 50
const remember = (tape: string[], entry: string) => [entry, ...tape].slice(0, TAPE_LIMIT)

export type CalcAction =
  | { type: "digit"; value: string }
  | { type: "decimal" }
  | { type: "operator"; value: CalcOperator }
  | { type: "equals" }
  | { type: "percent" }
  | { type: "negate" }
  | { type: "backspace" }
  | { type: "clearEntry" }
  | { type: "clearAll" }
  | { type: "memoryAdd" }
  | { type: "memorySubtract" }
  | { type: "memoryRecall" }
  | { type: "memoryClear" }
  | { type: "grandTotalRecall" }
  | { type: "grandTotalClear" }

export function calcReducer(state: CalcState, action: CalcAction): CalcState {
  // Any key clears an error except one that would compound it.
  if (state.error && action.type !== "clearAll" && action.type !== "clearEntry") {
    state = { ...initialCalc, memory: state.memory, grandTotal: state.grandTotal, tape: state.tape }
  }

  const current = Number(state.display)

  switch (action.type) {
    case "digit": {
      if (state.overwrite) return { ...state, display: action.value, overwrite: false }
      // A leading zero is replaced, not accumulated into "007".
      if (state.display === "0") return { ...state, display: action.value }
      if (state.display.replace(/[-.]/g, "").length >= 12) return state
      return { ...state, display: state.display + action.value }
    }

    case "decimal": {
      if (state.overwrite) return { ...state, display: "0.", overwrite: false }
      if (state.display.includes(".")) return state
      return { ...state, display: state.display + "." }
    }

    case "operator": {
      // Pressing another operator before a number replaces the pending one
      // rather than committing a phantom operation.
      if (!state.overwrite && state.pending !== null && state.accumulator !== null) {
        const result = apply(state.accumulator, state.pending, current)
        if (!Number.isFinite(result)) {
          return { ...state, display: "Error", error: "Cannot divide by zero", overwrite: true }
        }
        return {
          ...state,
          display: formatDisplay(result),
          accumulator: result,
          pending: action.value,
          overwrite: true,
          tape: remember(
            state.tape,
            `${formatDisplay(state.accumulator)} ${OPERATOR_LABEL[state.pending]} ${formatDisplay(current)} = ${formatDisplay(result)}`
          ),
        }
      }
      return { ...state, accumulator: current, pending: action.value, overwrite: true }
    }

    case "equals": {
      let operator: CalcOperator | null = state.pending
      let left = state.accumulator
      let right = current

      if (operator === null || left === null) {
        // Repeat the last operation, which is what a second `=` is for.
        if (!state.lastOperation) return state
        operator = state.lastOperation.operator
        left = current
        right = state.lastOperation.operand
      }

      const result = apply(left, operator, right)
      if (!Number.isFinite(result)) {
        return { ...state, display: "Error", error: "Cannot divide by zero", overwrite: true, pending: null }
      }
      return {
        ...state,
        display: formatDisplay(result),
        accumulator: null,
        pending: null,
        lastOperation: { operator, operand: right },
        grandTotal: state.grandTotal + result,
        overwrite: true,
        tape: remember(
          state.tape,
          `${formatDisplay(left)} ${OPERATOR_LABEL[operator]} ${formatDisplay(right)} = ${formatDisplay(result)}`
        ),
      }
    }

    case "percent": {
      // On + and −, a percentage *of the left-hand side*: 200 + 10% is 220.
      // On × and ÷, a plain hundredth.
      if (state.pending && state.accumulator !== null) {
        const value =
          state.pending === "+" || state.pending === "-"
            ? (state.accumulator * current) / 100
            : current / 100
        return { ...state, display: formatDisplay(value), overwrite: false }
      }
      return { ...state, display: formatDisplay(current / 100), overwrite: false }
    }

    case "negate":
      if (state.display === "0") return state
      return {
        ...state,
        display: state.display.startsWith("-") ? state.display.slice(1) : `-${state.display}`,
      }

    case "backspace": {
      if (state.overwrite) return state
      const next = state.display.slice(0, -1)
      return { ...state, display: next === "" || next === "-" ? "0" : next }
    }

    case "clearEntry":
      return { ...state, display: "0", overwrite: true, error: null }

    case "clearAll":
      return { ...initialCalc, memory: state.memory, grandTotal: state.grandTotal, tape: state.tape }

    case "memoryAdd":
      return { ...state, memory: state.memory + current, overwrite: true }

    case "memorySubtract":
      return { ...state, memory: state.memory - current, overwrite: true }

    case "memoryRecall":
      return { ...state, display: formatDisplay(state.memory), overwrite: true }

    case "memoryClear":
      return { ...state, memory: 0 }

    case "grandTotalRecall":
      return { ...state, display: formatDisplay(state.grandTotal), overwrite: true }

    case "grandTotalClear":
      return { ...state, grandTotal: 0 }
  }
}

/**
 * A keystroke, as an action.
 *
 * Returns null for anything the calculator does not own, so the caller can let
 * it through — swallowing every key in the page would break typing everywhere
 * else while this is open.
 */
export function actionForKey(key: string): CalcAction | null {
  if (/^[0-9]$/.test(key)) return { type: "digit", value: key }
  switch (key) {
    case ".":
    case ",":
      return { type: "decimal" }
    case "+":
      return { type: "operator", value: "+" }
    case "-":
      return { type: "operator", value: "-" }
    case "*":
    case "x":
    case "X":
      return { type: "operator", value: "*" }
    case "/":
      return { type: "operator", value: "/" }
    case "Enter":
    case "=":
      return { type: "equals" }
    case "%":
      return { type: "percent" }
    case "Backspace":
      return { type: "backspace" }
    case "Delete":
      return { type: "clearEntry" }
    default:
      return null
  }
}

/** The tape, oldest first, for pasting into a note or an email. */
export const tapeAsText = (tape: string[]): string => [...tape].reverse().join("\n")
