export declare const name: 'dsh-locale-ja';
export declare const inject: string[];
export declare const language: Readonly<{ id: 'ja'; label: '日本語'; fallback: 'en' }>;
/** The public locale/effect surface used by this plugin (compatible with Cordis Context). */
export interface LanguagePackContext {
  locale: {
    addLanguage(input: { id: string; label: string; fallback: string }): () => void;
    register(namespace: string, locale: string, dictionary: Record<string, string>): () => void;
  };
  effect(callback: () => () => void, label?: string): unknown;
}
export declare function apply(ctx: LanguagePackContext): void;
