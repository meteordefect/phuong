import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Loader2, Wrench, AlertCircle, ChevronDown, History, Plus, ArrowLeft } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { getSessionToken } from "@/auth/session-token-store";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

interface PhuongMessage {
	role: "user" | "assistant" | "status" | "error";
	content: string;
	toolCalls?: { name: string; result?: string; isError?: boolean }[];
}

interface PhuongModel {
	id: string;
	label: string;
	isDefault: boolean;
}

interface SessionListItem {
	id: string;
	path: string;
	name?: string;
	created: string;
	modified: string;
	messageCount: number;
	preview: string;
}

interface LoadedSession {
	id: string;
	name?: string;
	created: string;
	messages: { role: "user" | "assistant"; content: string }[];
}

interface PhuongChatPanelProps {
	workspaceId: string | null;
}

type ViewMode = "chat" | "history" | "viewing-session";

export function PhuongChatPanel({ workspaceId }: PhuongChatPanelProps) {
	const [messages, setMessages] = useState<PhuongMessage[]>([]);
	const [input, setInput] = useState("");
	const [isStreaming, setIsStreaming] = useState(false);
	const [conversationId, setConversationId] = useState<string | null>(null);
	const [availableModels, setAvailableModels] = useState<PhuongModel[]>([]);
	const [selectedModel, setSelectedModel] = useState<string | null>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const abortRef = useRef<AbortController | null>(null);

	const [viewMode, setViewMode] = useState<ViewMode>("chat");
	const [sessions, setSessions] = useState<SessionListItem[]>([]);
	const [sessionsLoading, setSessionsLoading] = useState(false);
	const [viewedSession, setViewedSession] = useState<LoadedSession | null>(null);
	const [viewedSessionPath, setViewedSessionPath] = useState<string | null>(null);
	const [sessionLoading, setSessionLoading] = useState(false);

	useEffect(() => {
		if (!workspaceId) return;
		const trpcClient = getRuntimeTrpcClient(workspaceId);
		trpcClient.phuong.getModels
			.query()
			.then((models: PhuongModel[]) => {
				setAvailableModels(models);
				const defaultModel = models.find((m) => m.isDefault) || models[0];
				if (defaultModel) {
					setSelectedModel((prev) => prev ?? defaultModel.id);
				}
			})
			.catch(() => {});
	}, [workspaceId]);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	const loadSessions = useCallback(async () => {
		if (!workspaceId) return;
		setSessionsLoading(true);
		try {
			const trpcClient = getRuntimeTrpcClient(workspaceId);
			const result = await trpcClient.phuong.listSessions.query();
			setSessions(result as SessionListItem[]);
		} catch {
			setSessions([]);
		} finally {
			setSessionsLoading(false);
		}
	}, [workspaceId]);

	const openSession = useCallback(
		async (sessionItem: SessionListItem) => {
			if (!workspaceId) return;
			setSessionLoading(true);
			try {
				const trpcClient = getRuntimeTrpcClient(workspaceId);
				const result = await trpcClient.phuong.loadSession.query({ sessionId: sessionItem.id });
				if (result) {
					setViewedSession(result as LoadedSession);
					setViewedSessionPath(sessionItem.path);
					setViewMode("viewing-session");
				}
			} catch {
				// Failed to load session
			} finally {
				setSessionLoading(false);
			}
		},
		[workspaceId],
	);

	const resumeSession = useCallback(() => {
		if (!viewedSession || !viewedSessionPath) return;
		const resumeMessages: PhuongMessage[] = viewedSession.messages.map((m) => ({
			role: m.role,
			content: m.content,
		}));
		setMessages(resumeMessages);
		const newConvId = `resume-${Date.now()}`;
		setConversationId(newConvId);
		setViewMode("chat");
		setViewedSession(null);
	}, [viewedSession, viewedSessionPath]);

	const handleSend = useCallback(async () => {
		const text = input.trim();
		if (!text || isStreaming || !workspaceId) return;

		setInput("");
		setIsStreaming(true);

		const userMsg: PhuongMessage = { role: "user", content: text };
		setMessages((prev) => [...prev, userMsg]);

		const convId = conversationId || `conv-${Date.now()}`;
		if (!conversationId) setConversationId(convId);

		const assistantMsg: PhuongMessage = { role: "assistant", content: "", toolCalls: [] };
		setMessages((prev) => [...prev, assistantMsg]);

		const controller = new AbortController();
		abortRef.current = controller;

		const isResume = convId.startsWith("resume-") && viewedSessionPath;
		try {
			const token = await getSessionToken();
			const headers: Record<string, string> = { "Content-Type": "application/json" };
			if (token) {
				headers["Authorization"] = `Bearer ${token}`;
			}
			const bodyObj: Record<string, unknown> = {
				message: text,
				conversation_id: convId,
				model: selectedModel,
			};
			if (isResume) {
				bodyObj.resume_session_path = viewedSessionPath;
			}
			const res = await fetch("/api/phuong/chat", {
				method: "POST",
				headers,
				body: JSON.stringify(bodyObj),
				signal: controller.signal,
			});

			if (isResume) {
				setViewedSessionPath(null);
			}

			if (!res.ok || !res.body) {
				setMessages((prev) => {
					const updated = [...prev];
					updated[updated.length - 1] = { role: "error", content: `Request failed: ${res.status}` };
					return updated;
				});
				setIsStreaming(false);
				return;
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (!line.startsWith("data: ")) continue;
					const jsonStr = line.slice(6);
					if (!jsonStr) continue;

					try {
						const event = JSON.parse(jsonStr);
						setMessages((prev) => {
							const updated = [...prev];
							const lastMsg = updated[updated.length - 1]!;
							const last: PhuongMessage = {
								role: lastMsg.role,
								content: lastMsg.content,
								toolCalls: lastMsg.toolCalls ? [...lastMsg.toolCalls] : [],
							};
							const toolCalls = last.toolCalls!;

							switch (event.type) {
								case "text_delta":
									last.content += event.content;
									break;
								case "tool_start":
									toolCalls.push({ name: event.name });
									last.toolCalls = toolCalls;
									break;
								case "tool_end": {
									const tc = toolCalls.find((t) => !t.result && t.name === event.name);
									if (tc) {
										tc.result = event.result;
										tc.isError = event.isError;
									}
									last.toolCalls = toolCalls;
									break;
								}
								case "error":
									last.content += `\n\n**Error:** ${event.message}`;
									break;
								case "status":
									last.content += `\n*${event.message}*`;
									break;
								case "done":
									if (event.conversation_id) setConversationId(event.conversation_id);
									break;
							}

							updated[updated.length - 1] = last;
							return updated;
						});
					} catch {
						// skip malformed events
					}
				}
			}
		} catch (err) {
			if ((err as Error).name !== "AbortError") {
				setMessages((prev) => {
					const updated = [...prev];
					updated[updated.length - 1] = {
						role: "error",
						content: `Connection error: ${(err as Error).message}`,
					};
					return updated;
				});
			}
		} finally {
			setIsStreaming(false);
			abortRef.current = null;
		}
	}, [input, isStreaming, workspaceId, conversationId, selectedModel, viewedSessionPath]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				handleSend();
			}
		},
		[handleSend],
	);

	const startNewChat = useCallback(() => {
		setMessages([]);
		setConversationId(null);
		setViewedSession(null);
		setViewedSessionPath(null);
		setViewMode("chat");
	}, []);

	const showHistory = useCallback(() => {
		setViewMode("history");
		loadSessions();
	}, [loadSessions]);

	if (!workspaceId) {
		return (
			<div className="flex h-full items-center justify-center px-3 text-center text-sm text-text-secondary">
				Select a project to start chatting with Phuong.
			</div>
		);
	}

	if (viewMode === "history") {
		return (
			<div className="flex h-full min-w-0 flex-col">
				<div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
					<button
						type="button"
						onClick={() => setViewMode("chat")}
						className="rounded p-1 text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-colors cursor-pointer"
					>
						<ArrowLeft size={14} />
					</button>
					<span className="text-xs font-medium text-text-primary">Chat History</span>
				</div>
				<div className="flex-1 overflow-y-auto">
					{sessionsLoading && (
						<div className="flex items-center justify-center py-8">
							<Loader2 size={16} className="animate-spin text-text-tertiary" />
						</div>
					)}
					{!sessionsLoading && sessions.length === 0 && (
						<div className="flex items-center justify-center py-8 text-xs text-text-tertiary">
							No past sessions found.
						</div>
					)}
					{!sessionsLoading &&
						sessions.map((s) => (
							<button
								key={s.id}
								type="button"
								onClick={() => openSession(s)}
								disabled={sessionLoading}
								className="w-full text-left px-3 py-2.5 border-b border-border hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50"
							>
								<div className="flex items-baseline justify-between gap-2 mb-0.5">
									<span className="text-xs font-medium text-text-primary truncate">
										{s.name || s.preview.slice(0, 60) || "Untitled"}
									</span>
									<span className="flex-shrink-0 text-[10px] text-text-tertiary">
										{formatSessionDate(s.modified)}
									</span>
								</div>
								<div className="text-[11px] text-text-secondary truncate">{s.preview}</div>
								<div className="text-[10px] text-text-tertiary mt-0.5">
									{s.messageCount} message{s.messageCount !== 1 ? "s" : ""}
								</div>
							</button>
						))}
				</div>
			</div>
		);
	}

	if (viewMode === "viewing-session" && viewedSession) {
		return (
			<div className="flex h-full min-w-0 flex-col">
				<div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
					<button
						type="button"
						onClick={showHistory}
						className="rounded p-1 text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-colors cursor-pointer"
					>
						<ArrowLeft size={14} />
					</button>
					<div className="flex-1 min-w-0">
						<span className="text-xs font-medium text-text-primary truncate block">
							{viewedSession.name || "Past Session"}
						</span>
						<span className="text-[10px] text-text-tertiary">
							{formatSessionDate(viewedSession.created)}
						</span>
					</div>
					<button
						type="button"
						onClick={resumeSession}
						className="rounded border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/20 transition-colors cursor-pointer"
					>
						Resume
					</button>
				</div>
				<div className="flex-1 min-w-0 overflow-y-auto px-2 py-2 space-y-3">
					{viewedSession.messages.map((msg, i) => (
						<MessageBubble key={i} message={{ role: msg.role, content: msg.content }} />
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full min-w-0 flex-col">
			<div className="flex items-center justify-end gap-1 border-b border-border px-2 py-1">
				{messages.length > 0 && (
					<button
						type="button"
						onClick={startNewChat}
						disabled={isStreaming}
						className="rounded p-1 text-text-tertiary hover:text-text-primary hover:bg-surface-3 transition-colors cursor-pointer disabled:opacity-40"
						title="New chat"
					>
						<Plus size={14} />
					</button>
				)}
				<button
					type="button"
					onClick={showHistory}
					disabled={isStreaming}
					className="rounded p-1 text-text-tertiary hover:text-text-primary hover:bg-surface-3 transition-colors cursor-pointer disabled:opacity-40"
					title="Chat history"
				>
					<History size={14} />
				</button>
			</div>
			<div className="flex-1 min-w-0 overflow-y-auto px-2 py-2 space-y-3">
				{messages.length === 0 && (
					<div className="flex h-full items-center justify-center text-center text-xs text-text-tertiary px-4">
						Ask Phuong to plan work, break down features, or manage your board.
					</div>
				)}
				{messages.map((msg, i) => (
					<MessageBubble key={i} message={msg} />
				))}
				<div ref={messagesEndRef} />
			</div>
			<div className="border-t border-border p-2">
				{availableModels.length > 1 && (
					<div className="flex items-center gap-1.5 mb-1.5">
						<div className="relative">
							<select
								value={selectedModel ?? ""}
								onChange={(e) => setSelectedModel(e.target.value)}
								disabled={isStreaming}
								className="appearance-none h-6 rounded border border-border bg-surface-1 pl-2 pr-6 text-[11px] text-text-secondary hover:text-text-primary hover:border-border-bright focus:border-border-focus focus:outline-none disabled:opacity-40 cursor-pointer"
							>
								{availableModels.map((m) => (
									<option key={m.id} value={m.id}>
										{m.label}
									</option>
								))}
							</select>
							<ChevronDown
								size={10}
								className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-text-tertiary"
							/>
						</div>
					</div>
				)}
				<div className="flex items-end gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1.5">
					<textarea
						ref={inputRef}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Ask Phuong to plan, create, or manage tasks"
						rows={1}
						disabled={isStreaming}
						className="flex-1 resize-none bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none disabled:opacity-50"
						style={{ maxHeight: 120 }}
					/>
					<button
						type="button"
						onClick={handleSend}
						disabled={!input.trim() || isStreaming}
						className={cn(
							"flex-shrink-0 rounded p-1 transition-colors",
							input.trim() && !isStreaming
								? "text-accent hover:bg-surface-3 cursor-pointer"
								: "text-text-tertiary cursor-not-allowed",
						)}
					>
						{isStreaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
					</button>
				</div>
			</div>
		</div>
	);
}

function formatSessionDate(dateStr: string): string {
	try {
		const date = new Date(dateStr);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return "just now";
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;

		return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
	} catch {
		return "";
	}
}

function MessageBubble({ message }: { message: PhuongMessage }) {
	if (message.role === "user") {
		return (
			<div className="flex justify-end">
				<div className="max-w-[85%] rounded-lg bg-accent/15 px-3 py-2 text-sm text-text-primary">
					{message.content}
				</div>
			</div>
		);
	}

	if (message.role === "error") {
		return (
			<div className="flex items-start gap-2 px-1">
				<AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-status-red" />
				<div className="text-sm text-status-red">{message.content}</div>
			</div>
		);
	}

	return (
		<div className="px-1">
			{message.toolCalls && message.toolCalls.length > 0 && (
				<div className="mb-1.5 space-y-1">
					{message.toolCalls.map((tc, i) => (
						<div
							key={i}
							className="flex min-w-0 items-center gap-1.5 rounded border border-border bg-surface-1 px-2 py-1 text-xs text-text-secondary"
						>
							<Wrench size={12} className="flex-shrink-0" />
							<span className="flex-shrink-0 font-medium">{tc.name}</span>
							{tc.result && (
								<span className={cn("truncate", tc.isError ? "text-status-red" : "text-status-green")}>
									{tc.result.slice(0, 80)}
								</span>
							)}
							{!tc.result && <Loader2 size={12} className="animate-spin" />}
						</div>
					))}
				</div>
			)}
			{message.content && (
				<div className="text-sm text-text-primary whitespace-pre-wrap break-words">{message.content}</div>
			)}
		</div>
	);
}
