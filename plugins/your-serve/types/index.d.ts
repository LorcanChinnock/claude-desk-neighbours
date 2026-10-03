/** One answer the band offers: the button's label and what it puts in the prompt box. */
export type ServeOption = { label: string; reply: string }

/** The question a finished turn left for the person. */
export type Serve = { question: string; options: ServeOption[] }

/** A question a turn ended on, for the pane's list of earlier ones. */
export type ServeAsked = { question: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'your-serve': { serve: Serve | null; history: ServeAsked[] }
  }
}
