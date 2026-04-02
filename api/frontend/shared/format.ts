export function formatCurrency(amountCents: number | null | undefined): string {
  const safeAmount = Number(amountCents ?? 0);
  return `$${(safeAmount / 100).toFixed(2)}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'N/A';
  }

  return new Date(value).toLocaleDateString();
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return 'N/A';
  }

  return new Date(value).toLocaleString();
}

export function humanize(value: string | null | undefined): string {
  if (!value) {
    return 'Unknown';
  }

  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
