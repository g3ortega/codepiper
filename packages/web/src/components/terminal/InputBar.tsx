import { ChevronRight, Loader2, Mic, MicOff, Paperclip, SendHorizonal, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { IMAGE_ATTACHMENT_ACCEPT, validateImageAttachment } from "./attachmentUtils";

const MAX_ROWS = 5;
const MAX_HISTORY = 50;

interface InputBarProps {
  sessionId: string;
  isEnded: boolean;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionConstructorLike {
  new (): SpeechRecognitionLike;
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructorLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  const candidate = (
    window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructorLike;
      webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
    }
  ).SpeechRecognition;
  if (candidate) {
    return candidate;
  }

  return (
    (
      window as Window & {
        webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
      }
    ).webkitSpeechRecognition ?? null
  );
}

function supportsMediaRecorderTranscription(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

function getPreferredRecordingMimeType(): string | undefined {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return undefined;
  }

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];

  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function InputBar({ sessionId, isEnded }: InputBarProps) {
  const storageKey = `codepiper:input:${sessionId}`;

  const [inputText, setInputText] = useState(() => {
    try {
      return sessionStorage.getItem(storageKey) ?? "";
    } catch {
      return "";
    }
  });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceFallbackSupported, setVoiceFallbackSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceProcessing, setVoiceProcessing] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const voiceRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const draftRef = useRef("");

  // Persist input text to sessionStorage
  useEffect(() => {
    try {
      if (inputText) {
        sessionStorage.setItem(storageKey, inputText);
      } else {
        sessionStorage.removeItem(storageKey);
      }
    } catch {
      // sessionStorage may be full or disabled
    }
  }, [inputText, storageKey]);

  // No auto-focus — keyboard events pass through to the session via the
  // global keydown handler. Users click the input bar to focus it explicitly.

  // Place cursor at end when mounting with restored text
  useEffect(() => {
    const el = textareaRef.current;
    if (el && el.value.length > 0) {
      el.selectionStart = el.value.length;
      el.selectionEnd = el.value.length;
    }
  }, []); // eslint-disable-line -- mount only

  // Auto-grow textarea
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const maxHeight = lineHeight * MAX_ROWS;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, []);

  const isMultiline = inputText.includes("\n");

  // Adjust on mount (for restored text) and when text changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: inputText drives re-measurement when text changes (e.g. history navigation)
  useLayoutEffect(() => {
    adjustHeight();
  }, [inputText, adjustHeight]);

  // Stage an image for upload
  const stageImage = useCallback(
    (file: File) => {
      const validationError = validateImageAttachment(file);
      if (validationError) {
        setSendError(validationError);
        return;
      }
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
      setPendingImage(file);
      setImagePreviewUrl(URL.createObjectURL(file));
    },
    [imagePreviewUrl]
  );

  const clearImage = useCallback(() => {
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setPendingImage(null);
    setImagePreviewUrl(null);
  }, [imagePreviewUrl]);

  // Revoke preview URL on unmount to prevent memory leaks
  const imagePreviewUrlRef = useRef(imagePreviewUrl);
  imagePreviewUrlRef.current = imagePreviewUrl;
  useEffect(() => {
    return () => {
      if (imagePreviewUrlRef.current) {
        URL.revokeObjectURL(imagePreviewUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setVoiceSupported(Boolean(getSpeechRecognitionConstructor()));
    setVoiceFallbackSupported(supportsMediaRecorderTranscription());
  }, []);

  const appendTranscriptToInput = useCallback((transcript: string) => {
    const trimmed = transcript.trim();
    if (!trimmed) {
      return;
    }
    setInputText((prev) => {
      const prefix = prev.trim().length > 0 ? `${prev} ` : prev;
      return `${prefix}${trimmed}`;
    });
  }, []);

  const releaseVoiceMediaResources = useCallback(() => {
    mediaChunksRef.current = [];
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          // best-effort cleanup
        }
      }
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      if (voiceRecognitionRef.current) {
        try {
          voiceRecognitionRef.current.stop();
        } catch {
          // ignore cleanup errors
        }
      }
      releaseVoiceMediaResources();
    };
  }, [releaseVoiceMediaResources]);

  const handleToggleVoice = useCallback(() => {
    if (sending || isEnded || voiceProcessing) return;

    if (voiceListening) {
      try {
        voiceRecognitionRef.current?.stop();
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        } else {
          releaseVoiceMediaResources();
        }
      } finally {
        setVoiceListening(false);
      }
      return;
    }

    const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
    if (SpeechRecognitionCtor) {
      if (!voiceRecognitionRef.current) {
        const recognition = new SpeechRecognitionCtor();
        recognition.lang = navigator.language || "en-US";
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event) => {
          const chunks: string[] = [];
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result?.isFinal) {
              const transcript = result[0]?.transcript?.trim();
              if (transcript) {
                chunks.push(transcript);
              }
            }
          }
          if (chunks.length > 0) {
            appendTranscriptToInput(chunks.join(" "));
          }
        };

        recognition.onerror = (event) => {
          const code = event.error ?? "unknown";
          setSendError(`Voice input failed (${code}).`);
          setVoiceListening(false);
        };
        recognition.onend = () => {
          setVoiceListening(false);
        };

        voiceRecognitionRef.current = recognition;
      }

      try {
        setSendError(null);
        voiceRecognitionRef.current.start();
        setVoiceListening(true);
      } catch (error) {
        setVoiceListening(false);
        setSendError(error instanceof Error ? error.message : "Unable to start voice input");
      }
      return;
    }

    if (!voiceFallbackSupported) {
      setVoiceSupported(false);
      setSendError("Voice input is not supported on this browser.");
      return;
    }

    void (async () => {
      try {
        setSendError(null);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        mediaChunksRef.current = [];

        const mimeType = getPreferredRecordingMimeType();
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            mediaChunksRef.current.push(event.data);
          }
        };
        recorder.onerror = () => {
          setSendError("Voice recording failed.");
          setVoiceListening(false);
        };
        recorder.onstop = () => {
          const chunks = [...mediaChunksRef.current];
          releaseVoiceMediaResources();
          setVoiceListening(false);
          if (chunks.length === 0) {
            return;
          }

          const blobType = recorder.mimeType || mimeType || "audio/webm";
          const audioBlob = new Blob(chunks, { type: blobType });
          const audioExtension = blobType.includes("ogg")
            ? "ogg"
            : blobType.includes("mp4")
              ? "m4a"
              : "webm";
          setVoiceProcessing(true);
          void api
            .transcribeAudio(sessionId, audioBlob, `voice-input.${audioExtension}`)
            .then(({ transcript }) => {
              appendTranscriptToInput(transcript);
            })
            .catch((error) => {
              setSendError(error instanceof Error ? error.message : "Voice transcription failed");
            })
            .finally(() => {
              setVoiceProcessing(false);
            });
        };

        mediaRecorderRef.current = recorder;
        recorder.start(250);
        setVoiceListening(true);
      } catch (error) {
        releaseVoiceMediaResources();
        setVoiceListening(false);
        setSendError(error instanceof Error ? error.message : "Unable to start voice recording");
      }
    })();
  }, [
    appendTranscriptToInput,
    isEnded,
    releaseVoiceMediaResources,
    sending,
    sessionId,
    voiceFallbackSupported,
    voiceListening,
    voiceProcessing,
  ]);

  const handleSend = useCallback(async () => {
    const hasText = inputText.trim().length > 0;
    const hasImage = pendingImage !== null;
    if (!(hasText || hasImage) || sending || isEnded) return;

    try {
      setSending(true);
      setSendError(null);

      let finalText = inputText;

      if (pendingImage) {
        const { path } = await api.uploadImage(sessionId, pendingImage);
        finalText = hasText ? `${inputText}\n\n${path}` : path;
        clearImage();
      }

      // Use daemon's newline path for submit because it flushes buffered tmux writes
      // before sending Enter, avoiding races where Enter can arrive first.
      await api.sendText(sessionId, { text: finalText, newline: true });

      // Add to history
      if (hasText) {
        historyRef.current.push(inputText);
        if (historyRef.current.length > MAX_HISTORY) {
          historyRef.current.shift();
        }
      }
      historyIndexRef.current = -1;
      draftRef.current = "";

      setInputText("");
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
      textareaRef.current?.focus();
    } catch (err) {
      console.error("Failed to send:", err);
      setSendError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }, [inputText, pendingImage, sending, isEnded, sessionId, clearImage, storageKey]);

  // Auto-submit when an image is staged
  // biome-ignore lint/correctness/useExhaustiveDependencies: only fire when pendingImage changes
  useEffect(() => {
    if (pendingImage && !sending) {
      handleSend();
    }
  }, [pendingImage]);

  const isOnFirstLine = useCallback((): boolean => {
    const el = textareaRef.current;
    if (!el) return true;
    return !el.value.substring(0, el.selectionStart).includes("\n");
  }, []);

  const isOnLastLine = useCallback((): boolean => {
    const el = textareaRef.current;
    if (!el) return true;
    return !el.value.substring(el.selectionStart).includes("\n");
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter (no Shift) or Cmd/Ctrl+Enter → submit
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
        return;
      }

      // Escape → clear input
      if (e.key === "Escape") {
        if (inputText) {
          e.preventDefault();
          setInputText("");
          historyIndexRef.current = -1;
          draftRef.current = "";
        }
        return;
      }

      // ArrowUp → command history (when on first line or empty)
      if (e.key === "ArrowUp" && (inputText === "" || isOnFirstLine())) {
        const history = historyRef.current;
        if (history.length === 0) return;

        e.preventDefault();
        if (historyIndexRef.current === -1) {
          draftRef.current = inputText;
        }
        const newIndex = Math.min(historyIndexRef.current + 1, history.length - 1);
        historyIndexRef.current = newIndex;
        setInputText(history[history.length - 1 - newIndex]);
        return;
      }

      // ArrowDown → command history (when on last line)
      if (e.key === "ArrowDown" && historyIndexRef.current >= 0 && isOnLastLine()) {
        e.preventDefault();
        const newIndex = historyIndexRef.current - 1;
        historyIndexRef.current = newIndex;
        if (newIndex < 0) {
          setInputText(draftRef.current);
        } else {
          const history = historyRef.current;
          setInputText(history[history.length - 1 - newIndex]);
        }
        return;
      }
    },
    [handleSend, inputText, isOnFirstLine, isOnLastLine]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) stageImage(file);
          return;
        }
      }
    },
    [stageImage]
  );

  const voiceAvailable = voiceSupported || voiceFallbackSupported;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop zone for image upload
    <div
      className="border-t border-border px-2.5 md:px-4 py-2.5 md:py-3 bg-card/85 backdrop-blur-sm"
      style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom, 0px))" }}
      role="presentation"
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer.files[0];
        if (file?.type.startsWith("image/")) {
          stageImage(file);
        }
      }}
    >
      {/* Send error */}
      {sendError && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs">
          <span className="truncate">{sendError}</span>
          <button
            type="button"
            onClick={() => setSendError(null)}
            className="shrink-0 hover:text-destructive/80"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      {/* Image preview */}
      {pendingImage && imagePreviewUrl && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <div className="relative group/preview">
            <img
              src={imagePreviewUrl}
              alt="Upload preview"
              className="h-16 w-16 object-cover rounded-md border border-border"
            />
            <button
              type="button"
              onClick={clearImage}
              className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-background border border-border flex items-center justify-center opacity-0 group-hover/preview:opacity-100 transition-opacity hover:bg-destructive hover:border-destructive hover:text-destructive-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="text-xs text-muted-foreground/60 font-mono min-w-0">
            <div className="truncate">{pendingImage.name}</div>
            <div>{(pendingImage.size / 1024).toFixed(0)} KB</div>
          </div>
        </div>
      )}

      <div
        className={`flex gap-2 md:gap-3 group rounded-lg border border-border/60 bg-muted/30 focus-within:border-cyan-500/40 focus-within:bg-muted/50 focus-within:shadow-[0_0_0_1px_rgba(6,182,212,0.1)] transition-all px-2.5 md:px-3 py-2 ${
          isMultiline ? "items-end" : "items-center"
        }`}
      >
        <ChevronRight
          className={`h-4 w-4 text-cyan-500/30 shrink-0 group-focus-within:text-cyan-400 transition-colors ${
            isMultiline ? "self-start mt-[5px]" : ""
          }`}
        />
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder={
            pendingImage ? "Add a message (optional)..." : "Message... (Shift+Enter for new line)"
          }
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={sending}
          className="flex-1 bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground/40 outline-none min-w-0 resize-none overflow-y-auto leading-[20px]"
          style={{ maxHeight: `${20 * MAX_ROWS}px` }}
        />
        {(inputText.trim() || pendingImage) && (
          <kbd className="hidden sm:inline text-[10px] text-muted-foreground/40 font-mono border border-border rounded px-1.5 py-0.5 bg-muted/50 shrink-0">
            Enter
          </kbd>
        )}
        {/* File browse button */}
        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_ATTACHMENT_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) stageImage(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Attach image"
          className={`h-9 w-9 md:h-8 md:w-8 rounded-lg flex items-center justify-center transition-all shrink-0 ${
            pendingImage
              ? "bg-cyan-500/20 text-cyan-400"
              : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent/60"
          }`}
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleToggleVoice}
          disabled={!voiceAvailable || sending || voiceProcessing}
          title={
            voiceProcessing
              ? "Transcribing voice input..."
              : voiceAvailable
                ? voiceListening
                  ? "Stop voice input"
                  : voiceSupported
                    ? "Start voice input"
                    : "Start voice recording"
                : "Voice input unsupported on this browser"
          }
          className={`h-9 w-9 md:h-8 md:w-8 rounded-lg flex items-center justify-center transition-all shrink-0 ${
            voiceListening
              ? "bg-emerald-500/20 text-emerald-300"
              : voiceProcessing
                ? "bg-cyan-500/20 text-cyan-300"
                : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent/60"
          } disabled:opacity-30 disabled:cursor-not-allowed`}
        >
          {voiceListening ? (
            <MicOff className="h-4 w-4" />
          ) : voiceProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !(inputText.trim() || pendingImage)}
          className="h-9 w-9 md:h-8 md:w-8 rounded-lg flex items-center justify-center bg-cyan-500/10 text-cyan-400/60 hover:bg-cyan-500/20 hover:text-cyan-400 active:bg-cyan-500/30 disabled:opacity-20 disabled:cursor-not-allowed transition-all shrink-0"
        >
          <SendHorizonal className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
