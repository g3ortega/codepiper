import { useCallback, useEffect, useRef, useState } from "react";

interface Feature {
  icon: string;
  title: string;
  description: string;
  color: string;
  claudeOnly?: boolean;
}

interface Props {
  features: Feature[];
}

const GAP = 24; // px — matches Tailwind gap-6
const AUTO_PLAY_MS = 4000;

function getCardsPerView(): number {
  if (typeof window === "undefined") return 3;
  if (window.innerWidth >= 1024) return 3;
  if (window.innerWidth >= 768) return 2;
  return 1;
}

const colorMap: Record<string, { bg: string; text: string }> = {
  primary: { bg: "rgba(6, 182, 212, 0.1)", text: "#06b6d4" },
  secondary: { bg: "rgba(139, 92, 246, 0.1)", text: "#8b5cf6" },
  emerald: { bg: "rgba(16, 185, 129, 0.1)", text: "#10b981" },
  amber: { bg: "rgba(245, 158, 11, 0.1)", text: "#f59e0b" },
};

function IconBox({ html, color }: { html: string; color: string }) {
  return (
    <div
      className="w-10 h-10 rounded-lg flex items-center justify-center mb-4 transition-colors duration-200"
      style={{
        backgroundColor: colorMap[color]?.bg,
        color: colorMap[color]?.text,
      }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: SVGs are hardcoded string literals, not user input
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function FeaturesCarousel({ features }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [cardsPerView, setCardsPerView] = useState(3);
  const [isPaused, setIsPaused] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const touchStartX = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const total = features.length;
  const maxIndex = Math.max(0, total - cardsPerView);

  // Responsive cardsPerView
  useEffect(() => {
    setCardsPerView(getCardsPerView());
    const onResize = () => {
      const next = getCardsPerView();
      setCardsPerView(next);
      setCurrentIndex((prev) => Math.min(prev, Math.max(0, total - next)));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [total]);

  // Reduced motion
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const next = useCallback(() => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setCurrentIndex((i) => (i >= maxIndex ? 0 : i + 1));
    setTimeout(() => setIsTransitioning(false), 500);
  }, [maxIndex, isTransitioning]);

  const prev = useCallback(() => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setCurrentIndex((i) => (i <= 0 ? maxIndex : i - 1));
    setTimeout(() => setIsTransitioning(false), 500);
  }, [maxIndex, isTransitioning]);

  const goTo = useCallback(
    (index: number) => {
      if (isTransitioning) return;
      setIsTransitioning(true);
      setCurrentIndex(Math.max(0, Math.min(index, maxIndex)));
      setTimeout(() => setIsTransitioning(false), 500);
    },
    [maxIndex, isTransitioning]
  );

  // Auto-play
  useEffect(() => {
    if (prefersReducedMotion || isPaused) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    timerRef.current = setInterval(next, AUTO_PLAY_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, prefersReducedMotion, next]);

  // Keyboard navigation
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [next, prev]);

  // Touch swipe
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const delta = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(delta) > 50) {
      if (delta > 0) next();
      else prev();
    }
  };

  // Calculate translateX
  const cardWidthPercent = 100 / cardsPerView;
  const gapOffset = (GAP * (cardsPerView - 1)) / cardsPerView;
  const translateX = -(currentIndex * cardWidthPercent);
  const gapTranslate = currentIndex * gapOffset + currentIndex * (GAP / cardsPerView);

  const dotCount = maxIndex + 1;

  const arrowStyle: React.CSSProperties = {
    background: "rgba(22, 27, 34, 0.9)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.04) inset",
  };

  return (
    <section
      ref={containerRef}
      className="group/carousel"
      aria-label="Feature carousel"
      aria-roledescription="carousel"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Flex row: [prev arrow] [card track] [next arrow] */}
      <div className="flex items-center">
        {/* Prev Arrow — own column, hidden on mobile */}
        <div className="hidden lg:flex shrink-0 w-14 items-center justify-center">
          <button
            type="button"
            onClick={prev}
            aria-label="Previous features"
            className="w-10 h-10 rounded-full flex items-center justify-center opacity-0 group-hover/carousel:opacity-100 transition-all duration-200 cursor-pointer hover:scale-110"
            style={arrowStyle}
          >
            <svg
              className="w-4 h-4 text-[#6b7280] group-hover/carousel:text-[#d1d5db] transition-colors"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>

        {/* Card Track */}
        <div className="overflow-hidden flex-1 min-w-0">
          <div
            className="flex"
            style={{
              gap: `${GAP}px`,
              transform: `translateX(calc(${translateX}% - ${gapTranslate}px))`,
              transition: prefersReducedMotion
                ? "none"
                : "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            {features.map((feature, i) => (
              <div
                key={i}
                className="feature-card group relative p-6 rounded-xl border border-border bg-card/60 backdrop-blur-sm hover:-translate-y-1 transition-all duration-200"
                data-color={feature.color}
                style={{
                  flexShrink: 0,
                  width: `calc(${cardWidthPercent}% - ${gapOffset}px)`,
                }}
              >
                <IconBox html={feature.icon} color={feature.color} />

                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-base font-semibold text-foreground">{feature.title}</h3>
                  {feature.claudeOnly && (
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium border"
                      style={{
                        backgroundColor: "rgba(245, 158, 11, 0.08)",
                        color: "rgba(245, 158, 11, 0.7)",
                        borderColor: "rgba(245, 158, 11, 0.15)",
                      }}
                    >
                      <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="4" />
                      </svg>
                      Claude Code
                    </span>
                  )}
                </div>

                <p className="text-sm text-muted leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Next Arrow — own column, hidden on mobile */}
        <div className="hidden lg:flex shrink-0 w-14 items-center justify-center">
          <button
            type="button"
            onClick={next}
            aria-label="Next features"
            className="w-10 h-10 rounded-full flex items-center justify-center opacity-0 group-hover/carousel:opacity-100 transition-all duration-200 cursor-pointer hover:scale-110"
            style={arrowStyle}
          >
            <svg
              className="w-4 h-4 text-[#6b7280] group-hover/carousel:text-[#d1d5db] transition-colors"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Dots */}
      <div
        className="flex items-center justify-center gap-1.5 mt-8"
        role="tablist"
        aria-label="Slide controls"
      >
        {Array.from({ length: dotCount }, (_, i) => (
          <button
            type="button"
            key={i}
            onClick={() => goTo(i)}
            role="tab"
            aria-selected={i === currentIndex}
            aria-label={`Go to slide ${i + 1}`}
            className="transition-all duration-300 rounded-full cursor-pointer"
            style={{
              width: i === currentIndex ? 24 : 8,
              height: 8,
              backgroundColor: i === currentIndex ? "#06b6d4" : "rgba(255, 255, 255, 0.1)",
              border: "none",
              padding: 0,
            }}
          />
        ))}
      </div>
    </section>
  );
}
