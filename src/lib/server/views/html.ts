/** Primitives de rendu partagées par toutes les vues. */

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function toLabel(name: string): string {
  return name.replace(/([A-Z])/g, ' $1').trim();
}

export function adjustColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, Math.min(255, (num >> 16) + amt));
  const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amt));
  const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
  return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
}

export function formatValue(value: any, type: string): string {
  if (value === null || value === undefined) return '<span style="color:#94a3b8">—</span>';
  
  if (type === 'DateTime') {
    return new Date(value).toLocaleString();
  }
  
  if (type === 'Boolean') {
    return value ? '✓' : '✗';
  }
  
  const str = String(value);
  if (str.length > 50) {
    return escapeHtml(str.slice(0, 50)) + '...';
  }
  
  return escapeHtml(str);
}
