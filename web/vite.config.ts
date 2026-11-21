import { defineConfig } from 'vite';
import { getNetwork } from '@qorechain/sdk';

const proxy = {
  '/qore-api': {
    target: getNetwork('testnet').endpoints.rest,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/qore-api/, ''),
  },
};

// Extra hostnames (beyond localhost) allowed to reach the dev/preview server, e.g. a forwarded preview domain.
const allowedHosts = (process.env.TUVYY_ALLOWED_HOSTS ?? '.preview.devinapps.com')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

export default defineConfig({
  server: { allowedHosts, proxy },
  preview: { allowedHosts, proxy },
});
