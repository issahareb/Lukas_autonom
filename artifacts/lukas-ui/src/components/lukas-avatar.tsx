import "./lukas-avatar.css";
import type { Expression } from "@/lib/expression";

export type LukasMood = "idle" | "listening" | "thinking" | "speaking";
// Static facial geometry stays visible during blinking, speech and reduced motion.
const faces = {
  neutral:    { eyes: [1, 1], brows: "", mouth: "M35 52Q41 55 47 52" },
  happy:      { eyes: [.65, .65], brows: "", mouth: "M32 50Q40 62 49 49Q42 53 32 50Z" },
  sad:        { eyes: [.78, .78], brows: "M24 33L34 29M46 29L56 33", mouth: "M34 56Q41 48 48 56" },
  angry:      { eyes: [.58, .58], brows: "M24 30L35 35M45 35L56 30", mouth: "M34 55Q40 50 48 54" },
  frustrated: { eyes: [.48, .72], brows: "M24 32L34 34M46 31L56 32", mouth: "M34 54L39 53L42 55L48 52" },
  surprised:  { eyes: [1.1, 1.1], brows: "M24 30Q29 26 34 29M46 29Q51 26 56 30", mouth: "M41 49C46 49 46 58 41 58S36 49 41 49Z" },
  curious:    { eyes: [.75, 1.05], brows: "M24 32L34 32M46 30Q51 25 56 29", mouth: "M36 53Q43 55 47 51" },
  sleepy:     { eyes: [.23, .23], brows: "", mouth: "M37 54Q41 53 45 54" },
  wink:       { eyes: [1, .13], brows: "M46 31Q51 28 55 31", mouth: "M34 52Q42 58 49 49" },
} satisfies Record<Expression, { eyes: [number, number]; brows: string; mouth: string }>;

/** Live vector character: a tiny lime-eyed robot, never a video or GIF. */
export function LukasAvatar({ className = "", mood = "idle", expression = "neutral" }: { className?: string; mood?: LukasMood; expression?: Expression }) {
  const face = faces[expression];
  return (
    <span className={`lukas-avatar ${className}`} data-mood={mood} data-expression={expression} aria-hidden="true">
      <svg viewBox="0 0 80 80" fill="none" focusable="false">
        <g className="lukas-head">
          <path d="M42 16 47 8" stroke="#b4b3a8" strokeWidth="3" strokeLinecap="round" />
          <circle className="lukas-antenna" cx="48" cy="7" r="4" fill="var(--robot-accent)" />
          <rect x="4" y="35" width="8" height="18" rx="4" fill="#aaa99d" />
          <rect x="68" y="35" width="8" height="18" rx="4" fill="#aaa99d" />
          <rect x="9" y="17" width="62" height="51" rx="21" fill="#e8e5dc" />
          <path d="M20 25c9-5 29-6 40 0" stroke="#fffef7" strokeWidth="2" strokeLinecap="round" />
          <rect x="15" y="27" width="50" height="33" rx="14" fill="#171917" />
          <g className="lukas-gaze" fill="var(--robot-accent)">
            {face.eyes.map((height, index) => (
              <g key={index} transform={`translate(${index === 0 ? 29 : 51} 40) scale(1 ${height})`}>
                <rect className="lukas-eye" x="-4.5" y="-6" width="9" height="12" rx="4.5" />
              </g>
            ))}
          </g>
          <g stroke="var(--robot-accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            {face.brows && <path d={face.brows} />}
            {mood !== "speaking" && <path d={face.mouth} />}
          </g>
          <ellipse className="lukas-mouth-speaking" cx="41" cy="53" rx="5" ry="3.5" fill="var(--robot-accent)" />
          <circle cx="22" cy="49" r="2" fill="var(--robot-accent)" opacity=".25" />
          <circle cx="59" cy="49" r="2" fill="var(--robot-accent)" opacity=".25" />
          <path d="M35 64h10" stroke="#aaa99d" strokeWidth="2" strokeLinecap="round" />
        </g>
      </svg>
    </span>
  );
}
