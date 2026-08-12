/**
 * Parses a Russian auction price without turning a dot decimal suffix into
 * extra integer digits. Source pages use both `1 500 000,00` and metadata
 * formats such as `615150.00` / `3796542.4`.
 */
export function parsePrice(text: string): number | undefined {
  if (!text) return undefined;

  let normalized = text.replace(/[^\d,\.]/g, '');
  if (!normalized || !/\d/.test(normalized)) return undefined;

  const commas = [...normalized.matchAll(/,/g)];
  const dots = [...normalized.matchAll(/\./g)];

  if (commas.length > 0) {
    // Russian source pages use a comma as the decimal separator. Dots, if
    // present, are grouping separators (`1.500.000,00`).
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (dots.length > 1) {
    // Multiple dots can only be grouping separators in supported inputs.
    normalized = normalized.replace(/\./g, '');
  } else if (dots.length === 1) {
    const decimalDigits = normalized.length - normalized.lastIndexOf('.') - 1;
    // `1.500` is a grouped integer; `.0`, `.00`, `.4`, `.43` are decimals.
    if (decimalDigits === 3) normalized = normalized.replace('.', '');
  }

  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
