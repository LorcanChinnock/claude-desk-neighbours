/** One answer the band offers: the button's label and what it puts in the prompt box. */
export type ServeOption = { label: string; reply: string }

/** One thing the person must answer, with the answers the turn offered for it. */
export type ServeQuestion = { question: string; options: ServeOption[] }

/**
 * What a finished turn left for the person: its questions in order, and the replies given so far. The band
 * asks `questions[answers.length]`; a `null` answer was skipped, to be typed in the prompt.
 */
export type Serve = { questions: ServeQuestion[]; answers: (string | null)[] }

/** A question a turn ended on, for the pane's list of earlier ones. */
export type ServeAsked = { question: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'your-serve': { serve: Serve | null; history: ServeAsked[] }
  }
}
