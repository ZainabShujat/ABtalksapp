"use client";

import { useEffect, useRef, useState } from "react";
import { Send, ThumbsDown, ThumbsUp, X, MessageSquarePlus, List, ChevronLeft, Minus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  CHATBOT_CATEGORIES,
  OPENING_SUGGESTIONS,
  SUPPORT_EMAIL,
  followUpsFor,
} from "@/data/chatbot-menu";
import { ChatLauncher } from "./ChatLauncher";
import { ChatBubble } from "./ChatBubble";
import {
  isMenuCommand,
  matchCategory,
  matchQuestion,
} from "@/lib/chatbot-matcher";


type Message = {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: number;
  streaming?: boolean;
  showFeedback?: boolean;
  feedback?: "helpful" | "not-helpful";
};

/**
 * A conversation, held in memory for the life of the page ONLY.
 *
 * Nothing is written to `localStorage`: a refresh, a new tab or closing the tab
 * starts a fresh chat. Support conversations routinely contain a person's
 * situation and sometimes their email, and keeping that on a shared or public
 * machine to save someone re-typing one question is a bad trade. "New chat"
 * still works within a page load.
 */
type Session = {
  id: string;
  title: string;
  messages: Message[];
  dismissedSuggestions: string[];
  updatedAt: number;
};

/** Session titles come from the first question, trimmed for the list. */
function titleFrom(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > 34 ? `${clean.slice(0, 34)}...` : clean;
}

function generateId() {
  return `id-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

const GREETING = "Hi! I'm the ABTalks Help Assistant.";
const NOT_HELPFUL_MESSAGE = `Sorry that wasn't useful. The ABTalks team can help you directly — email ${SUPPORT_EMAIL} and they'll get back to you.`;
const TRANSPORT_ERROR_MESSAGE = `Something went wrong on my side. Please try again in a moment, or email ${SUPPORT_EMAIL} if it keeps happening.`;

function renderMenuText(): string {
  const lines = CHATBOT_CATEGORIES.map((c) => `${c.number}. ${c.label}`);
  return `Here's what I can help you with:\n${lines.join("\n")}\n\nType a topic, number, or ask anything!`;
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  
  const [sessions, setSessions] = useState<Record<string, Session>>({});
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  
  const [viewState, setViewState] = useState<"chat" | "sessions">("chat");
  const [input, setInput] = useState("");
  
  const hydrated = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** True mid-resize: the drag leaves the panel, and must not collapse it. */
  const resizingRef = useRef(false);

  /**
   * Opening is the only place a session is created.
   *
   * Deliberately not a mount effect: a visitor who never opens the chat should
   * cost nothing, and creating state in an effect just to read it back is the
   * cascading-render pattern React warns about.
   */
  function openWidget() {
    if (!hydrated.current) {
      hydrated.current = true;
      startNewSession();
    }
    setOpen(true);
    setMinimized(false);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [sessions, currentSessionId, viewState]);

  /**
   * Clicking anywhere outside the panel collapses it back to the bubble.
   *
   * `pointerdown` rather than `click`: the panel should get out of the way the
   * moment someone reaches for the page behind it, and a `click` listener only
   * fires after mouseup, which feels like a lag on a panel this size. It also
   * avoids swallowing the press that a `click` handler would.
   *
   * Bound only while open, so the page carries no listener for the (common)
   * case of a visitor who never opens the chat. `mousedown` on the resize
   * handle drags outside the panel bounds, so the drag is checked explicitly
   * rather than by geometry.
   */
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (resizingRef.current) return;
      const target = event.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      setOpen(false);
      setMinimized(true);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const currentSession = currentSessionId ? sessions[currentSessionId] : null;
  const messages = currentSession?.messages || [];

  function startNewSession() {
    const id = generateId();
    const newSession: Session = {
      id,
      title: "New Chat",
      messages: [{ id: generateId(), text: `${GREETING}\n\n${renderMenuText()}`, isUser: false, timestamp: Date.now() }],
      dismissedSuggestions: [],
      updatedAt: Date.now(),
    };
    setSessions(prev => ({ ...prev, [id]: newSession }));
    setCurrentSessionId(id);
    setViewState("chat");
  }

  function updateSession(id: string, updates: Partial<Session>) {
    setSessions(prev => {
      const session = prev[id];
      if (!session) return prev;
      return {
        ...prev,
        [id]: { ...session, ...updates, updatedAt: Date.now() }
      };
    });
  }

  function addUserMessage(text: string) {
    if (!currentSessionId) return;
    const newMsg: Message = { id: generateId(), text, isUser: true, timestamp: Date.now() };
    
    setSessions(prev => {
      const session = prev[currentSessionId];
      // Generate a title based on the first user message
      const title =
        session.messages.filter((m) => m.isUser).length === 0
          ? titleFrom(text)
          : session.title;
        
      return {
        ...prev,
        [currentSessionId]: {
          ...session,
          title,
          messages: [...session.messages, newMsg],
          updatedAt: Date.now()
        }
      };
    });
  }

  function giveFeedback(msgId: string, kind: "helpful" | "not-helpful") {
    if (!currentSessionId || !currentSession) return;
    const updatedMessages = currentSession.messages.map(m => 
      m.id === msgId ? { ...m, feedback: kind } : m
    );
    
    updateSession(currentSessionId, { messages: updatedMessages });
    
    if (kind === "not-helpful") {
      // Escalate rather than apologise and stop. A "not helpful" with no route
      // forward is the moment a support bot loses the user for good.
      const escalation: Message = {
        id: generateId(),
        text: NOT_HELPFUL_MESSAGE,
        isUser: false,
        timestamp: Date.now(),
      };
      updateSession(currentSessionId, { messages: [...updatedMessages, escalation] });
    }
  }

  function dismissSuggestion(suggestionId: string) {
    if (!currentSessionId || !currentSession) return;
    updateSession(currentSessionId, {
      dismissedSuggestions: [...currentSession.dismissedSuggestions, suggestionId]
    });
  }

  function deleteSession(id: string) {
    setSessions((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (id === currentSessionId) {
      const remaining = Object.values(sessions)
        .filter((s) => s.id !== id)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      if (remaining.length > 0) {
        setCurrentSessionId(remaining[0].id);
      } else {
        startNewSession();
      }
    }
  }

  async function streamApiMessage(text: string) {
    if (!currentSessionId) return;
    
    const id = generateId();
    // Add placeholder streaming message
    setSessions(prev => {
      const s = prev[currentSessionId];
      return {
        ...prev,
        [currentSessionId]: {
          ...s,
          messages: [...s.messages, { id, text: "", isUser: false, timestamp: Date.now(), streaming: true, showFeedback: false }],
          updatedAt: Date.now()
        }
      };
    });

    try {
      // Providers require strictly alternating user/assistant turns starting
      // with 'user', so the greeting and any consecutive same-role messages
      // (which happen when a request fails) are folded out here.
      const session = sessions[currentSessionId];
      const history: { role: "user" | "assistant"; content: string }[] = [];
      let nextExpectedRole: "user" | "assistant" = "user";

      for (const m of session.messages) {
        const role = m.isUser ? "user" : "assistant";
        if (role === nextExpectedRole && m.text.trim().length > 0) {
          history.push({ role, content: m.text });
          nextExpectedRole = role === "user" ? "assistant" : "user";
        }
      }

      if (nextExpectedRole === "assistant" && history.length > 0) {
        history[history.length - 1].content += `\n\n${text}`;
      } else {
        history.push({ role: "user", content: text });
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history })
      });

      if (!response.ok) {
        let errMessage = 'API failed';
        try {
          const errData = await response.json();
          errMessage = errData.details || errData.error || errMessage;
        } catch {}
        throw new Error(errMessage);
      }

      if (!response.body) throw new Error('No body in response');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let buffer = "";

      // One state update per network chunk, not per character.
      //
      // The previous implementation appended one character at a time behind a
      // 10ms sleep, which meant a 600-character answer scheduled 600 React
      // renders across six seconds and locked up the widget. The provider
      // already streams in human-sized pieces, so rendering each piece as it
      // arrives reads as live typing and costs a handful of renders.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let batched = "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            // The server normalises every provider to `{ text }`, so the
            // browser parses one shape and never learns who answered.
            const data = JSON.parse(payload) as { text?: string };
            if (data.text) batched += data.text;
          } catch {
            // Partial frame split across reads — the buffer will retry it.
          }
        }

        if (batched) {
          fullText += batched;
          const snapshot = fullText;
          setSessions((prev) => {
            const s = prev[currentSessionId];
            if (!s) return prev;
            return {
              ...prev,
              [currentSessionId]: {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === id ? { ...m, text: snapshot } : m,
                ),
              },
            };
          });
        }
      }

      // Finalize message
      setSessions(prev => {
        const s = prev[currentSessionId];
        return {
          ...prev,
          [currentSessionId]: {
            ...s,
            messages: s.messages.map(m => m.id === id ? { ...m, streaming: false, showFeedback: true } : m),
          }
        };
      });

    } catch {
      // Never surface a raw error string to a visitor — it leaks internals and
      // tells them nothing they can act on.
      setSessions((prev) => {
        const s = prev[currentSessionId];
        if (!s) return prev;
        return {
          ...prev,
          [currentSessionId]: {
            ...s,
            messages: s.messages.map((m) =>
              m.id === id
                ? {
                    ...m,
                    text: TRANSPORT_ERROR_MESSAGE,
                    streaming: false,
                    showFeedback: true,
                  }
                : m,
            ),
          },
        };
      });
    }
  }

  /** Appends a user turn and an immediate canned reply, with no API call. */
  function respondLocally(userText: string, botText: string, feedback = false) {
    if (!currentSessionId) return;
    const userMsg: Message = {
      id: generateId(),
      text: userText,
      isUser: true,
      timestamp: Date.now(),
    };
    const botMsg: Message = {
      id: generateId(),
      text: botText,
      isUser: false,
      timestamp: Date.now(),
      showFeedback: feedback,
    };
    setSessions((prev) => {
      const s = prev[currentSessionId];
      if (!s) return prev;
      const title = s.messages.some((m) => m.isUser) ? s.title : titleFrom(userText);
      return {
        ...prev,
        [currentSessionId]: {
          ...s,
          title,
          messages: [...s.messages, userMsg, botMsg],
          updatedAt: Date.now(),
        },
      };
    });
  }

  function handleSubmit(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setInput("");

    // Menu, greetings and navigation are UI, so they answer instantly.
    if (isMenuCommand(trimmed)) {
      respondLocally(trimmed, renderMenuText());
      return;
    }

    // A category pick ("5", "Certificates") becomes a real retrieval query
    // rather than a canned section blurb — the menu is a shortcut INTO the
    // knowledge base, not a parallel set of answers that can drift from it.
    const category = matchCategory(trimmed);
    if (category) {
      addUserMessage(trimmed);
      void streamApiMessage(category.query);
      return;
    }

    // The remaining fast-path intents return an email address or a route, never
    // a fact. Everything factual goes through retrieval — see chatbot-matcher.
    const routing = matchQuestion(trimmed);
    if (routing) {
      respondLocally(trimmed, routing.answer, true);
      return;
    }

    addUserMessage(trimmed);
    void streamApiMessage(trimmed);
  }

  const [size, setSize] = useState({ width: 400, height: 600 });

  const startResize = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    resizingRef.current = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = size.width;
    const startH = size.height;

    const onMouseMove = (moveEvent: MouseEvent) => {
      // Dragging UP (negative deltaY) increases height
      const deltaY = moveEvent.clientY - startY;
      const newHeight = Math.max(400, Math.min(window.innerHeight - 128, startH - deltaY));
      
      // Top-right corner: typically if right is anchored, dragging right shouldn't expand width,
      // but to preserve 'resize both' behavior, dragging left (negative deltaX) increases width
      const deltaX = moveEvent.clientX - startX;
      // We invert deltaX so dragging left makes it wider, since right edge is anchored
      const newWidth = Math.max(320, Math.min(window.innerWidth - 32, startW - deltaX));

      setSize({ width: newWidth, height: newHeight });
    };

    const onMouseUp = () => {
      resizingRef.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  if (!open && !minimized) {
    return <ChatLauncher open={false} onToggle={openWidget} />;
  }

  const sortedSessions = Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt);

  // Suggestions follow the conversation: after a Claude Challenge answer the
  // useful next questions are about posting and tagging, not a generic list.
  // Capped at three — a wall of pills reads as a phone menu and pushes people
  // away from typing, which is what this assistant is actually good at.
  const lastUserQuestion = [...messages].reverse().find((m) => m.isUser)?.text ?? "";
  const contextual = followUpsFor(lastUserQuestion);
  const suggestionPool = (
    contextual.length > 0
      ? contextual.map((question) => ({ id: `ctx-${question}`, question }))
      : OPENING_SUGGESTIONS
  ).filter((q) => !currentSession?.dismissedSuggestions.includes(q.id));
  const visibleSuggestions = suggestionPool.slice(0, 3);

  return (
    <>
      {(!open && minimized) && (
        <ChatLauncher open={false} onToggle={openWidget} />
      )}
      
      {open && (
        <div 
          ref={panelRef}
          className="theme-abtalks-orange fixed bottom-4 right-4 z-50 flex max-h-[calc(100vh-8rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
          style={{ width: size.width, height: size.height }}
        >
          {/* Header */}
          <div className="shrink-0 border-b bg-muted/50 flex items-center justify-between pl-4 pr-0">
            <div className="flex items-center gap-2 py-3">
              {viewState === "chat" ? (
                <button onClick={() => setViewState("sessions")} className="text-muted-foreground hover:text-foreground transition">
                  <List className="size-4" />
                </button>
              ) : (
                <button onClick={() => setViewState("chat")} className="text-muted-foreground hover:text-foreground transition">
                  <ChevronLeft className="size-4" />
                </button>
              )}
              <p className="text-sm font-semibold text-foreground">
                {viewState === "chat" ? "Rudra AI" : "Recent Chats"}
              </p>
            </div>
            
            <div className="flex items-center h-full">
              <button 
                onClick={startNewSession} 
                className="text-muted-foreground hover:text-foreground transition p-3"
                title="New Chat"
              >
                <MessageSquarePlus className="size-4" />
              </button>
              <button 
                onClick={() => { setOpen(false); setMinimized(true); }} 
                className="text-muted-foreground hover:text-foreground transition p-3"
                title="Minimize"
              >
                <Minus className="size-4" />
              </button>
              {/* Custom Top-Right Resize Handle */}
              <div 
                onMouseDown={startResize}
                className="flex h-[44px] px-3 cursor-ne-resize items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted transition-colors border-l"
                title="Drag to resize (Up/Left)"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M2 2 L10 2 M10 2 L10 10 M10 2 L2 10" />
                </svg>
              </div>
            </div>
          </div>

          {/* Sessions View */}
          {viewState === "sessions" && (
            <div className="flex-1 overflow-y-auto p-2 bg-background min-h-[300px]">
              {sortedSessions.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">No recent chats.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {sortedSessions.map(s => (
                    <div
                      key={s.id}
                      className={`group flex w-full items-center rounded-lg transition ${
                        s.id === currentSessionId ? "bg-muted" : "hover:bg-muted/50"
                      }`}
                    >
                      <button
                        onClick={() => { setCurrentSessionId(s.id); setViewState("chat"); }}
                        className={`flex min-w-0 flex-1 items-center justify-between px-3 py-2 text-left text-sm ${
                          s.id === currentSessionId ? "font-medium text-foreground" : "text-muted-foreground group-hover:text-foreground"
                        }`}
                      >
                        <span className="truncate pr-2">{s.title}</span>
                        <span className="text-[10px] whitespace-nowrap opacity-70">
                          {new Date(s.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </button>
                      <button
                        onClick={() => deleteSession(s.id)}
                        className="mr-1 rounded-full p-1.5 text-muted-foreground opacity-0 transition hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                        aria-label={`Delete chat: ${s.title}`}
                        title="Delete chat"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Chat View */}
          {viewState === "chat" && (
            <>
              <div ref={scrollRef} className="flex h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
                {messages.map((m) => (
                  <div key={m.id} className="flex flex-col gap-1">
                    <ChatBubble message={m.text} isUser={m.isUser} timestamp={m.timestamp} />
                    {!m.isUser && m.showFeedback && !m.streaming && (
                      <div className="pl-1">
                        {m.feedback ? (
                          <p className="text-xs text-muted-foreground">
                            {m.feedback === "helpful" ? "Glad that helped!" : "Thanks for letting us know."}
                          </p>
                        ) : (
                          <div className="flex gap-2 mt-1">
                            <button
                              type="button"
                              onClick={() => giveFeedback(m.id, "helpful")}
                              className="flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                            >
                              <ThumbsUp className="size-3" /> Helpful
                            </button>
                            <button
                              type="button"
                              onClick={() => giveFeedback(m.id, "not-helpful")}
                              className="flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                            >
                              <ThumbsDown className="size-3" /> Not helpful
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Suggestions */}
              {visibleSuggestions.length > 0 && messages.length > 1 && !messages[messages.length - 1].streaming && (
                <div className="flex shrink-0 flex-wrap gap-1.5 border-t px-3 pt-2">
                  <span className="w-full text-xs text-muted-foreground mb-1 pl-1">You can also ask:</span>
                  {visibleSuggestions.map((q) => (
                    <div key={q.id} className="group relative flex items-center">
                      <button
                        type="button"
                        onClick={() => handleSubmit(q.question)}
                        className="rounded-full border border-border bg-background py-1 pl-2.5 pr-6 text-xs text-foreground transition hover:bg-muted"
                      >
                        {q.question}
                      </button>
                      <button 
                        onClick={() => dismissSuggestion(q.id)}
                        className="absolute right-1 p-0.5 text-muted-foreground hover:text-foreground rounded-full hover:bg-muted"
                        aria-label="Dismiss suggestion"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Input Area */}
              <form
                className="flex shrink-0 items-center gap-2 p-3 pt-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSubmit(input);
                }}
              >
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder='Type a question, "menu", or a number…'
                  maxLength={300}
                />
                <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Send">
                  <Send className="size-4" />
                </Button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}

export default ChatWidget;
