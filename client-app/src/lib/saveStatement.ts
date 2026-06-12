import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

// saveAndShareCsv persists a CSV statement and surfaces it to the user.
// On native (iOS/Android) it writes to the cache dir via Capacitor Filesystem
// and opens the share sheet (Capacitor Share). On web it falls back to a Blob
// download (or Web Share API when available).
export async function saveAndShareCsv(filename: string, csv: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const written = await Filesystem.writeFile({
      path: filename,
      data: csv,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({
      title: "Earnings Statement",
      text: filename,
      url: written.uri,
      dialogTitle: "Share earnings statement",
    });
    return;
  }

  // Web fallback.
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
