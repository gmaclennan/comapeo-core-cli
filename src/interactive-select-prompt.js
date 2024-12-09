import {
  createPrompt,
  useState,
  useKeypress,
  usePrefix,
  usePagination,
  useRef,
  useMemo,
  isBackspaceKey,
  isEnterKey,
  isUpKey,
  isDownKey,
  isNumberKey,
  Separator,
  ValidationError,
  makeTheme,
} from '@inquirer/core'
import figures from '@inquirer/figures'
import ansiEscapes from 'ansi-escapes'
import colors from 'yoctocolors-cjs'

/** @import {Theme, Status} from '@inquirer/core' */
/** @import {PartialDeep} from '@inquirer/type' */

/** @typedef {'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm' | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z' | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'} Key */

/**
 * @typedef {Object} SelectTheme
 * @property {Object} icon
 * @property {string} icon.cursor
 * @property {Object} style
 * @property {(text: string) => string} style.disabled
 * @property {(text: string) => string} style.description
 * @property {'always' | 'never' | 'auto'} helpMode
 */

/** @type {SelectTheme} */
const selectTheme = {
  icon: { cursor: figures.pointer },
  style: {
    disabled: (text) => colors.dim(`- ${text}`),
    description: (text) => colors.cyan(text),
  },
  helpMode: 'auto',
}

/**
 * @template Value
 * @typedef {Object} Choice
 * @property {Value} value
 * @property {Key} [key]
 * @property {string} [name]
 * @property {string} [description]
 * @property {string} [short]
 * @property {boolean|string} [disabled]
 */

/**
 * @template Value
 * @typedef {Object} NormalizedChoice
 * @property {Value} value
 * @property {Key} key
 * @property {string} name
 * @property {string} [description]
 * @property {string} short
 * @property {boolean|string} disabled
 */

/**
 * @template Value
 * @typedef {Object} SelectConfig
 * @property {string} message
 * @property {ReadonlyArray<Choice<Value>>} choices
 * @property {number} [pageSize]
 * @property {boolean} [loop]
 * @property {unknown} [default]
 * @property {PartialDeep<Theme<SelectTheme>>} [theme]
 */

/**
 * Checks if an item is selectable.
 *
 * @template Value
 * @param {NormalizedChoice<Value> | Separator} item
 * @returns {item is NormalizedChoice<Value>}
 */
function isSelectable(item) {
  return !Separator.isSeparator(item) && !item.disabled
}
/**
 * Normalizes the choices into an array of normalized choices or separators.
 *
 * @template Value
 * @param {ReadonlyArray<Choice<Value>>} choices
 * @returns {Array<NormalizedChoice<Value>>}
 */
function normalizeChoices(choices) {
  return choices.map((choice) => {
    const name = choice.name ?? String(choice.value)
    return {
      value: choice.value,
      name,
      key: choice.key ?? /** @type {Key} */ (name[0].toLowerCase()),
      description: choice.description,
      short: choice.short ?? name,
      disabled: choice.disabled ?? false,
    }
  })
}

export default createPrompt(
  /**
   * Prompt for selecting an option.
   *
   * @template Value
   * @param {SelectConfig<Value>} config - The configuration for the select prompt.
   * @param {(value: Value) => void} done - Callback when selection is done.
   * @returns {string}
   */
  (config, done) => {
    const { loop = true, pageSize = 7 } = config
    const firstRender = useRef(true)
    const theme = makeTheme(selectTheme, config.theme)
    const [status, setStatus] = useState(/** @type {Status} */ ('idle'))
    const prefix = usePrefix({ status, theme })

    const items = useMemo(
      () => normalizeChoices(config.choices),
      [config.choices],
    )

    const bounds = useMemo(() => {
      const first = items.findIndex(isSelectable)
      const last = items.findLastIndex(isSelectable)

      if (first < 0) {
        throw new ValidationError(
          '[select prompt] No selectable choices. All choices are disabled.',
        )
      }

      return { first, last }
    }, [items])

    const defaultItemIndex = useMemo(() => {
      if (!('default' in config)) return -1
      return items.findIndex(
        (item) => isSelectable(item) && item.value === config.default,
      )
    }, [config.default, items])

    const [active, setActive] = useState(
      defaultItemIndex === -1 ? bounds.first : defaultItemIndex,
    )

    // Safe to assume the cursor position always points to a Choice.
    const selectedChoice = items[active]

    useKeypress((key, rl) => {
      if (isEnterKey(key)) {
        setStatus('done')
        done(selectedChoice.value)
      } else if (isUpKey(key) || isDownKey(key)) {
        rl.clearLine(0)
        if (
          loop ||
          (isUpKey(key) && active !== bounds.first) ||
          (isDownKey(key) && active !== bounds.last)
        ) {
          const offset = isUpKey(key) ? -1 : 1
          let next = active
          do {
            next = (next + offset + items.length) % items.length
          } while (!isSelectable(items[next]))
          setActive(next)
        }
      } else if (isNumberKey(key)) {
        rl.clearLine(0)
        const position = Number(key.name) - 1
        const item = items[position]
        if (item != null && isSelectable(item)) {
          setActive(position)
        }
      } else if (isBackspaceKey(key)) {
        rl.clearLine(0)
      } else {
        const foundIndex = items.findIndex((choice) => {
          return choice.key === key.name && isSelectable(choice)
        })
        if (foundIndex !== -1) {
          setActive(foundIndex)
          // This automatically finishes the prompt. Remove this if you don't want that.
          setStatus('done')
          done(items[foundIndex].value)
        }
      }
    })

    const message = theme.style.message(config.message, status)

    let helpTipTop = ''
    let helpTipBottom = ''
    if (
      theme.helpMode === 'always' ||
      (theme.helpMode === 'auto' && firstRender.current)
    ) {
      firstRender.current = false

      if (items.length > pageSize) {
        helpTipBottom = `\n${theme.style.help('(Use arrow keys to reveal more choices)')}`
      } else {
        helpTipTop = theme.style.help('(Use arrow keys)')
      }
    }

    const page = usePagination({
      items,
      active,
      renderItem({ item, isActive }) {
        if (Separator.isSeparator(item)) {
          return ` ${item.separator}`
        }

        if (item.disabled) {
          const disabledLabel =
            typeof item.disabled === 'string' ? item.disabled : '(disabled)'
          return theme.style.disabled(`${item.name} ${disabledLabel}`)
        }

        const color = isActive
          ? theme.style.highlight
          : /** @param {string} x */
            (x) => x
        const cursor = isActive ? theme.icon.cursor : ` `
        const key = colors.dim(`(${item.key})`)
        return color(`${cursor} ${item.name} ${key}`)
      },
      pageSize,
      loop,
    })

    if (status === 'done') {
      return `${prefix} ${message} ${theme.style.answer(selectedChoice.short)}`
    }

    const choiceDescription = selectedChoice.description
      ? `\n${theme.style.description(selectedChoice.description)}`
      : ``

    return `${[prefix, message, helpTipTop].filter(Boolean).join(' ')}\n${page}${helpTipBottom}${choiceDescription}${ansiEscapes.cursorHide}`
  },
)
