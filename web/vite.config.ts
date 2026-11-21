import { defineConfig } from 'vite';
import { getNetwork } from '@qorechain/sdk';

const proxy = {
  '/qore-api': {
    target: getNetwork('testnet').endpoints.rest,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/qore-api/, ''),
  },
};

export default defineConfig({
  server: { allowedHosts: true, proxy },
  preview: { proxy },
});
