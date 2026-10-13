import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.trazo.mobile',
  appName: 'Trazo',
  webDir: 'dist',
  android: {
    // Solo para desarrollo contra una API local sin HTTPS (ver docs/05-plataformas.md).
    allowMixedContent: process.env.CAP_ALLOW_HTTP === '1',
  },
  server: {
    androidScheme: 'https',
    // Solo desarrollo: permite una API http (p. ej. http://10.0.2.2:3000 desde el emulador).
    cleartext: process.env.CAP_ALLOW_HTTP === '1',
  },
};

export default config;
