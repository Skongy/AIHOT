export function monthDays(month: string): string[] {
  const [year, number] = month.split('-').map(Number);
  const length = new Date(Date.UTC(year!, number!, 0)).getUTCDate();
  return Array.from({ length }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
export function moveMonth(month: string, amount: number): string {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year!, number! - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
