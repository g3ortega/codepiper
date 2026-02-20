import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface DiffViewerProps {
  original: string;
  modified: string;
  filePath: string;
  inline?: boolean;
  sessionId?: string;
  /** Git refs for image loading (e.g. "HEAD", ":0", "abc123^", "abc123") */
  originalRef?: string;
  modifiedRef?: string;
}

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "bmp",
  "avif",
]);

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "scss",
  html: "html",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  py: "python",
  rs: "rust",
  go: "go",
  rb: "ruby",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  sql: "sql",
  graphql: "graphql",
  svg: "xml",
};

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return EXT_TO_LANG[ext] || "plaintext";
}

function isImageFile(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.has(ext);
}

// Lazy-load Monaco only when a diff is actually viewed
const LazyMonacoDiffViewer = lazy(async () => {
  // Run setup before importing the React wrapper
  await import("@/lib/monacoSetup");
  const { DiffEditor } = await import("@monaco-editor/react");

  return {
    default: function MonacoDiffViewer({
      original,
      modified,
      filePath,
      inline,
      monacoTheme,
    }: {
      original: string;
      modified: string;
      filePath: string;
      inline?: boolean;
      monacoTheme: "vs" | "vs-dark";
    }) {
      const editorRef = useRef<any>(null);

      const handleMount = useCallback((editorInstance: unknown) => {
        editorRef.current = editorInstance;
        requestAnimationFrame(() => {
          (editorInstance as { layout: () => void }).layout();
        });
      }, []);

      // Detach models before unmount to prevent
      // "TextModel got disposed before DiffEditorWidget model got reset"
      useEffect(() => {
        return () => {
          if (editorRef.current) {
            try {
              editorRef.current.getModifiedEditor().setModel(null);
              editorRef.current.getOriginalEditor().setModel(null);
            } catch {
              // ignore cleanup errors
            }
            editorRef.current = null;
          }
        };
      }, []);

      return (
        <DiffEditor
          key={filePath}
          original={original}
          modified={modified}
          language={detectLanguage(filePath)}
          theme={monacoTheme}
          height="100%"
          onMount={handleMount}
          options={{
            readOnly: true,
            renderSideBySide: !inline,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 12,
            lineNumbers: "on",
            folding: true,
            wordWrap: "off",
            contextmenu: false,
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
          }}
        />
      );
    },
  };
});

function DiffLoading() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex items-center gap-3 text-muted-foreground">
        <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
        <span className="text-sm">Loading editor...</span>
      </div>
    </div>
  );
}

export function DiffViewer({
  original,
  modified,
  filePath,
  inline,
  sessionId,
  originalRef,
  modifiedRef,
}: DiffViewerProps) {
  const { theme } = useTheme();

  if (isImageFile(filePath) && sessionId) {
    return (
      <ImageDiffViewer
        filePath={filePath}
        sessionId={sessionId}
        originalRef={originalRef}
        modifiedRef={modifiedRef}
        hasOriginal={original !== ""}
        hasModified={modified !== ""}
      />
    );
  }

  return (
    <Suspense fallback={<DiffLoading />}>
      <LazyMonacoDiffViewer
        original={original}
        modified={modified}
        filePath={filePath}
        inline={inline}
        monacoTheme={theme.monacoTheme}
      />
    </Suspense>
  );
}

function useImageBlobUrl(
  sessionId: string,
  ref: string | undefined,
  filePath: string,
  enabled: boolean
) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!(enabled && ref)) {
      setUrl(null);
      setLoading(false);
      setError(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);

    api.getGitFileRawBlob(sessionId, ref, filePath).then(
      (blob) => {
        if (cancelled) return;
        if (blob) {
          setUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(blob);
          });
        } else {
          setError(true);
        }
        setLoading(false);
      },
      () => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      }
    );

    return () => {
      cancelled = true;
      setUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [sessionId, ref, filePath, enabled]);

  return { url, loading, error };
}

function ImageDiffViewer({
  filePath,
  sessionId,
  originalRef,
  modifiedRef,
  hasOriginal,
  hasModified,
}: {
  filePath: string;
  sessionId: string;
  originalRef?: string;
  modifiedRef?: string;
  hasOriginal: boolean;
  hasModified: boolean;
}) {
  const fileName = filePath.split("/").pop() || filePath;

  // For unstaged changes, modifiedRef is undefined (working tree can't be fetched via git show)
  const canFetchModified = hasModified && !!modifiedRef;
  const orig = useImageBlobUrl(sessionId, originalRef, filePath, hasOriginal);
  const mod = useImageBlobUrl(sessionId, modifiedRef, filePath, canFetchModified);

  const isLoading = (hasOriginal && orig.loading) || (canFetchModified && mod.loading);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          <span className="text-sm">Loading image...</span>
        </div>
      </div>
    );
  }

  // Unstaged image: can't fetch working tree version via git show
  if (hasModified && !modifiedRef && orig.url) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
        <ImagePanel url={orig.url} label={`${fileName} (HEAD)`} />
        <p className="text-xs text-muted-foreground">
          Working tree changes — stage the file to preview the updated image
        </p>
      </div>
    );
  }

  // Both failed or neither available
  if (!(orig.url || mod.url)) {
    const hasFailed = (hasOriginal && orig.error) || (canFetchModified && mod.error);
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center">
          <p className="text-sm mb-1">{hasFailed ? "Cannot preview image diff" : "Binary file"}</p>
          <p className="text-xs text-muted-foreground/50">
            {hasFailed ? "Binary file: " : ""}
            {fileName}
          </p>
        </div>
      </div>
    );
  }

  // New file (no original)
  if (!orig.url && mod.url) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
        <span className="text-xs font-medium text-green-400 bg-green-500/10 px-2 py-0.5 rounded">
          Added
        </span>
        <ImagePanel url={mod.url} label={fileName} />
      </div>
    );
  }

  // Deleted file (no modified)
  if (orig.url && !mod.url) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
        <span className="text-xs font-medium text-red-400 bg-red-500/10 px-2 py-0.5 rounded">
          Deleted
        </span>
        <ImagePanel url={orig.url} label={fileName} className="opacity-50" />
      </div>
    );
  }

  // Side-by-side diff (both urls guaranteed non-null at this point)
  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col items-center justify-center border-r border-border/40 p-4 gap-3">
        <span className="text-xs text-muted-foreground font-mono">Original</span>
        <ImagePanel url={orig.url as string} label={fileName} />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center p-4 gap-3">
        <span className="text-xs text-muted-foreground font-mono">Modified</span>
        <ImagePanel url={mod.url as string} label={fileName} />
      </div>
    </div>
  );
}

function ImagePanel({ url, label, className }: { url: string; label: string; className?: string }) {
  return (
    <div className={cn("max-w-full max-h-[80%] overflow-auto", className)}>
      <img
        src={url}
        alt={label}
        className="max-w-full max-h-[60vh] object-contain rounded border border-border/30 bg-[repeating-conic-gradient(#1e2028_0%_25%,#1a1c24_0%_50%)_0_0/16px_16px]"
      />
    </div>
  );
}
