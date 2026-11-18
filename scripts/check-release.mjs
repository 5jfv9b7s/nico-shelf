import { loadEnv } from 'vite';
import { publicSettings } from './public-pages.mjs';
publicSettings({
  ...loadEnv('production', process.cwd(), ''),
  ...process.env,
  NICO_PUBLIC_LAUNCH: '1',
});
console.log(
  'Public page configuration is complete. Database and live checks are separate; see docs/PUBLIC_BETA.md.',
);
