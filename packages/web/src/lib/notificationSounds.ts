export const BUILTIN_NOTIFICATION_SOUND_DEFAULT = "/sounds/codepiper-soft-chime.wav";

export interface NotificationEventOption {
  key: string;
  label: string;
}

export const KNOWN_NOTIFICATION_EVENT_OPTIONS: NotificationEventOption[] = [
  { key: "session.turn_completed", label: "Turn completed" },
  { key: "session.permission_required", label: "Permission required" },
  { key: "session.input_required", label: "Input required" },
];

export const MAX_NOTIFICATION_SOUND_BYTES = 512 * 1024;

export function resolveNotificationSoundSource(
  soundMap: Record<string, string>,
  eventType: string
): string {
  return soundMap[eventType] || soundMap.default || BUILTIN_NOTIFICATION_SOUND_DEFAULT;
}

export function isLikelyAudioFile(file: File): boolean {
  if (file.type.startsWith("audio/")) {
    return true;
  }
  return /\.(mp3|wav|ogg|m4a|aac|webm|flac)$/i.test(file.name);
}
