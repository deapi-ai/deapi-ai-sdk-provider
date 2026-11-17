/**
 * Whisper reports the detected language as a lower-case English name
 * (`"english"`), while the AI SDK `TranscriptionModelV4` result expects an
 * ISO-639-1 code (`"en"`). This table covers the languages Whisper detects
 * that have a two-letter code.
 */
const WHISPER_LANGUAGE_TO_ISO_639_1: Readonly<Record<string, string>> = {
  afrikaans: 'af',
  arabic: 'ar',
  armenian: 'hy',
  azerbaijani: 'az',
  belarusian: 'be',
  bosnian: 'bs',
  bulgarian: 'bg',
  catalan: 'ca',
  chinese: 'zh',
  croatian: 'hr',
  czech: 'cs',
  danish: 'da',
  dutch: 'nl',
  english: 'en',
  estonian: 'et',
  finnish: 'fi',
  french: 'fr',
  galician: 'gl',
  german: 'de',
  greek: 'el',
  hebrew: 'he',
  hindi: 'hi',
  hungarian: 'hu',
  icelandic: 'is',
  indonesian: 'id',
  italian: 'it',
  japanese: 'ja',
  kannada: 'kn',
  kazakh: 'kk',
  korean: 'ko',
  latvian: 'lv',
  lithuanian: 'lt',
  macedonian: 'mk',
  malay: 'ms',
  marathi: 'mr',
  maori: 'mi',
  nepali: 'ne',
  norwegian: 'no',
  persian: 'fa',
  polish: 'pl',
  portuguese: 'pt',
  romanian: 'ro',
  russian: 'ru',
  serbian: 'sr',
  slovak: 'sk',
  slovenian: 'sl',
  spanish: 'es',
  swahili: 'sw',
  swedish: 'sv',
  tagalog: 'tl',
  tamil: 'ta',
  thai: 'th',
  turkish: 'tr',
  ukrainian: 'uk',
  urdu: 'ur',
  vietnamese: 'vi',
  welsh: 'cy',
};

/**
 * Normalizes a language reported by the transcription endpoint to ISO-639-1.
 *
 * - A two-letter code (optionally with a region, e.g. `en-US`) is returned
 *   lower-cased without the region.
 * - A Whisper language name is mapped through the table above.
 * - Anything else yields `undefined` rather than a value that is not a code.
 */
export function toIso6391(language: string | null | undefined): string | undefined {
  if (language == null) return undefined;
  const value = language.trim().toLowerCase();
  const code = /^([a-z]{2})(?:[-_][a-z0-9]+)?$/.exec(value);
  if (code) return code[1];
  return Object.prototype.hasOwnProperty.call(WHISPER_LANGUAGE_TO_ISO_639_1, value)
    ? WHISPER_LANGUAGE_TO_ISO_639_1[value]
    : undefined;
}
