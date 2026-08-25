const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
const NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' };

export function normalizeModerationText(value: string): string {
  return value.normalize('NFKC').replace(ZERO_WIDTH, '').toLocaleLowerCase('en-IN').split('').map((character) => LEET[character] ?? character).join('').replace(NON_ALPHANUMERIC, ' ').trim().replace(/\s+/g, ' ');
}

export function matchProhibitedTerms(text: string, terms: Array<{ term: string; severity: string }>) {
  const normalized = ` ${normalizeModerationText(text)} `;
  return terms.filter(({ term }) => normalized.includes(` ${normalizeModerationText(term)} `));
}
