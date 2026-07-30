export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function uid(): string {
  return crypto.randomUUID();
}

export function shortPath(p: string): string {
  const home = '/Users/';
  if (p.startsWith(home)) {
    const rest = p.slice(home.length);
    const idx = rest.indexOf('/');
    if (idx >= 0) return '~' + rest.slice(idx);
  }
  return p;
}

export function baseName(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  md: 'markdown', mdx: 'markdown',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html',
  py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini',
  xml: 'xml', svg: 'xml', sql: 'sql', graphql: 'graphql',
  rb: 'ruby', php: 'php', swift: 'swift', lua: 'lua', r: 'r',
  dockerfile: 'dockerfile', makefile: 'makefile',
};

export function langForPath(p: string): string {
  const name = baseName(p).toLowerCase();
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile') return 'makefile';
  const ext = name.includes('.') ? name.split('.').pop()! : '';
  return EXT_LANG[ext] ?? 'plaintext';
}

/**
 * Every project gets its own colour so a row is identifiable at a glance,
 * the way a workspace is. Hashed off the id so it never changes between
 * launches and never depends on list order.
 */
const PROJECT_COLORS = [
  '#e0a84d', // amber
  '#5b9cf8', // blue
  '#4ec26a', // green
  '#e06b9b', // pink
  '#b98cf5', // violet
  '#4dc4c0', // teal
  '#f0845a', // orange
];

export function projectColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length];
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
