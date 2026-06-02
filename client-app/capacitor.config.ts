import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.driversforu.app',
  appName: 'drivers-for-u',
  webDir: 'out', // Matches standard Next.js static HTML export settings (next export)
  server: {
    androidScheme: 'https',
    cleartext: true, // Enables local loopback communication for sandbox testing
    allowNavigation: ['localhost:3000', '10.0.2.2:*']
  },
  plugins: {
    BackgroundRunner: {
      label: 'com.driversforu.background.worker',
      src: 'background.js',
    }
  }
};

export default config;
