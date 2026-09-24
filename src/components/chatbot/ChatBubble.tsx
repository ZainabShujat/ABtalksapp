import type { ReactNode } from "react";

type ChatBubbleProps = {
  message: string;
  isUser?: boolean;
  timestamp?: number;
};

/**
 * Where a link in an answer may point. Our own pages and mail only: the text
 * comes from a model, and a link is the one thing in a reply that can move
 * someone off the site. Anything else stays as plain text.
 */
function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(href)) return href;
  // A site path, but not a protocol-relative "//evil.com".
  if (/^\/(?!\/)[\w\-./?#=&%]*$/.test(href)) return href;
  // Our own absolute URL is followed as a path, so it works on previews too.
  const own = /^(?:https?:\/\/)?(?:www\.)?abtalks\.in(\/[\w\-./?#=&%]*)?$/i.exec(href);
  if (own) return own[1] || "/";
  return null;
}

/**
 * `[label](href)`, `**bold**`, bare abtalks.in URLs and email addresses. The
 * answer used to render as raw text, so "Learn more: [abtalks.in/workshop]
 * (/workshop)" showed its brackets and nothing was clickable (issue #576).
 */
const TOKEN =
  /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|((?:https?:\/\/)?(?:www\.)?abtalks\.in(?:\/[\w\-./?#=&%]*)?)|([\w.%+-]+@[\w.-]+\.[a-z]{2,})/gi;

const LINK_CLASS = "font-medium underline underline-offset-2 hover:opacity-80";

function renderRich(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const [whole, label, href, bold, url, email] = m;
    if (label !== undefined && href !== undefined) {
      const safe = safeHref(href);
      out.push(
        safe ? (
          <a key={key++} href={safe} className={LINK_CLASS}>
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else if (bold !== undefined) {
      out.push(<strong key={key++}>{bold}</strong>);
    } else if (url !== undefined) {
      // A sentence-ending full stop is not part of the address.
      const trimmed = url.replace(/[.,]+$/, "");
      const safe = safeHref(trimmed);
      out.push(
        safe ? (
          <a key={key++} href={safe} className={LINK_CLASS}>
            {trimmed}
          </a>
        ) : (
          trimmed
        ),
      );
      if (trimmed.length < url.length) out.push(url.slice(trimmed.length));
    } else if (email !== undefined) {
      const trimmed = email.replace(/\.+$/, "");
      out.push(
        <a key={key++} href={`mailto:${trimmed}`} className={LINK_CLASS}>
          {trimmed}
        </a>,
      );
      if (trimmed.length < email.length) out.push(email.slice(trimmed.length));
    } else {
      out.push(whole);
    }
    last = at + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function ChatBubble({ message, isUser = false, timestamp }: ChatBubbleProps) {
  const timeString = timestamp 
    ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[80%] whitespace-pre-line rounded-2xl px-4 py-2 text-sm ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        {message ? (
          // The user's own words are shown exactly as typed.
          isUser ? message : renderRich(message)
        ) : (
          <div className="flex items-center gap-1 h-5">
            <div className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "0ms" }}></div>
            <div className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "150ms" }}></div>
            <div className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "300ms" }}></div>
          </div>
        )}
      </div>
      {timeString && (
        <span className="text-[10px] text-muted-foreground px-1 mt-0.5">
          {timeString}
        </span>
      )}
    </div>
  );
}

export default ChatBubble;
