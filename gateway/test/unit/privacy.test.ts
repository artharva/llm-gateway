import { luhnValid, verhoeffCheckDigit, verhoeffValid } from '../../src/privacy/checksums';
import { redactMessages, redactText } from '../../src/privacy/redact';

/** A 12-digit number with a correct Verhoeff check digit, like a real Aadhaar number. */
const aadhaar = (first11: string) => first11 + verhoeffCheckDigit(first11);
const validAadhaar = aadhaar('23456789012');
const spacedAadhaar = `${validAadhaar.slice(0, 4)} ${validAadhaar.slice(4, 8)} ${validAadhaar.slice(8)}`;
const invalidAadhaar = validAadhaar.slice(0, 11) + ((Number(validAadhaar[11]) + 1) % 10);

describe('checksums', () => {
  it('Luhn accepts real test card numbers and rejects a changed digit', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('5555555555554444')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
  });

  it('Verhoeff validates the check digit it computes', () => {
    expect(verhoeffValid(validAadhaar)).toBe(true);
    expect(verhoeffValid(invalidAadhaar)).toBe(false);
    expect(verhoeffValid('2363')).toBe(true); // textbook example: 236 + check digit 3
  });
});

describe('PII redaction: values that must be masked', () => {
  it.each([
    ['email', 'Mail me at atharva.k+test@college.ac.in today', 'Mail me at [EMAIL] today'],
    ['mobile', 'Call 9876543210 now', 'Call [PHONE] now'],
    ['mobile with +91 and a space', 'Call +91 98765 43210', 'Call [PHONE]'],
    ['mobile with 0 prefix and hyphen', 'Call 098765-43210.', 'Call [PHONE].'],
    ['Aadhaar with valid checksum', `ID ${validAadhaar}`, 'ID [AADHAAR]'],
    ['Aadhaar grouped 4-4-4', `my number is ${spacedAadhaar}`, 'my number is [AADHAAR]'],
    [
      'Aadhaar-like number after the word Aadhaar',
      `Aadhaar no: ${invalidAadhaar}`,
      'Aadhaar no: [AADHAAR]',
    ],
    ['card number', 'Card 4111 1111 1111 1111 exp 12/29', 'Card [CARD] exp 12/29'],
    ['card number with hyphens', '5555-5555-5555-4444', '[CARD]'],
    ['PAN', 'PAN ABCPE1234F on file', 'PAN [PAN] on file'],
  ])('%s', (_label, input, expected) => {
    expect(redactText(input).text).toBe(expected);
  });

  it('counts each type', () => {
    const { counts } = redactText('a@b.co, c@d.org and 9876543210');
    expect(counts).toEqual({ EMAIL: 2, PHONE: 1 });
  });
});

describe('PII redaction: ordinary text that must be left alone (false positives)', () => {
  it.each([
    ['a date', 'Due 2026-10-10 at 17:30'],
    ['a price with Indian grouping', 'Total ₹1,23,456.78'],
    ['an order id whose digits fail Verhoeff', `Order ORD-${invalidAadhaar}`],
    ['a 13-digit timestamp that fails Luhn', 'ts=1791627608021'],
    ['a 10-digit number that is not a mobile', 'Invoice 1234567890'],
    ['a version number', 'Upgrade to 10.2.3 first'],
    ['an 11-digit number', 'ref 98765432101'],
    ['a sentence with capital words', 'HELLO WORLD from INDIA'],
    ['code with an at sign', 'use @decorator and a@b'],
  ])('%s', (_label, input) => {
    expect(redactText(input)).toEqual({ text: input, counts: {} });
  });
});

describe('redactMessages', () => {
  it('masks every message and keeps roles', () => {
    const out = redactMessages([
      { role: 'system', content: 'Support bot' },
      { role: 'user', content: 'I am x@y.com, phone 9876543210' },
    ]);
    expect(out.messages).toEqual([
      { role: 'system', content: 'Support bot' },
      { role: 'user', content: 'I am [EMAIL], phone [PHONE]' },
    ]);
    expect(out.total).toBe(2);
  });
});
