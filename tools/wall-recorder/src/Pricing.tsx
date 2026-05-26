import { AbsoluteFill } from "remotion";

const FONT_DISPLAY = "'Fraunces', 'Playfair Display', Georgia, serif";
const FONT_MONO    = "'JetBrains Mono', ui-monospace, monospace";
const FONT_SANS    = "'Inter', system-ui, sans-serif";
const ACCENT       = "#b85230";
const ACCENT_SOFT  = "#f0a37a";
const INK          = "#2a1a14";
const INK_SOFT     = "#5a443a";
const INK_FAINT    = "#6a5447";
const PAPER        = "#fbf5ec";
const PAPER_2      = "#f4ead9";
const LINE         = "rgba(42,26,20,.12)";

type Tier = {
  name: string;
  price: string;
  priceSub?: string;
  blurb: string;
  bullets: string[];
  featured?: boolean;
};

const TIERS: Tier[] = [
  {
    name: "Tala",
    price: "Free",
    blurb: "Test the whole flow.",
    bullets: ["25 photos", "QR scan & share", "24-hour retention"],
  },
  {
    name: "Sinag",
    price: "₱1,490",
    priceSub: "/ event",
    blurb: "Birthdays, debuts, parties.",
    bullets: ["Unlimited photos & videos", "Cinematic Ken Burns wall", "Live emoji reactions", "30-day retention"],
  },
  {
    name: "Dalisay",
    price: "₱2,990",
    priceSub: "/ event",
    blurb: "Weddings & milestones.",
    bullets: ["Unlimited + audio notes", "Social reel wall — no branding", "Live polls & games", "Full event website", "90-day gallery"],
    featured: true,
  },
];

export const Pricing: React.FC = () => {
  const BAR_H = 110;

  return (
    <AbsoluteFill style={{ background: PAPER }}>
      {/* Sticky top bar */}
      <div
        style={{
          position: "absolute", top: 0, left: 0, right: 0, height: BAR_H,
          background: "linear-gradient(180deg, #1a0f0a 0%, #2a1a14 100%)",
          borderBottom: `2px solid ${ACCENT_SOFT}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "0 48px", zIndex: 20,
        }}
      >
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 34, fontStyle: "italic", color: "#fff", letterSpacing: "-.01em", textAlign: "center", lineHeight: 1.15 }}>
          No subscription. Pay per event.
          <span style={{ color: ACCENT_SOFT, fontWeight: 500 }}>  Try it free.</span>
        </div>
      </div>

      {/* Body */}
      <div style={{ position: "absolute", top: BAR_H, left: 0, right: 0, bottom: 0, overflow: "hidden" }}>
        <div style={{
          position: "absolute", inset: 0,
          background: `radial-gradient(ellipse at top right, ${PAPER_2} 0%, ${PAPER} 60%)`,
        }} />

        <div style={{ position: "relative", padding: "48px 56px 32px", height: "100%", display: "flex", flexDirection: "column" }}>
          {/* Title block */}
          <div style={{ textAlign: "center", marginBottom: 26 }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 14, letterSpacing: ".3em", color: ACCENT, textTransform: "uppercase", marginBottom: 12 }}>
              — Simple pricing
            </div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 72, fontWeight: 400, color: INK, lineHeight: 0.98, letterSpacing: "-.025em" }}>
              One payment. <span style={{ fontStyle: "italic", color: ACCENT }}>Sulit forever.</span>
            </div>
          </div>

          {/* Tier cards (vertical stack) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
            {TIERS.map((t) => (
              <div
                key={t.name}
                style={{
                  position: "relative",
                  background: "#fff",
                  borderRadius: 22,
                  border: t.featured ? `2px solid ${ACCENT}` : `1px solid ${LINE}`,
                  padding: "30px 32px",
                  boxShadow: t.featured
                    ? "0 16px 40px rgba(184,82,48,.18), 0 4px 12px rgba(42,26,20,.06)"
                    : "0 4px 14px rgba(42,26,20,.06)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 24,
                  flex: 1,
                  minHeight: 0,
                }}
              >
                {t.featured && (
                  <div style={{
                    position: "absolute", top: -14, left: 26,
                    background: ACCENT, color: "#fff",
                    fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600,
                    letterSpacing: ".22em", textTransform: "uppercase",
                    padding: "5px 12px", borderRadius: 999,
                  }}>
                    ★ Most popular
                  </div>
                )}

                {/* Left: tier + blurb */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: FONT_DISPLAY, fontSize: 46, fontStyle: "italic",
                    color: t.featured ? ACCENT : INK, lineHeight: 1, marginBottom: 8,
                    letterSpacing: "-.01em",
                  }}>
                    {t.name}
                  </div>
                  <div style={{ fontFamily: FONT_SANS, fontSize: 17, color: INK_FAINT, marginBottom: 14 }}>
                    {t.blurb}
                  </div>
                  <ul style={{
                    margin: 0, padding: 0, listStyle: "none",
                    fontFamily: FONT_SANS, fontSize: 15, color: INK_SOFT,
                    display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 20, rowGap: 6,
                  }}>
                    {t.bullets.map((b, i) => (
                      <li key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.35 }}>
                        <span style={{ color: ACCENT, fontWeight: 600, marginTop: 1 }}>✓</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Right: price */}
                <div style={{ textAlign: "right", flexShrink: 0, minWidth: 190, borderLeft: `1px solid ${LINE}`, paddingLeft: 26 }}>
                  <div style={{
                    fontFamily: FONT_DISPLAY, fontSize: t.price === "Free" ? 60 : 54,
                    fontWeight: 500, color: t.featured ? ACCENT : INK, lineHeight: 1,
                    letterSpacing: "-.02em",
                  }}>
                    {t.price}
                  </div>
                  {t.priceSub && (
                    <div style={{ fontFamily: FONT_MONO, fontSize: 13, color: INK_FAINT, letterSpacing: ".06em", marginTop: 8 }}>
                      {t.priceSub}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ textAlign: "center", marginTop: 22 }}>
            <div style={{
              display: "inline-block",
              background: INK, color: "#fff",
              fontFamily: FONT_MONO, fontSize: 14, letterSpacing: ".26em", textTransform: "uppercase", fontWeight: 600,
              padding: "14px 28px", borderRadius: 999,
              marginBottom: 14,
            }}>
              Start free → reelday.ph
            </div>
            <div style={{ fontFamily: FONT_SANS, fontSize: 13, color: INK_FAINT }}>
              No credit card. Cancel anytime — there&apos;s nothing to cancel.
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
