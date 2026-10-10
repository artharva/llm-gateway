import type { ChatMessage } from '../types';
import { luhnValid, verhoeffValid } from './checksums';

export type PiiType = 'EMAIL' | 'CARD' | 'AADHAAR' | 'PAN' | 'PHONE';

interface Pattern {
  type: PiiType;
  regex: RegExp;
  /** Extra check on a match, to cut false positives. Gets the match and the text before it. */
  accept?: (match: string, before: string) => boolean;
}

const digitsOnly = (s: string) => s.replace(/\D/g, '');
const AADHAAR_HINT = /(aadha?ar|uidai|\buid\b)[^\n]{0,30}$/i;

/**
 * Applied in order: earlier patterns win, so a card number is never half
 * masked as a phone number. Checksums (Luhn for cards, Verhoeff for Aadhaar)
 * keep ordinary numbers such as order IDs and timestamps from being masked.
 */
export const PATTERNS: Pattern[] = [
  {
    type: 'EMAIL',
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
  },
  {
    // 13-19 digits, optionally grouped with spaces or hyphens, passing the Luhn check.
    type: 'CARD',
    regex: /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g,
    accept: (m) => luhnValid(digitsOnly(m)),
  },
  {
    // 12 digits, first digit 2-9, optionally as 4-4-4. Masked when the Verhoeff
    // check digit is right, or when the text just before mentions Aadhaar/UID.
    type: 'AADHAAR',
    regex: /(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d)/g,
    accept: (m, before) => verhoeffValid(digitsOnly(m)) || AADHAAR_HINT.test(before),
  },
  {
    // Indian PAN: 5 letters (4th is the holder type), 4 digits, 1 letter.
    type: 'PAN',
    regex: /\b[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]\b/g,
  },
  {
    // Indian mobile: optional +91 / 0091 / 91 / 0, then 10 digits starting 6-9.
    type: 'PHONE',
    regex: /(?<!\d)(?:(?:\+91|0091|91)[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g,
  },
];

export interface RedactionResult {
  text: string;
  counts: Partial<Record<PiiType, number>>;
}

export function redactText(input: string): RedactionResult {
  const counts: Partial<Record<PiiType, number>> = {};
  let text = input;
  for (const { type, regex, accept } of PATTERNS) {
    text = text.replace(regex, (match: string, ...rest: unknown[]) => {
      const offset = rest.find((r) => typeof r === 'number') as number;
      const whole = rest.find((r) => typeof r === 'string') as string;
      if (accept && !accept(match, whole.slice(Math.max(0, offset - 40), offset))) return match;
      counts[type] = (counts[type] ?? 0) + 1;
      return `[${type}]`;
    });
  }
  return { text, counts };
}

export function redactMessages(messages: ChatMessage[]): {
  messages: ChatMessage[];
  total: number;
  counts: Partial<Record<PiiType, number>>;
} {
  const counts: Partial<Record<PiiType, number>> = {};
  const out = messages.map((m) => {
    const r = redactText(m.content);
    for (const [type, n] of Object.entries(r.counts) as [PiiType, number][])
      counts[type] = (counts[type] ?? 0) + n;
    return { ...m, content: r.text };
  });
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  return { messages: out, total, counts };
}
