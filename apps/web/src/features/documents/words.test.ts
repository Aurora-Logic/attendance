import { describe, expect, it } from 'vitest';

import { integerToIndianWords, moneyToIndianWords } from './words';

describe('money in words, the Indian way', () => {
  it('reads Tally’s example back: 4130 is Four Thousand One Hundred Thirty', () => {
    expect(moneyToIndianWords('4130.00')).toBe('Indian Rupee Four Thousand One Hundred Thirty Only');
    expect(moneyToIndianWords('630.00')).toBe('Indian Rupee Six Hundred Thirty Only');
  });
  it('groups by lakh and crore, not million', () => {
    expect(integerToIndianWords(1_23_45_678)).toBe('One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight');
    expect(integerToIndianWords(100_000)).toBe('One Lakh');
    expect(integerToIndianWords(19)).toBe('Nineteen');
    expect(integerToIndianWords(0)).toBe('Zero');
  });
  it('carries paise', () => {
    expect(moneyToIndianWords('12.50')).toBe('Indian Rupee Twelve and Paise Fifty Only');
  });
});
