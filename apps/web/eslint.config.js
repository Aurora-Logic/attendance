import js from "@eslint/js"
import react from "eslint-plugin-react"
import reactHooks from "eslint-plugin-react-hooks"
import tseslint from "typescript-eslint"
import globals from "globals"

/**
 * The enforcement half of rule 1.1.
 *
 * The audit in audit/native-components.md found 55 native controls; without a
 * gate they come back one pull request at a time. This fails the build.
 *
 * Scope note: this config lints the *application* layer. components/ui/ is the
 * shadcn layer and is allowed to hold native elements — holding them is its
 * entire job.
 */

/** Native controls with a shadcn replacement. Keyed to the table in rule 1.1. */
const FORBIDDEN_ELEMENTS = [
  { element: "select", message: "Use shadcn Select, or Combobox when >8 options or searchable." },
  { element: "option", message: "Use shadcn Select items." },
  { element: "optgroup", message: "Use shadcn Select groups." },
  { element: "textarea", message: "Use shadcn Textarea." },
  { element: "dialog", message: "Use shadcn Dialog or AlertDialog." },
]

/** `<input type="...">` variants. forbid-elements matches on tag only. */
const BANNED_INPUT_TYPES = {
  checkbox: "shadcn Checkbox",
  radio: "shadcn RadioGroup",
  date: "shadcn Popover + Calendar",
  "datetime-local": "shadcn Popover + Calendar",
  time: "the composed time picker (components/time-select.tsx)",
  file: "shadcn Button + an sr-only input in a drop target",
  range: "a composed slider",
  color: "a composed colour picker",
}

const inputTypeRules = Object.entries(BANNED_INPUT_TYPES).map(([type, replacement]) => ({
  /**
   * `file` is the one case where rule 1.1's own prescription keeps the native
   * input — "Button + visually-hidden input". So the ban permits exactly that
   * shape (className carrying sr-only) and nothing looser: a bare file input,
   * or one hidden with `hidden` (which removes it from the accessibility
   * tree), still fails.
   */
  selector:
    `JSXOpeningElement[name.name='input']:has(JSXAttribute[name.name='type'][value.value='${type}'])` +
    (type === "file"
      ? `:not(:has(JSXAttribute[name.name='className'][value.value=/sr-only/]))`
      : ""),
  message: `Rule 1.1: <input type="${type}"> is banned. Use ${replacement}.`,
}))

const TABLE_ELEMENTS = ["table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption"]

/**
 * Emoji gate, rule 1.3. Scoped to JSX text and string literals, not comments,
 * per the decision in PLAN.md.
 *
 * Pictographs and dingbats only. The arrow blocks (U+2190-21FF, U+2B00-2BFF)
 * are deliberately NOT here: "→" in a sentence like "below a full day →
 * HALF_DAY" is typography, not an emoji, and there are 39 of them in UI copy.
 * Whether that prose should be reworded is a copy question, not an icon
 * question — raised separately rather than decided by a lint rule.
 */
const EMOJI = "[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2700}-\\u{27BF}\\u{FE0F}]"
const emojiRules = [
  {
    selector: `JSXText[value=/${EMOJI}/u]`,
    message: "Rule 1.3: no emoji in UI copy. Use a lucide-react icon.",
  },
  {
    selector: `Literal[value=/${EMOJI}/u]`,
    message: "Rule 1.3: no emoji in UI strings. Use a lucide-react icon.",
  },
  {
    selector: `TemplateElement[value.raw=/${EMOJI}/u]`,
    message: "Rule 1.3: no emoji in UI strings. Use a lucide-react icon.",
  },
]

export default tseslint.config(
  {
    ignores: ["dist/**", "dev-dist/**", "node_modules/**", "*.config.js", "*.config.ts"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.es2021 },
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      // TypeScript already reports undefined identifiers, and this rule does
      // not understand type-only names.
      "no-undef": "off",
      "no-unused-vars": "off",
      /**
       * The audit found several state bugs of exactly this shape — an effect
       * whose dependencies made it discard user input. Warnings rather than
       * errors for now: the existing disable comments say the codebase has
       * deliberate exceptions, and auditing each is Phase 7 work, not Phase 1.
       */
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react/forbid-elements": ["error", { forbid: FORBIDDEN_ELEMENTS }],
      "no-restricted-syntax": [
        "error",
        ...inputTypeRules,
        ...emojiRules,
        {
          // A browser tooltip on a DOM element. Lowercase name only — `title`
          // is a perfectly good prop on our own components (PageHeader title=).
          selector:
            "JSXOpeningElement[name.name=/^[a-z]/] > JSXAttribute[name.name='title']",
          message: "Rule 1.1: browser tooltips are banned. Use shadcn Tooltip.",
        },
        {
          selector:
            "CallExpression[callee.object.name='window'][callee.property.name=/^(alert|confirm|prompt)$/]",
          message: "Rule 1.1: use shadcn Dialog or AlertDialog, not a browser modal.",
        },
      ],
    },
  },
  {
    // Table primitives, everywhere except the A4 document surfaces.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/*-document.tsx"],
    rules: {
      "react/forbid-elements": [
        "error",
        {
          forbid: [
            ...FORBIDDEN_ELEMENTS,
            ...TABLE_ELEMENTS.map((element) => ({
              element,
              message: "Rule 1.1: use the shadcn Table primitives.",
            })),
          ],
        },
      ],
    },
  },
  {
    /**
     * The shadcn layer itself. It exists to wrap native elements, so the bans
     * above cannot apply to it — but it is still linted for everything else.
     */
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "react/forbid-elements": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    /**
     * The A4 document surfaces. Exempt for table elements only: shadcn Table
     * wraps content in an overflow-x-auto container, which stops a long table
     * paginating across printed pages. Everything else — tooltips, textareas,
     * inputs — is still enforced here, and was fixed in Phase 1.
     */
    files: ["src/components/*-document.tsx"],
    rules: {
      "react/forbid-elements": ["error", { forbid: FORBIDDEN_ELEMENTS }],
    },
  }
)
