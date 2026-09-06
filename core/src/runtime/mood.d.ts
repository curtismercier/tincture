/** A v0.2 mood cell map: `default`, `surface=dark`, `flavor=warm,surface=dark`, … */
export type MoodCells = Record<string, string>;

export interface MoodTokenV02 { values: MoodCells }
export interface MoodTokenV01 { lightValue?: string; darkValue?: string }

export interface Mood {
  id: string;
  name?: string;
  doc?: string;
  base?: string;
  tokens?: Record<string, MoodTokenV02 | MoodTokenV01>;
}

export type MoodVars = Record<`--mood-${string}`, string>;
export type Axes = Partial<Record<'surface' | 'flavor' | 'tone' | 'elevation', string>> & Record<string, string | undefined>;

export function normalizeMood(mood: Mood): { id: string; tokens: Record<string, MoodCells> };
export function moodVars(mood: Mood, axes?: Axes): MoodVars;
export function moodCss(mood: Mood, opts?: { selector?: string }): string;
export function applyMood(el: HTMLElement, mood: Mood, axes?: Axes): MoodVars;
export function clearMood(el: HTMLElement, mood: Mood): void;
