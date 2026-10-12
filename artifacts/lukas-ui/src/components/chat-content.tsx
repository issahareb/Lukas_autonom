import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Render model text as readable content, without executing HTML or loading remote images. */
export function ChatContent({ text }: { text: string }) {
  return <div className="chat-rich-text"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
    img: ({ alt, src }) => <a href={typeof src === "string" ? src : undefined} target="_blank" rel="noreferrer">{alt || "Bild öffnen"}</a>,
    table: ({ children }) => <div className="chat-table-scroll" tabIndex={0} aria-label="Tabelle horizontal scrollen"><table>{children}</table></div>,
    h1: ({ children }) => <h3>{children}</h3>,
    h2: ({ children }) => <h3>{children}</h3>,
  }}>{text}</Markdown></div>;
}
