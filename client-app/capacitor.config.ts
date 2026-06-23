import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vahnly.driver',
  appName: 'Vahnly Driver',
  webDir: 'out',
  plugins: {
    // Native Google Sign-In. The provider must also be enabled in the Firebase console, and
    // each platform needs its OAuth client config (google-services.json / GoogleService-Info.plist).
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['google.com', 'phone'],
    },
    BackgroundRunner: {
      label: 'com.vahnly.background.worker',
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
