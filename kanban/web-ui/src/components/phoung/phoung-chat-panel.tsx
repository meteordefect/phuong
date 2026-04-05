import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Loader2, Wrench, AlertCircle } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { getSessionToken } from "@/auth/session-token-store";

interface PhoungMessage {
	role: "user" | "assistant" | "status" | "error";
	content: string;
	toolCalls?: { name: string; result?: string; isError?: boolean }[];
}

interface PhoungChatPanelProps {
	workspaceId: string | null;
}

export function PhoungChatPanel({ workspaceId }: PhoungChatPanelProps) {
	const [messages, setMessages] = useState<PhoungMessage[]>([]);
	const [input, setInput] = useState("");
	const [isStreaming, setIsStreaming] = useState(false);
	const [conversationId, setConversationId] = useState<string | null>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const abortRef = useRef<AbortController | null>(null);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	const handleSend = useCallback(async () => {
		const text = input.trim();
		if (!text || isStreaming || !workspaceId) return;

		setInput("");
		setIsStreaming(true);

		const userMsg: PhoungMessage = { role: "user", content: text };
		setMessages((prev) => [...prev, userMsg]);

		const convId = conversationId || `conv-${Date.now()}`;
		if (!conversationId) setConversationId(convId);

		const assistantMsg: PhoungMessage = { role: "assistant", content: "", toolCalls: [] };
		setMessages((prev) => [...prev, assistantMsg]);

		const controller = new AbortController();
		abortRef.current = controller;

		try {
			const token = await getSessionToken();
			const headers: Record<string, string> = { "Content-Type": "application/json" };
			if (token) {
				headers["Authorization"] = `Bearer ${token}`;
			}
			const res = await fetch("/api/phoung/chat", {
				method: "POST",
				headers,
				body: JSON.stringify({ message: text, conversation_id: convId }),
				signal: controller.signal,
			});

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
							const last: PhoungMessage = {
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
	}, [input, isStreaming, workspaceId, conversationId]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				handleSend();
			}
		},
		[handleSend],
	);

	if (!workspaceId) {
		return (
			<div className="flex h-full items-center justify-center px-3 text-center text-sm text-text-secondary">
				Select a project to start chatting with Phoung.
			</div>
		);
	}

	return (
		<div className="flex h-full min-w-0 flex-col">
			<div className="flex-1 min-w-0 overflow-y-auto px-2 py-2 space-y-3">
				{messages.length === 0 && (
					<div className="flex h-full items-center justify-center text-center text-xs text-text-tertiary px-4">
						Ask Phoung to plan work, break down features, or manage your board.
					</div>
				)}
				{messages.map((msg, i) => (
					<MessageBubble key={i} message={msg} />
				))}
				<div ref={messagesEndRef} />
			</div>
			<div className="border-t border-border p-2">
				<div className="flex items-end gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1.5">
					<textarea
						ref={inputRef}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Ask Phoung to plan, create, or manage tasks"
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

function MessageBubble({ message }: { message: PhoungMessage }) {
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
