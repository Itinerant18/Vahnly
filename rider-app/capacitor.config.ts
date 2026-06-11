import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.driversforu.rider',
  appName: 'Drivers-for-u',
  webDir: 'out', // Next.js static export (output: "export")
  server: {
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: ['localhost:3000', '10.0.2.2:*'],
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
