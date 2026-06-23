import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vahnly.rider',
  appName: 'Vahnly',
  webDir: 'out',
  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['google.com'],
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

// Development live-reload: export DEV_SERVER_URL=http://<your-lan-ip>:3002
// NEVER set for production builds — app must serve from bundled assets.
if (process.env.DEV_SERVER_URL) {
  config.server = {
    url: process.env.DEV_SERVER_URL,
    cleartext: true,
  };
}

export default config;
