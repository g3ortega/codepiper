import { memo, useState } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
  content: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute top-2 right-2 px-2 py-1 rounded text-[10px] font-mono opacity-0 group-hover/code:opacity-100 transition-opacity bg-white/5 hover:bg-white/10 text-muted-foreground/70 hover:text-foreground border border-white/5"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

const components: Components = {
  // Headings
  h1: ({ children }) => (
    <h1 className="text-lg font-bold text-foreground mt-5 mb-3 pb-2 border-b border-border/40 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-semibold text-foreground mt-5 mb-2 pb-1.5 border-b border-border/30 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-foreground mt-4 mb-2 first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-medium text-foreground/90 mt-3 mb-1.5 first:mt-0">{children}</h4>
  ),

  // Paragraphs
  p: ({ children }) => (
    <p className="text-sm leading-relaxed text-foreground/90 mb-3 last:mb-0">{children}</p>
  ),

  // Strong / Bold
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,

  // Emphasis / Italic
  em: ({ children }) => <em className="italic text-foreground/80">{children}</em>,

  // Inline code
  code: ({ children, className }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      const lang = className?.replace("language-", "") || "";
      const codeText = String(children).replace(/\n$/, "");
      return (
        <div className="group/code relative">
          {lang && (
            <div className="absolute top-0 left-0 px-2.5 py-1 text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider">
              {lang}
            </div>
          )}
          <CopyButton text={codeText} />
          <pre className="overflow-x-auto text-[13px] leading-relaxed p-3 pt-7">
            <code>{codeText}</code>
          </pre>
        </div>
      );
    }
    return (
      <code className="px-1.5 py-0.5 rounded bg-cyan-500/[0.08] text-cyan-300 text-[13px] font-mono border border-cyan-500/10">
        {children}
      </code>
    );
  },

  // Code blocks (pre wrapping code)
  pre: ({ children }) => (
    <pre className="my-3 rounded-lg bg-[#0e1016] border border-border/40 overflow-hidden font-mono text-foreground/90">
      {children}
    </pre>
  ),

  // Links
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 decoration-cyan-400/30 hover:decoration-cyan-300/50 transition-colors"
    >
      {children}
    </a>
  ),

  // Unordered lists
  ul: ({ children }) => (
    <ul className="my-2 ml-1 space-y-1.5 text-sm list-disc list-outside pl-5 marker:text-cyan-500/60">
      {children}
    </ul>
  ),

  // Ordered lists
  ol: ({ children }) => (
    <ol className="my-2 ml-1 space-y-1.5 text-sm list-decimal list-outside pl-5 marker:text-muted-foreground/50">
      {children}
    </ol>
  ),

  // List items
  li: ({ children }) => <li className="text-foreground/90 leading-relaxed">{children}</li>,

  // Blockquotes
  blockquote: ({ children }) => (
    <blockquote className="my-3 pl-4 border-l-2 border-violet-500/30 text-foreground/70 italic">
      {children}
    </blockquote>
  ),

  // Horizontal rules
  hr: () => <hr className="my-4 border-t border-border/40" />,

  // Tables
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-border/40">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted/30 border-b border-border/40">{children}</thead>
  ),
  tbody: ({ children }) => <tbody className="divide-y divide-border/20">{children}</tbody>,
  tr: ({ children }) => <tr className="hover:bg-muted/20 transition-colors">{children}</tr>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left text-xs font-semibold text-foreground/70 uppercase tracking-wider">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="px-3 py-2 text-foreground/80">{children}</td>,

  // Images (unlikely but handle gracefully)
  img: ({ src, alt }) => (
    <img src={src} alt={alt || ""} className="my-3 max-w-full rounded-lg border border-border/20" />
  ),

  // Del (strikethrough)
  del: ({ children }) => <del className="text-muted-foreground/50 line-through">{children}</del>,
};

export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: MarkdownRendererProps) {
  if (!content) return null;

  return (
    <div className="markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
