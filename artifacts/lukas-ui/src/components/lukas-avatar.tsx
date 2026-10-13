import "./lukas-avatar.css";

/** Decorative brand image; the adjacent label provides the accessible name. */
export function LukasAvatar({ className = "" }: { className?: string }) {
  return (
    <span className={`lukas-avatar ${className}`} aria-hidden="true">
      <img src="/lukas-avatar-v1.webp" alt="" width={128} height={128} draggable={false} />
    </span>
  );
}
