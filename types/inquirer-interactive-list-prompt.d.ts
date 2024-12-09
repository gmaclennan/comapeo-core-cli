import type { Prompt } from '@inquirer/type'

declare module 'inquirer-interactive-list-prompt' {
  type Choice<Value> = {
    value: Value
    name?: string
    key: string
  }

  declare const _default: <Value>(
    config: {
      message: string
      choices: readonly Choice<Value>[]
      renderSelected: (choice: Choice<Value>) => string
      renderUnselected: (choice: Choice<Value>) => string
      hideCursor?: boolean
    },
    context?: import('@inquirer/type').Context,
  ) => Promise<Value> & {
    cancel: () => void
  }
  export default _default
}
