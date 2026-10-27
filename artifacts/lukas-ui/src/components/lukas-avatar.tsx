import "./lukas-avatar.css";

export type LukasMood = "idle" | "listening" | "thinking" | "speaking";
/** Live vector character: a tiny lime-eyed robot, never a video or GIF. */
export function LukasAvatar({ className = "", mood = "idle" }: { className?: string; mood?: LukasMood }) {
  return (
    <span className={`lukas-avatar ${className}`} data-mood={mood} aria-hidden="true">
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
            <rect className="lukas-eye lukas-eye-left" x="25" y="34" width="9" height="13" rx="4.5" />
            <rect className="lukas-eye lukas-eye-right" x="46" y="33" width="9" height="14" rx="4.5" />
          </g>
          <path className="lukas-smile" d="M34 51c3 5 10 5 14-1" stroke="var(--robot-accent)" strokeWidth="2.6" strokeLinecap="round" />
          <ellipse className="lukas-mouth-speaking" cx="41" cy="53" rx="5" ry="3.5" fill="var(--robot-accent)" />
          <circle cx="22" cy="49" r="2" fill="var(--robot-accent)" opacity=".25" />
          <circle cx="59" cy="49" r="2" fill="var(--robot-accent)" opacity=".25" />
          <path d="M35 64h10" stroke="#aaa99d" strokeWidth="2" strokeLinecap="round" />
        </g>
      </svg>
    </span>
  );
}
