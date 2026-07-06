import { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { Bot, User, Send, ChevronRight, Code2, Terminal } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AgentTabProps {
    socket: Socket;
    isOpen: boolean;
    onClose: () => void;
    channelId: string | null;
    activeSandboxId: string | null;
}

interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

interface AgentRenderMessageProps {
    content: string;
}

const AgentRenderMessage = ({ content }: AgentRenderMessageProps) => {
    const markdownComponents = {
        code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');


            if (!inline && match) {
                return (
                    <div className="relative group/code my-4">
                        <code className={className} {...props}>{children}</code>
                    </div>
                );
            }
            return <code className={className} {...props}>{children}</code>;
        }
    };

    let displayContent = content;
    displayContent = displayContent.replace(/<sandbox_update\s+filename="([^"]+)"\s+language="([^"]+)">\n?([\s\S]*?)<\/sandbox_update>/g, (_match, filename, language, code) => {
        return `\`\`\`${language}\n// file: ${filename}\n${code}\n\`\`\``;
    });

    const thinkMatch = displayContent.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
        const thought = thinkMatch[1];
        const rest = displayContent.replace(/<think>[\s\S]*?<\/think>/, '').trim();
        return (
            <>
                <details className="mb-3 bg-black/30 rounded-[2rem] border border-white/5 overflow-hidden group">
                    <summary
                        onClick={(e) => { e.preventDefault(); const details = e.currentTarget.parentElement as HTMLDetailsElement; if (details) details.open = !details.open; }}
                        className="px-4 py-3 text-xs font-semibold text-white/50 cursor-pointer select-none hover:bg-white/5 hover:text-white bouncy-hover flex items-center gap-2"
                    >
                        <Terminal size={14} className="group-open:text-emerald-400 bouncy-hover" />
                        Thinking Process
                    </summary>
                    <div className="px-4 py-3 text-sm text-white/60 italic border-t border-white/5 whitespace-pre-wrap font-mono bg-black/20">
                        {thought.trim()}
                    </div>
                </details>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{rest}</ReactMarkdown>
            </>
        );
    }

    const openThinkMatch = displayContent.match(/<think>([\s\S]*)$/);
    if (openThinkMatch && !displayContent.includes('</think>')) {
        const thought = openThinkMatch[1];
        return (
            <details open className="mb-3 bg-black/30 rounded-[2rem] border border-white/5 overflow-hidden group">
                <summary
                    onClick={(e) => { e.preventDefault(); const details = e.currentTarget.parentElement as HTMLDetailsElement; if (details) details.open = !details.open; }}
                    className="px-4 py-3 text-xs font-semibold text-white/50 cursor-pointer select-none hover:bg-white/5 hover:text-white bouncy-hover flex items-center gap-2"
                >
                    <Terminal size={14} className="text-emerald-400 animate-pulse" />
                    Thinking Process (in progress...)
                </summary>
                <div className="px-4 py-3 text-sm text-white/60 italic border-t border-white/5 whitespace-pre-wrap font-mono animate-pulse bg-black/20">
                    {thought.trim()}
                </div>
            </details>
        );
    }

    return <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{displayContent}</ReactMarkdown>;
};

export function AgentTab({ socket, isOpen, onClose, channelId, activeSandboxId }: AgentTabProps) {
    const [messages, setMessages] = useState<Message[]>([
        { role: 'assistant', content: 'Hello! I am your AI programming assistant. How can I help you with your code today?' }
    ]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [models, setModels] = useState<any[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            socket.emit('agent:get_models');
        }
        
        const handleModels = (data: any[]) => {
            setModels(data);
            if (data.length > 0) {
                // Keep currently selected if it exists, otherwise pick first
                setSelectedModel(prev => prev || data[0].id);
            }
        };

        socket.on('agent:models', handleModels);
        return () => {
            socket.off('agent:models', handleModels);
        };
    }, [socket, isOpen]);

    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isStreaming]);

    useEffect(() => {
        const handleStream = (data: { chunk?: string, fullContent?: string, error?: string }) => {
            if (data.error) {
                setMessages(prev => {
                    const newMsgs = [...prev];
                    const last = newMsgs[newMsgs.length - 1];
                    if (last && last.role === 'assistant') {
                        last.content += `\n\n**Error:** ${data.error}`;
                    } else {
                        newMsgs.push({ role: 'assistant', content: `**Error:** ${data.error}` });
                    }
                    return newMsgs;
                });
                setIsStreaming(false);
                return;
            }

            if (data.fullContent) {
                setMessages(prev => {
                    const newMsgs = [...prev];
                    const last = newMsgs[newMsgs.length - 1];
                    if (last && last.role === 'assistant') {
                        last.content = data.fullContent || '';
                    }
                    return newMsgs;
                });
            }
        };

        const handleStreamDone = () => {
            setIsStreaming(false);
        };

        socket.on('agent:stream', handleStream);
        socket.on('agent:stream_done', handleStreamDone);

        return () => {
            socket.off('agent:stream', handleStream);
            socket.off('agent:stream_done', handleStreamDone);
        };
    }, [socket]);

    const handleSend = () => {
        if (!input.trim() || isStreaming) return;

        const newMsg = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: newMsg }]);
        
        // Add a placeholder for assistant's response
        setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
        setIsStreaming(true);

        socket.emit('agent:chat', {
            message: newMsg,
            channelId,
            sandboxId: activeSandboxId,
            history: messages.filter((m, idx) => m.role !== 'system' && !(idx === 0 && m.role === 'assistant')),
            model: selectedModel
        });
    };

    if (!isOpen) return null;

    return (
        <div className={`w-[85vw] md:w-96 flex flex-col border-l border-white/10 bg-[#0B0B0B] h-full shadow-2xl transition-all ${activeSandboxId ? 'fixed right-0 top-0 z-[400]' : 'relative z-40'}`}>
            {/* Floating Pull-Tab for Mobile Collapse */}
            <button
                onClick={onClose}
                className="absolute top-1/2 -left-8 sm:-left-10 -translate-y-1/2 w-8 sm:w-10 h-16 sm:h-20 bg-black/80 border-y border-l border-white/10 rounded-l-xl flex flex-col items-center justify-center text-white/50 hover:text-white hover:bg-theme/20 transition-all backdrop-blur-md shadow-[-5px_0_15px_rgba(0,0,0,0.5)] z-50 group"
                title="Close Agent IDE"
            >
                <ChevronRight size={20} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
            
            {/* Header */}
            <div className="h-14 border-b border-white/10 flex items-center justify-between px-4 shrink-0 bg-white/5">
                <div className="flex items-center gap-2 text-emerald-400">
                    <Bot size={20} />
                    <span className="font-bold tracking-wider uppercase text-sm">Agent IDE</span>
                </div>
                {models.length > 0 && (
                    <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        className="bg-black/20 text-white/70 text-xs px-2 py-1 rounded border border-white/10 outline-none"
                    >
                        {models.map(m => (
                            <option key={m.id} value={m.id}>{m.name || m.id}</option>
                        ))}
                    </select>
                )}
                <button 
                    onClick={onClose}
                    className="p-1.5 hover:bg-white/10 rounded-lg text-white/40 hover:text-white transition-colors"
                >
                    <ChevronRight size={20} />
                </button>
            </div>

            {/* Chat History */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
                {messages.map((msg, idx) => (
                    <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                            <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm border border-white/5 ${msg.role === 'user' ? 'bg-theme/20 text-theme' : 'bg-emerald-500/20 text-emerald-400'}`}>
                                {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                            </div>
                            <div className={`flex-1 min-w-0 glass-card px-4 py-3 ${msg.role === 'user' ? 'bg-theme/10 text-white border border-theme/30 rounded-[2rem] rounded-tr-sm' : 'text-white/90 border-white/5 rounded-[2rem] rounded-tl-sm'} text-sm shadow-sm`}>
                                {msg.role === 'user' ? (
                                    <div className="whitespace-pre-wrap leading-relaxed break-words overflow-hidden">{msg.content}</div>
                                ) : (
                                    <div className="prose prose-invert prose-sm max-w-full prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10 prose-p:leading-relaxed break-words overflow-hidden">
                                        {msg.content ? (
                                            <AgentRenderMessage 
                                                content={msg.content} 
                                            />
                                        ) : (
                                            <div className="flex items-center gap-1.5 opacity-60 h-5 px-1">
                                                <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce"></span>
                                                <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.15s' }}></span>
                                                <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.3s' }}></span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-white/10 bg-black/20 shrink-0">
                {activeSandboxId && (
                    <div className="mb-2 text-[10px] text-emerald-400/60 uppercase tracking-widest font-bold flex items-center gap-1">
                        <Code2 size={12} /> Sandbox {activeSandboxId} Attached
                    </div>
                )}
                <div className="relative flex items-center">
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        placeholder="Ask the AI about your code..."
                        className="w-full bg-white/5 border border-white/10 rounded-xl pl-4 pr-12 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 resize-none custom-scrollbar"
                        rows={1}
                        style={{ minHeight: '46px', maxHeight: '150px' }}
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isStreaming}
                        className="absolute right-2 p-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/30 text-white rounded-lg transition-colors"
                    >
                        <Send size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}
