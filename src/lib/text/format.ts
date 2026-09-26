// Longest form is five characters, so the layout is sized once. Decimals are
// truncated, not rounded: 9.96M stays "9.9M".
function ladder(n: number): string {
  if (n >= 1e12) return "999B+";
  for (const [unit, size] of [["B", 1e9], ["M", 1e6], ["k", 1e3]] as const) {
    if (n < size) continue;
    const v = n / size;
    if (unit !== "k" && v < 10) return `${(Math.floor(v * 10) / 10).toFixed(1)}${unit}`;
    return `${Math.floor(v)}${unit}`;
  }
  return String(n);
}
export const formatCount = (n: number): string => (n < 10_000 ? String(n) : ladder(n));
export const formatTokens = (n: number): string => (n < 1000 ? String(n) : ladder(n));

export const plural = (n: number, one: string, many = `${one}s`, count = formatCount): string => `${count(n)} ${n === 1 ? one : many}`;
