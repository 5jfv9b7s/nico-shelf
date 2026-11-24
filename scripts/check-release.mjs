import { readFileSync } from 'node:fs';
import { loadEnv } from 'vite';
import { publicSettings } from './public-pages.mjs';
publicSettings({
  ...loadEnv('production', process.cwd(), ''),
  ...process.env,
  NICO_PUBLIC_LAUNCH: '1',
});

// Legal pages carry 【要入力：…】 markers for facts only the operator can confirm
// (for example the hosting region). A public launch must not ship them.
const pages = ['privacy.html', 'terms.html', 'help.html'];
const unresolved = pages.filter((name) =>
  readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8').includes('【要入力'),
);
if (unresolved.length) {
  console.error(
    `Unfilled 【要入力】 markers remain in: ${unresolved.map((n) => `public/${n}`).join(', ')}`,
  );
  process.exit(1);
}
console.log(
  'Public page configuration is complete. Database and live checks are separate; see docs/PUBLIC_BETA.md.',
);
