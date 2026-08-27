#!/usr/bin/env node
// Builds assets/activity-light.svg and assets/activity-dark.svg: a 12 month
// bar chart of GitHub contributions.
//
// Source is the public contributions calendar at
// https://github.com/users/<login>/contributions, which needs no token and
// already reflects the "include private contributions on my profile" setting,
// so the numbers match the streak card and the profile page.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const USER = process.env.GH_USER ?? process.env.GITHUB_REPOSITORY_OWNER ?? 'VanPetegem';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MONTHS = 12;

const THEMES = {
  light: {
    bg: '#FFFFFF',
    border: '#D0D7DE',
    title: '#121214',
    muted: '#57606A',
    faint: '#8C959F',
    bar: '#121214',
    barIdle: '#D8DEE4',
    grid: '#EAEEF2',
  },
  dark: {
    bg: '#0D1117',
    border: '#30363D',
    title: '#F7F8FA',
    muted: '#8B949E',
    faint: '#6E7681',
    bar: '#F7F8FA',
    barIdle: '#21262D',
    grid: '#1B212A',
  },
};

async function fetchDailyCounts(user) {
  const res = await fetch(`https://github.com/users/${user}/contributions`, {
    headers: { 'user-agent': 'vanpetegem-profile-activity' },
  });
  if (!res.ok) throw new Error(`contributions fetch failed: HTTP ${res.status}`);
  const html = await res.text();

  const dateById = new Map();
  for (const m of html.matchAll(
    /data-date="(\d{4}-\d{2}-\d{2})"[^>]*id="(contribution-day-component-[\d-]+)"/g
  )) {
    dateById.set(m[2], m[1]);
  }

  const counts = new Map();
  for (const m of html.matchAll(
    /for="(contribution-day-component-[\d-]+)"[^>]*>([^<]*)<\/tool-tip>/g
  )) {
    const date = dateById.get(m[1]);
    if (!date) continue;
    const n = /^(\d+)\s+contribution/.exec(m[2].trim());
    counts.set(date, n ? Number(n[1]) : 0);
  }

  if (counts.size === 0) throw new Error('parsed zero days; page markup changed');
  return counts;
}

// Last MONTHS calendar months, oldest first, ending with the current month.
function bucketByMonth(counts) {
  const latest = [...counts.keys()].sort().at(-1);
  const [ly, lm] = latest.split('-').map(Number);

  const buckets = [];
  for (let i = MONTHS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ly, lm - 1 - i, 1));
    buckets.push({
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(),
      total: 0,
    });
  }

  const byKey = new Map(buckets.map(b => [b.key, b]));
  for (const [date, n] of counts) {
    const b = byKey.get(date.slice(0, 7));
    if (b) b.total += n;
  }
  return buckets;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

function niceCeil(n) {
  if (n <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(n));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (n <= step * mag) return step * mag;
  }
  return 10 * mag;
}

function render(buckets, t) {
  const W = 860;
  const H = 260;
  const padL = 52;
  const padR = 24;
  const padT = 68;
  const padB = 52;

  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const peak = Math.max(...buckets.map(b => b.total));
  const max = niceCeil(peak);
  const total = buckets.reduce((s, b) => s + b.total, 0);

  const slot = plotW / buckets.length;
  const barW = Math.min(38, slot * 0.52);

  const ticks = [0, 0.5, 1].map(f => Math.round(max * f));
  const gridLines = ticks
    .map(v => {
      const y = padT + plotH - (v / max) * plotH;
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + plotW}" y2="${y.toFixed(1)}" stroke="${t.grid}" stroke-width="1"/>
    <text x="${padL - 12}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${t.faint}">${v}</text>`;
    })
    .join('\n    ');

  const bars = buckets
    .map((b, i) => {
      const x = padL + slot * i + (slot - barW) / 2;
      const h = b.total === 0 ? 2 : Math.max(3, (b.total / max) * plotH);
      const y = padT + plotH - h;
      const r = Math.min(3, h / 2);
      const label = MONTH_NAMES[b.month];
      const showYear = i === 0 || b.month === 0;
      const cx = x + barW / 2;

      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="${r.toFixed(1)}" fill="${b.total === 0 ? t.barIdle : t.bar}"/>
    <text x="${cx.toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="${t.muted}">${b.total || ''}</text>
    <text x="${cx.toFixed(1)}" y="${padT + plotH + 20}" text-anchor="middle" font-size="12" fill="${t.muted}">${label}</text>${
      showYear
        ? `\n    <text x="${cx.toFixed(1)}" y="${padT + plotH + 36}" text-anchor="middle" font-size="10" fill="${t.faint}">${b.year}</text>`
        : ''
    }`;
    })
    .join('\n    ');

  const first = buckets[0];
  const last = buckets.at(-1);
  const range = `${MONTH_NAMES[first.month]} ${first.year} to ${MONTH_NAMES[last.month]} ${last.year}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}" role="img" aria-label="Contributions by month, ${range}">
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8" fill="${t.bg}" stroke="${t.border}"/>
  <text x="${padL - 28}" y="34" font-size="16" font-weight="600" fill="${t.title}">Contributions by month</text>
  <text x="${padL - 28}" y="52" font-size="12" fill="${t.faint}">${range}</text>
  <text x="${W - padR}" y="34" text-anchor="end" font-size="16" font-weight="600" fill="${t.title}">${total.toLocaleString('en-US')}</text>
  <text x="${W - padR}" y="52" text-anchor="end" font-size="12" fill="${t.faint}">total</text>
  <g>
    ${gridLines}
  </g>
  <g>
    ${bars}
  </g>
</svg>
`;
}

const counts = await fetchDailyCounts(USER);
const buckets = bucketByMonth(counts);

await mkdir(join(ROOT, 'assets'), { recursive: true });
for (const [name, theme] of Object.entries(THEMES)) {
  await writeFile(join(ROOT, 'assets', `activity-${name}.svg`), render(buckets, theme));
}

console.log(
  `${USER}: ${counts.size} days, ${buckets.length} months, ` +
    `${buckets.reduce((s, b) => s + b.total, 0)} contributions`
);
console.log(buckets.map(b => `${b.key} ${b.total}`).join('  '));
