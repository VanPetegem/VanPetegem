#!/usr/bin/env node
// Builds assets/streak-light.svg and assets/streak-dark.svg: total contributions,
// current streak and longest streak.
//
// Self-hosted on purpose. The third party streak card (streak-stats.demolab.com)
// is rate limited and its images are frequently dropped by GitHub's camo proxy,
// which is why the card rendered blank on the profile. Same data source as the
// activity chart: the public contributions calendar, no token needed.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const USER = process.env.GH_USER ?? process.env.GITHUB_REPOSITORY_OWNER ?? 'VanPetegem';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const THEMES = {
  light: {
    bg: '#FFFFFF',
    border: '#D0D7DE',
    title: '#121214',
    muted: '#57606A',
    faint: '#8C959F',
    panel: '#F6F8FA',
  },
  dark: {
    bg: '#0D1117',
    border: '#30363D',
    title: '#F7F8FA',
    muted: '#8B949E',
    faint: '#6E7681',
    panel: '#161B22',
  },
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseCalendar(html, into) {
  const dateById = new Map();
  for (const m of html.matchAll(
    /data-date="(\d{4}-\d{2}-\d{2})"[^>]*id="(contribution-day-component-[\d-]+)"/g
  )) {
    dateById.set(m[2], m[1]);
  }
  let seen = 0;
  for (const m of html.matchAll(
    /for="(contribution-day-component-[\d-]+)"[^>]*>([^<]*)<\/tool-tip>/g
  )) {
    const date = dateById.get(m[1]);
    if (!date) continue;
    const n = /^(\d+)\s+contribution/.exec(m[2].trim());
    into.set(date, n ? Number(n[1]) : 0);
    seen++;
  }
  return seen;
}

async function fetchYear(user, year) {
  const url = `https://github.com/users/${user}/contributions?from=${year}-01-01&to=${year}-12-31`;
  const res = await fetch(url, { headers: { 'user-agent': 'vanpetegem-profile-streak' } });
  if (!res.ok) throw new Error(`contributions fetch failed for ${year}: HTTP ${res.status}`);
  return res.text();
}

async function fetchAllDays(user) {
  const headers = { 'user-agent': 'vanpetegem-profile-streak', accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(`https://api.github.com/users/${user}`, {
    headers,
  });
  if (!res.ok) throw new Error(`user fetch failed: HTTP ${res.status}`);
  const createdYear = new Date((await res.json()).created_at).getUTCFullYear();

  const today = new Date();
  const counts = new Map();
  for (let y = createdYear; y <= today.getUTCFullYear(); y++) {
    const seen = parseCalendar(await fetchYear(user, y), counts);
    if (seen === 0) throw new Error(`parsed zero days for ${y}; page markup changed`);
  }
  return { counts, createdYear };
}

const iso = d => d.toISOString().slice(0, 10);
const pretty = s => {
  const [y, m, d] = s.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
};

function summarise(counts) {
  const days = [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const today = iso(new Date());
  // Ignore days the calendar lists ahead of today (the year view pads to Dec 31).
  const past = days.filter(([date]) => date <= today);

  const total = past.reduce((s, [, n]) => s + n, 0);

  let longest = { length: 0, start: null, end: null };
  let run = { length: 0, start: null, end: null };
  for (const [date, n] of past) {
    if (n > 0) {
      run = { length: run.length + 1, start: run.length ? run.start : date, end: date };
      if (run.length > longest.length) longest = { ...run };
    } else {
      run = { length: 0, start: null, end: null };
    }
  }

  // Current streak: walk back from today. A zero today does not break it yet.
  const byDate = new Map(past);
  let current = { length: 0, start: null, end: null };
  const cursor = new Date(`${today}T00:00:00Z`);
  if (!byDate.get(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  for (;;) {
    const key = iso(cursor);
    if (!byDate.get(key)) break;
    current = { length: current.length + 1, start: key, end: current.end ?? key };
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  const firstDay = past.find(([, n]) => n > 0)?.[0] ?? past[0][0];
  return { total, current, longest, firstDay, today };
}

function render(s, t, createdYear) {
  const W = 860;
  const H = 190;
  const col = W / 3;
  const valueY = 108;

  const cell = (i, value, label, sub) => {
    const cx = col * i + col / 2;
    return `<text x="${cx.toFixed(1)}" y="${valueY}" text-anchor="middle" font-size="40" font-weight="700" fill="${t.title}">${value}</text>
    <text x="${cx.toFixed(1)}" y="${valueY + 26}" text-anchor="middle" font-size="13" font-weight="600" fill="${t.muted}">${label}</text>
    <text x="${cx.toFixed(1)}" y="${valueY + 46}" text-anchor="middle" font-size="11" fill="${t.faint}">${sub}</text>`;
  };

  const totalRange = `${pretty(s.firstDay)} to present`;
  const currentRange = s.current.length
    ? `${pretty(s.current.start)} to ${pretty(s.current.end)}`
    : 'No active streak';
  const longestRange = s.longest.length
    ? `${pretty(s.longest.start)} to ${pretty(s.longest.end)}`
    : 'None yet';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}" role="img" aria-label="${s.total} total contributions, ${s.current.length} day current streak, ${s.longest.length} day longest streak">
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8" fill="${t.bg}" stroke="${t.border}"/>
  <text x="24" y="34" font-size="16" font-weight="600" fill="${t.title}">Consistency</text>
  <text x="24" y="52" font-size="12" fill="${t.faint}">Contributions since ${createdYear}</text>
  <rect x="${(col + 6).toFixed(1)}" y="64" width="${(col - 12).toFixed(1)}" height="${H - 82}" rx="8" fill="${t.panel}"/>
  ${cell(0, s.total.toLocaleString('en-US'), 'Total contributions', totalRange)}
  ${cell(1, s.current.length, 'Current streak', currentRange)}
  ${cell(2, s.longest.length, 'Longest streak', longestRange)}
</svg>
`;
}

const { counts, createdYear } = await fetchAllDays(USER);
const s = summarise(counts);

await mkdir(join(ROOT, 'assets'), { recursive: true });
for (const [name, theme] of Object.entries(THEMES)) {
  await writeFile(join(ROOT, 'assets', `streak-${name}.svg`), render(s, theme, createdYear));
}

console.log(
  `${USER}: ${s.total} contributions, current ${s.current.length}d, longest ${s.longest.length}d ` +
    `(${s.longest.start} to ${s.longest.end})`
);
