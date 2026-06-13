import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.driversforu.driver',
  appName: 'DFU Driver',
  webDir: 'out',
  plugins: {
    BackgroundRunner: {
      label: 'com.driversforu.background.worker',
      src: 'background.js',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#000000',
      showSpinner: false,
    },
  },
};

// Development live-reload: export DEV_SERVER_URL=http://<your-lan-ip>:3001
// NEVER set for production builds — app must serve from bundled assets.
if (process.env.DEV_SERVER_URL) {
  config.server = {
    url: process.env.DEV_SERVER_URL,
    cleartext: true,
  };
}

export default config;
