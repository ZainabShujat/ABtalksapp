"use client";

import { useEffect, useRef, useState } from "react";
import { Send, ThumbsDown, ThumbsUp, X, MessageSquarePlus, List, ChevronLeft, Minus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  CHATBOT_CATEGORIES,
  QUICK_QUESTION_IDS,
  SUPPORT_EMAIL,
  type ChatbotCategory,
} from "@/data/chatbot-menu";
import { ChatLauncher } from "./ChatLauncher";
import { ChatBubble } from "./ChatBubble";
import { matchQuestion } from "@/lib/chatbot-matcher";

type Message = {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: number;
  streaming?: boolean;
  showFeedback?: boolean;
  feedback?: "helpful" | "not-helpful";
};

type Session = {
  id: string;
  title: string;
  messages: Message[];
  dismissedSuggestions: string[];
  updatedAt: number;
};

const SESSION_KEY = "abtalks_chatbot_sessions";

// Use existing categories/questions as shortcuts to send text.
const QUICK_QUESTIONS = QUICK_QUESTION_IDS.map((id) => {
  // A simple map since we removed CHATBOT_QUESTIONS to rely on RAG.
  const map: Record<string, string> = {
    "is-abtalks-free": "Is ABTalks free?",
    "who-can-participate": "Who can participate?",
    "claude-challenge-tagging": "What are the required tags for the Claude Challenge?",
    "ai-cohort-overview": "What is the AI Cohort?",
    "contact-email": "What is the contact email?",
  };
  return { id, canonicalQuestion: map[id] || "Tell me about ABTalks" };
});

function generateId() {
  return `id-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

const GREETING = "Hi! I'm the ABTalks Help Assistant.";
const FALLBACK_MESSAGE = "Sorry, I couldn't give you a useful answer. You can try rephrasing your question, or contact the ABTalks team directly at team@abtalks.in.";

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

  // Initialize
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    startNewSession();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [sessions, currentSessionId, viewState]);

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
      const title = session.messages.filter(m => m.isUser).length === 0 
        ? text.slice(0, 30) + (text.length > 30 ? "..." : "")
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
      // Add the fallback apology directly to the chat
      const fallbackMsg: Message = { id: generateId(), text: FALLBACK_MESSAGE, isUser: false, timestamp: Date.now() };
      updateSession(currentSessionId, { messages: [...updatedMessages, fallbackMsg] });
    }
  }

  function dismissSuggestion(suggestionId: string) {
    if (!currentSessionId || !currentSession) return;
    updateSession(currentSessionId, {
      dismissedSuggestions: [...currentSession.dismissedSuggestions, suggestionId]
    });
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
      // Get current history for API, ensuring it starts with a 'user' message
      // (Anthropic API strictly requires the first message to be 'user')
      // Anthropic API requires alternating user/assistant turns, starting with 'user'
      const session = sessions[currentSessionId];
      let history: { role: string; content: string }[] = [];
      let nextExpectedRole = 'user';

      for (const m of session.messages) {
        const role = m.isUser ? 'user' : 'assistant';
        // Skip leading assistant messages or consecutive messages of the same role
        if (role === nextExpectedRole && m.text.trim().length > 0) {
          history.push({ role, content: m.text });
          nextExpectedRole = role === 'user' ? 'assistant' : 'user';
        }
      }

      // Finally, append the current user's message
      if (nextExpectedRole === 'assistant') {
         // If we are expecting an assistant message but the user sent another one (e.g. previous API failed)
         // we must drop the last user message or combine them. We'll combine them for simplicity.
         if (history.length > 0) {
             history[history.length - 1].content += `\n\n${text}`;
         } else {
             history.push({ role: 'user', content: text });
         }
      } else {
         history.push({ role: 'user', content: text });
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

      // Simple SSE parser
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ""; // Keep the incomplete line in the buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') continue;
            
            try {
              const data = JSON.parse(dataStr);
              let chunkText = "";
              
              if (data.type === 'content_block_delta' && data.delta?.text) {
                chunkText = data.delta.text; // Anthropic format
              } else if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
                chunkText = data.candidates[0].content.parts[0].text; // Gemini format
              }

              if (chunkText) {
                // Letter by letter typewriter effect
                for (let i = 0; i < chunkText.length; i++) {
                  fullText += chunkText[i];
                  setSessions(prev => {
                    const s = prev[currentSessionId];
                    if (!s) return prev;
                    return {
                      ...prev,
                      [currentSessionId]: {
                        ...s,
                        messages: s.messages.map(m => m.id === id ? { ...m, text: fullText } : m),
                      }
                    };
                  });
                  // 10ms delay per character
                  await new Promise(resolve => setTimeout(resolve, 10));
                }
              }
            } catch (e) {
              // Ignore parse errors from partial JSON
            }
          }
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

    } catch (err: any) {
      console.error(err);
      // Fallback update
      setSessions(prev => {
        const s = prev[currentSessionId];
        return {
          ...prev,
          [currentSessionId]: {
            ...s,
            messages: s.messages.map(m => m.id === id ? {
              ...m,
              text: `API Error: ${err.message || 'Unknown error'}`,
              streaming: false,
              showFeedback: true,
            } : m),
          }
        };
      });
    }
  }

  function handleSubmit(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setInput("");
    
    const lower = trimmed.toLowerCase();
    
    // Check for explicit menu commands
    if (["menu", "home", "main menu"].includes(lower)) {
      if (currentSessionId) {
        const userMsg: Message = { id: generateId(), text: trimmed, isUser: true, timestamp: Date.now() };
        const botMsg: Message = { id: generateId(), text: renderMenuText(), isUser: false, timestamp: Date.now() };
        setSessions(prev => {
          const s = prev[currentSessionId];
          return { ...prev, [currentSessionId]: { ...s, messages: [...s.messages, userMsg, botMsg] } };
        });
      }
      return;
    }

    // Try local matching first (Hybrid RAG approach)
    const localMatch = matchQuestion(trimmed);
    
    if (localMatch) {
      if (currentSessionId) {
        const userMsg: Message = { id: generateId(), text: trimmed, isUser: true, timestamp: Date.now() };
        const botMsg: Message = { id: generateId(), text: localMatch.answer, isUser: false, timestamp: Date.now(), showFeedback: true };
        setSessions(prev => {
          const s = prev[currentSessionId];
          return { ...prev, [currentSessionId]: { ...s, messages: [...s.messages, userMsg, botMsg] } };
        });
      }
      return;
    }

    // Fallback to RAG via API
    addUserMessage(trimmed);
    streamApiMessage(trimmed);
  }

  const [size, setSize] = useState({ width: 400, height: 600 });

  const startResize = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
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
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  if (!open && !minimized) {
    return <ChatLauncher open={false} onToggle={() => setOpen(true)} />;
  }

  const sortedSessions = Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt);
  const visibleSuggestions = QUICK_QUESTIONS.filter(q => !currentSession?.dismissedSuggestions.includes(q.id)).slice(0, 3);

  return (
    <>
      {(!open && minimized) && (
        <ChatLauncher open={false} onToggle={() => { setOpen(true); setMinimized(false); }} />
      )}
      
      {open && (
        <div 
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
                    <button
                      key={s.id}
                      onClick={() => { setCurrentSessionId(s.id); setViewState("chat"); }}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                        s.id === currentSessionId ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      }`}
                    >
                      <span className="truncate pr-2">{s.title}</span>
                      <span className="text-[10px] whitespace-nowrap opacity-70">
                        {new Date(s.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </button>
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
                        onClick={() => handleSubmit(q.canonicalQuestion)}
                        className="rounded-full border border-border bg-background py-1 pl-2.5 pr-6 text-xs text-foreground transition hover:bg-muted"
                      >
                        {q.canonicalQuestion}
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
