"use client";

import type { UserContent } from "ai";
import { useEveAgent } from "eve/react";
import { AlertCircleIcon, BrainIcon, PlusIcon, SquareIcon } from "lucide-react";
import { useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationTopFade,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputButton,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { cn } from "@/lib/utils";
import { AgentMessage } from "./agent-message";
import { TryItCard } from "./try-it-card";
import { WEB_CHAT_AGENT } from "@/app/eve-agent";
import { useHiredRoary } from "@/lib/hired-roary-store";
import { hireContext } from "@/lib/roary-character";

const DEFAULT_NAME = "Roary";
// Chat lives on Roary's desk; sessions resume at /desk/s/<id>.
const DESK_PATH = "/desk";

export function AgentChat({ sessionId }: { readonly sessionId?: string }) {
  const [cancellationError, setCancellationError] = useState<string>();
  const [hasInputText, setHasInputText] = useState(false);
  const hasSubmittedMessage = useRef(false);
  const replaceSessionRoute = (nextSessionId: string) => {
    if (sessionId !== undefined) return;
    // Framework routers (Next.js, TanStack Router) patch window.history; navigating
    // through them would remount this route and detach the active stream.
    History.prototype.replaceState.call(
      window.history,
      window.history.state,
      "",
      `${DESK_PATH}/s/${encodeURIComponent(nextSessionId)}`,
    );
  };
  // The Roary this team hired in the fitting room: its name, face and voice.
  const hired = useHiredRoary();
  const agentName = hired?.name ?? DEFAULT_NAME;
  const agent = useEveAgent({
    prepareSend: (input) => (hired ? { ...input, clientContext: hireContext(hired) } : input),
    agent: WEB_CHAT_AGENT,
    prewarm: hasInputText,
    initialSession:
      sessionId === undefined
        ? undefined
        : {
            sessionId,
            streamIndex: 0,
          },
    resume: sessionId !== undefined,
    onSessionChange(session) {
      if (hasSubmittedMessage.current && session !== undefined) {
        replaceSessionRoute(session.sessionId);
      }
    },
  });

  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isResuming = agent.status === "resuming";
  const isEmpty = agent.data.messages.length === 0;
  const lastMessage = agent.data.messages.at(-1);
  const isPendingAssistantShell =
    lastMessage?.role === "assistant" &&
    lastMessage.parts.every((part) => part.type === "step-start");
  const showPendingThinking =
    isBusy &&
    (agent.status === "submitted" || lastMessage?.role !== "assistant" || isPendingAssistantShell);
  const turnFailure = isBusy || isResuming ? undefined : getLatestTurnFailure(agent.events);
  const errorMessage = cancellationError ?? agent.error?.message ?? turnFailure;
  const hasConversationContent = !isEmpty || errorMessage !== undefined;
  const showConversationLayout = isResuming || hasConversationContent;
  const activeSessionId = sessionId ?? agent.session?.sessionId;
  // Answers are accepted while work runs; the server's settlement closes each request.
  const canRespond = (requestId: string) =>
    !isResuming && agent.data.inputs[requestId]?.status === "open";
  // A tool call can ask several questions at once, and its message part holds only the latest.
  const questionsFor = (callId: string) =>
    Object.values(agent.data.inputs).filter(
      (input) => input.request.kind === "question" && input.request.action.callId === callId,
    );

  const requestCancellation = () => {
    setCancellationError(undefined);
    void agent.cancel().catch((error: unknown) => {
      setCancellationError(toErrorMessage(error));
    });
  };

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if ((text.length === 0 && message.files.length === 0) || isResuming) return;

    setHasInputText(false);
    setCancellationError(undefined);
    hasSubmittedMessage.current = true;
    if (agent.session !== undefined) replaceSessionRoute(agent.session.sessionId);
    const options = isBusy ? { turnPolicy: "steer" as const } : undefined;

    if (message.files.length === 0) {
      await agent.send(text, options);
      return;
    }

    const parts: UserContent = [];
    if (text.length > 0) {
      parts.push({ text, type: "text" });
    }
    for (const file of message.files) {
      parts.push({
        data: file.url,
        filename: file.filename,
        mediaType: file.mediaType,
        type: "file",
      });
    }

    await agent.send(parts, options);
  };

  const sendTryIt = (text: string) => {
    void handleSubmit({ files: [], text });
  };
  const tryItDisabled = isBusy || isResuming;

  const composer = (
    <PromptInput onSubmit={handleSubmit}>
      <PromptInputTextarea
        disabled={isResuming}
        onChange={(event) => setHasInputText(event.currentTarget.value.trim().length > 0)}
        placeholder={`Ask ${agentName} what broke, or what shipped…`}
      />
      <ComposerAction
        hasInputText={hasInputText}
        isBusy={isBusy}
        isResuming={isResuming}
        onCancel={requestCancellation}
      />
    </PromptInput>
  );

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-card text-card-foreground">
      <ChatHeader
        avatar={hired?.snapshot}
        name={agentName}
        activity={isBusy ? "Thinking" : isResuming ? "Catching up" : "On shift"}
        canStartNewChat={activeSessionId !== undefined}
      />

      {showConversationLayout ? (
        <Conversation
          className="min-h-0 flex-1"
          initial={sessionId === undefined ? undefined : false}
          resize={activeSessionId === undefined ? "smooth" : "instant"}
          scrollRestorationKey={
            isEmpty || activeSessionId === undefined
              ? undefined
              : `eve:web-chat-scroll:${activeSessionId}`
          }
        >
          <ConversationTopFade className="top-16" />
          <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 pt-32 pb-36 sm:px-6">
            {agent.data.messages.map((message, index) =>
              showPendingThinking &&
              isPendingAssistantShell &&
              message.id === lastMessage.id ? null : (
                <AgentMessage
                  canRespond={canRespond}
                  isStreaming={
                    agent.status === "streaming" && index === agent.data.messages.length - 1
                  }
                  key={message.id}
                  message={message}
                  questionsFor={questionsFor}
                  onInputResponses={(inputResponses) => {
                    setCancellationError(undefined);
                    return agent.respond(inputResponses);
                  }}
                />
              ),
            )}
            {showPendingThinking ? <PendingThinking /> : null}
            {errorMessage ? <ErrorMessage message={errorMessage} /> : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      ) : null}

      {showConversationLayout ? (
        <div className="absolute top-16 right-0 left-0 z-10 px-4 pt-2 sm:px-6">
          <TryItCard
            className="mx-auto max-w-3xl"
            defaultOpen={false}
            disabled={tryItDisabled}
            onSend={sendTryIt}
          />
        </div>
      ) : null}

      <div
        className={cn(
          "mx-auto w-full px-4 sm:px-6",
          showConversationLayout
            ? "absolute bottom-0 left-1/2 z-20 max-w-3xl -translate-x-1/2 bg-gradient-to-t from-card via-card to-transparent pt-4 pb-4"
            : "flex min-h-0 max-w-xl flex-1 flex-col items-center justify-center-safe gap-6 overflow-y-auto pt-20 pb-8",
        )}
      >
        {showConversationLayout ? null : (
          <div className="flex flex-col items-center gap-3 text-center">
            <h2 className="quoted type-display text-5xl">Talk to {agentName}</h2>
            <p className="max-w-sm font-mono text-muted-foreground text-sm uppercase">
              Ask about errors, recent launches, or what {agentName} is working on right now
            </p>
          </div>
        )}
        {showConversationLayout ? null : (
          <TryItCard defaultOpen disabled={tryItDisabled} onSend={sendTryIt} />
        )}
        <div className="w-full">{composer}</div>
      </div>
    </div>
  );
}

function ComposerAction({
  hasInputText,
  isBusy,
  isResuming,
  onCancel,
}: {
  readonly hasInputText: boolean;
  readonly isBusy: boolean;
  readonly isResuming: boolean;
  readonly onCancel: () => void;
}) {
  const attachments = usePromptInputAttachments();
  const canSubmit = hasInputText || attachments.files.length > 0;

  if (!isBusy || canSubmit) {
    return <PromptInputSubmit disabled={isResuming} />;
  }

  return (
    <PromptInputButton
      aria-label="Stop"
      className="absolute right-2.5 bottom-2.5"
      onClick={onCancel}
      variant="outline"
    >
      <SquareIcon className="size-3 fill-current" />
    </PromptInputButton>
  );
}

function ErrorMessage({ message }: { readonly message: string }) {
  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent>
        <div
          className="flex w-full items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm"
          role="alert"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">Request failed</p>
            <p className="mt-0.5 text-muted-foreground">{message}</p>
          </div>
        </div>
      </MessageContent>
    </Message>
  );
}

function ChatHeader({
  activity,
  avatar,
  canStartNewChat,
  name,
}: {
  readonly activity: string;
  readonly avatar?: string;
  readonly canStartNewChat: boolean;
  readonly name: string;
}) {
  return (
    <header className="ripstop absolute top-0 right-0 left-0 z-20 flex h-16 items-center gap-3 border-ink border-b-2 px-4 text-cotton">
      <span
        aria-hidden
        className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[3px] border-2 border-cotton bg-label text-2xl leading-none"
      >
        {avatar ? (
          // biome-ignore lint/performance/noImgElement: local data URL snapshot
          <img alt="" className="size-full scale-125 object-cover object-top" src={avatar} />
        ) : (
          "🦁"
        )}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="type-display text-2xl leading-none">{name}</span>
        <span className="flex items-center gap-1.5 font-mono text-xs uppercase opacity-85" aria-live="polite">
          <span
            aria-hidden
            className={cn("size-2 rounded-full", activity === "On shift" ? "bg-ok" : "animate-pulse bg-safety")}
          />
          {activity}
        </span>
      </div>
      {canStartNewChat ? (
        <button
          className="ml-auto inline-flex items-center gap-1.5 rounded-[3px] border-2 border-cotton px-3 py-1.5 font-mono text-xs uppercase hover:bg-cotton hover:text-ink"
          onClick={() => window.location.assign(DESK_PATH)}
          type="button"
        >
          <PlusIcon className="size-3.5" />
          New chat
        </button>
      ) : null}
    </header>
  );
}

function PendingThinking() {
  return (
    <Message aria-live="polite" from="assistant">
      <MessageContent>
        <div className="mb-4 flex w-full items-center gap-2 text-muted-foreground text-sm">
          <BrainIcon className="size-4" />
          <Shimmer duration={1}>Thinking</Shimmer>
        </div>
      </MessageContent>
    </Message>
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to cancel the response.";
}

function getLatestTurnFailure(
  events: ReturnType<typeof useEveAgent>["events"],
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (event.type === "turn.failed") {
      return event.data.code === "MODEL_CALL_FAILED"
        ? "The model is temporarily unavailable. Please try again."
        : event.data.message;
    }

    if (event.type === "turn.completed" || event.type === "turn.cancelled") {
      return undefined;
    }

    if (event.type === "message.received") {
      return undefined;
    }
  }

  return undefined;
}
