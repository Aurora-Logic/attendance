import { describe, expect, it } from "vitest"

import {
  actionForKey,
  calcReducer,
  formatDisplay,
  initialCalc,
  tapeAsText,
  type CalcAction,
  type CalcState,
} from "@/lib/calculator"

/** Press a sequence, the way a person would. */
const press = (keys: string, from: CalcState = initialCalc): CalcState => {
  let state = from
  for (const key of keys.split(" ")) {
    if (key === "") continue
    const action = actionForKey(key)
    if (!action) throw new Error(`no action for key ${key}`)
    state = calcReducer(state, action)
  }
  return state
}

const act = (state: CalcState, ...actions: CalcAction[]) =>
  actions.reduce((s, a) => calcReducer(s, a), state)

describe("formatDisplay", () => {
  it("shows a clean number, not floating-point dust", () => {
    // 0.1 + 0.2 is the reason this function exists.
    expect(formatDisplay(0.1 + 0.2)).toBe("0.3")
    expect(formatDisplay(1.005 * 100)).toBe("100.5")
  })

  it("never shows negative zero", () => {
    expect(formatDisplay(-0)).toBe("0")
  })

  it("falls back to exponential rather than overflowing the display", () => {
    expect(formatDisplay(1e21)).toContain("e+")
  })

  it("says Error rather than Infinity or NaN", () => {
    expect(formatDisplay(Number.POSITIVE_INFINITY)).toBe("Error")
    expect(formatDisplay(Number.NaN)).toBe("Error")
  })
})

describe("arithmetic, the way a desk calculator does it", () => {
  it("adds", () => {
    expect(press("2 + 3 =").display).toBe("5")
  })

  it("has no operator precedence — each operator commits the one before", () => {
    // 2 + 3 x 4 is 20 on the machine on the desk, not 14. Someone reaching for
    // this expects the desk answer.
    expect(press("2 + 3 * 4 =").display).toBe("20")
  })

  it("shows the running result as you chain", () => {
    const state = press("2 + 3 +")
    expect(state.display).toBe("5")
  })

  it("repeats the last operation on a second equals", () => {
    let state = press("2 + 3 =")
    expect(state.display).toBe("5")
    state = calcReducer(state, { type: "equals" })
    expect(state.display).toBe("8")
    state = calcReducer(state, { type: "equals" })
    expect(state.display).toBe("11")
  })

  it("replaces a pending operator instead of committing a phantom operation", () => {
    // Pressing + then × by mistake must not multiply by nothing.
    expect(press("8 + * 2 =").display).toBe("16")
  })

  it("divides, and refuses to divide by zero", () => {
    expect(press("9 / 3 =").display).toBe("3")
    const state = press("9 / 0 =")
    expect(state.display).toBe("Error")
    expect(state.error).toBe("Cannot divide by zero")
  })

  it("recovers from an error on the next keystroke", () => {
    const state = press("9 / 0 = 7")
    expect(state.display).toBe("7")
    expect(state.error).toBeNull()
  })

  it("keeps the decimal point sane", () => {
    expect(press("1 . 5 + 2 . 5 =").display).toBe("4")
    // A second point is ignored rather than producing "1..5".
    expect(press("1 . . 5").display).toBe("1.5")
    // A bare point starts "0."
    expect(press(".").display).toBe("0.")
  })

  it("replaces the leading zero rather than accumulating 007", () => {
    expect(press("0 0 7").display).toBe("7")
  })

  it("stops accepting digits at the display width", () => {
    const state = press("1 2 3 4 5 6 7 8 9 0 1 2 3 4 5")
    expect(state.display.length).toBeLessThanOrEqual(12)
  })
})

describe("percent, the way an invoice needs it", () => {
  it("adds a percentage of the left-hand side", () => {
    // 200 + 10% is 220 on a desk calculator, not 200.1. This is the case that
    // matters when somebody is working out a marked-up price.
    const state = act(press("2 0 0 + 1 0"), { type: "percent" }, { type: "equals" })
    expect(state.display).toBe("220")
  })

  it("subtracts a percentage of the left-hand side", () => {
    const state = act(press("2 0 0 - 1 0"), { type: "percent" }, { type: "equals" })
    expect(state.display).toBe("180")
  })

  it("is a plain hundredth when multiplying", () => {
    const state = act(press("2 0 0 * 1 0"), { type: "percent" }, { type: "equals" })
    expect(state.display).toBe("20")
  })

  it("is a plain hundredth on its own", () => {
    expect(act(press("5 0"), { type: "percent" }).display).toBe("0.5")
  })
})

describe("sign, backspace and clearing", () => {
  it("toggles the sign both ways", () => {
    let state = act(press("5"), { type: "negate" })
    expect(state.display).toBe("-5")
    state = calcReducer(state, { type: "negate" })
    expect(state.display).toBe("5")
  })

  it("does not make a negative zero", () => {
    expect(act(initialCalc, { type: "negate" }).display).toBe("0")
  })

  it("backspaces to zero rather than to nothing", () => {
    expect(press("5 Backspace").display).toBe("0")
    expect(act(press("5"), { type: "negate" }, { type: "backspace" }).display).toBe("0")
  })

  it("clear-entry keeps the pending operation, clear-all does not", () => {
    const entry = act(press("2 + 3"), { type: "clearEntry" })
    expect(entry.display).toBe("0")
    expect(entry.pending).toBe("+")

    const all = act(press("2 + 3"), { type: "clearAll" })
    expect(all.pending).toBeNull()
    expect(all.display).toBe("0")
  })

  it("clear-all keeps memory and the grand total — they are not the entry", () => {
    let state = act(press("5"), { type: "memoryAdd" })
    state = press("2 + 3 =", state)
    state = calcReducer(state, { type: "clearAll" })
    expect(state.memory).toBe(5)
    expect(state.grandTotal).toBe(5)
  })
})

describe("memory", () => {
  it("adds, subtracts, recalls and clears", () => {
    let state = act(press("1 0"), { type: "memoryAdd" })
    expect(state.memory).toBe(10)

    state = act(press("4", state), { type: "memorySubtract" })
    expect(state.memory).toBe(6)

    state = calcReducer(state, { type: "memoryRecall" })
    expect(state.display).toBe("6")

    state = calcReducer(state, { type: "memoryClear" })
    expect(state.memory).toBe(0)
  })

  it("a recalled value can be used straight away", () => {
    let state = act(press("7"), { type: "memoryAdd" }, { type: "clearAll" })
    state = calcReducer(state, { type: "memoryRecall" })
    state = press("* 2 =", state)
    expect(state.display).toBe("14")
  })
})

describe("grand total", () => {
  it("accumulates every result until cleared", () => {
    let state = press("2 + 3 =")
    state = press("1 0 + 5 =", state)
    expect(state.grandTotal).toBe(20)

    state = calcReducer(state, { type: "grandTotalRecall" })
    expect(state.display).toBe("20")

    state = calcReducer(state, { type: "grandTotalClear" })
    expect(state.grandTotal).toBe(0)
  })
})

describe("the tape", () => {
  it("records each completed calculation, newest first", () => {
    const state = press("2 + 3 = 1 0 * 4 =")
    expect(state.tape[0]).toBe("10 × 4 = 40")
    expect(state.tape[1]).toBe("2 + 3 = 5")
  })

  it("copies out oldest first, which is how it is read", () => {
    const state = press("2 + 3 = 1 0 * 4 =")
    expect(tapeAsText(state.tape)).toBe("2 + 3 = 5\n10 × 4 = 40")
  })

  it("is bounded so a long session cannot grow without limit", () => {
    let state = initialCalc
    for (let i = 0; i < 80; i++) state = press("1 + 1 =", state)
    expect(state.tape.length).toBeLessThanOrEqual(50)
  })
})

describe("keyboard mapping", () => {
  it("covers the number row, the operators and equals", () => {
    expect(actionForKey("7")).toEqual({ type: "digit", value: "7" })
    expect(actionForKey("+")).toEqual({ type: "operator", value: "+" })
    expect(actionForKey("x")).toEqual({ type: "operator", value: "*" })
    expect(actionForKey("Enter")).toEqual({ type: "equals" })
    expect(actionForKey("=")).toEqual({ type: "equals" })
    expect(actionForKey("Backspace")).toEqual({ type: "backspace" })
  })

  it("accepts a comma as a decimal point, which numeric keypads emit", () => {
    expect(actionForKey(",")).toEqual({ type: "decimal" })
  })

  it("returns null for keys it does not own, so the page still works", () => {
    // Swallowing every key while this is open would break typing everywhere.
    for (const key of ["a", "Tab", "Escape", "ArrowLeft", "F1"]) {
      expect(actionForKey(key), key).toBeNull()
    }
  })
})
