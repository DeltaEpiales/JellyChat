import { useState, useEffect, useRef } from 'react';
import { Editor } from '@monaco-editor/react';
import { X, Play, Code2, RefreshCw, MousePointer2, Bot, FileText, Plus, Trash2, PanelLeft, PanelBottom, Download } from 'lucide-react';
import { Socket } from 'socket.io-client';

interface CollaborativeSandboxProps {
    socket: Socket;
    channelId: string;
    sandboxId: string;
    onClose: () => void;
    isAgentOpen?: boolean;
    onToggleAgent?: () => void;
}

const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 55%)`;
};

interface PointerData {
    socketId: string;
    ip: string;
    name: string;
    x: number;
    y: number;
    lastUpdate: number;
}

export function CollaborativeSandbox({ socket, channelId, sandboxId, onClose, isAgentOpen, onToggleAgent }: CollaborativeSandboxProps) {
    const [files, setFiles] = useState<Record<string, { code: string, language: string }>>({ 'index.html': { code: '<!-- Write your HTML here -->', language: 'html' } });
    const [activeFile, setActiveFile] = useState<string>('index.html');
    const [newFilename, setNewFilename] = useState('');
    const [isCreatingFile, setIsCreatingFile] = useState(false);
    const [isFileExplorerOpen, setIsFileExplorerOpen] = useState(true);
    const [isTerminalOpen, setIsTerminalOpen] = useState(true);
    const [output, setOutput] = useState<string[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [activeTab, setActiveTab] = useState<'code' | 'preview'>('code');
    const [runMode, setRunMode] = useState<'file' | 'project'>('file');
    const [previewMode, setPreviewMode] = useState<'multi' | 'single'>('multi');
    
    const [pointers, setPointers] = useState<Record<string, PointerData>>({});
    const [remoteCursors, setRemoteCursors] = useState<Record<string, any>>({});
    const pointerEmitThrottle = useRef<number>(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<any>(null);
    const decorationsCollection = useRef<any>(null);
    
    useEffect(() => {
        // Request current state or initialize
        socket.emit('sandbox:create', { channelId, sandboxId, files, activeFile });
        
        const handleUpdate = (data: { channelId: string, sandboxId: string, files?: Record<string, { code: string, language: string }>, activeFile?: string }) => {
            if (data.channelId === channelId && data.sandboxId === sandboxId) {
                if (data.files) setFiles(data.files);
                if (data.activeFile) setActiveFile(data.activeFile);
            }
        };

        const handlePointer = (data: PointerData & { channelId: string, sandboxId: string }) => {
            if (data.channelId === channelId && data.sandboxId === sandboxId) {
                setPointers(prev => ({
                    ...prev,
                    [data.socketId]: { ...data, lastUpdate: Date.now() }
                }));
            }
        };

        const handleCursor = (data: any) => {
            if (data.channelId === channelId && data.sandboxId === sandboxId) {
                setRemoteCursors(prev => ({
                    ...prev,
                    [data.socketId]: { ...data, lastUpdate: Date.now() }
                }));
            }
        };

        socket.on('sandbox:update', handleUpdate);
        socket.on('sandbox:pointer_receive', handlePointer);
        socket.on('sandbox:cursor_receive', handleCursor);
        socket.on('sandbox:execute_stream', (data: any) => {
            if (data.channelId === channelId && data.sandboxId === sandboxId) {
                setOutput(prev => {
                    const lines = data.output.split('\n');
                    return [...prev, ...lines.filter((l: string) => l.trim().length > 0)];
                });
            }
        });
        socket.on('sandbox:execute_result', (data: any) => {
            if (data.channelId === channelId && data.sandboxId === sandboxId) {
                if (data.logs && data.logs.length > 0) {
                    setOutput(prev => [...prev, ...data.logs, '> Execution Complete.']);
                } else {
                    setOutput(prev => [...prev, '> Execution Complete.']);
                }
                setIsRunning(false);
            }
        });
        
        const cleanupInterval = setInterval(() => {
            const now = Date.now();
            setPointers(prev => {
                const updated = { ...prev };
                let changed = false;
                for (const sid in updated) {
                    if (now - updated[sid].lastUpdate > 3000) {
                        delete updated[sid];
                        changed = true;
                    }
                }
                return changed ? updated : prev;
            });
            setRemoteCursors(prev => {
                const updated = { ...prev };
                let changed = false;
                for (const sid in updated) {
                    if (now - updated[sid].lastUpdate > 10000) {
                        delete updated[sid];
                        changed = true;
                    }
                }
                return changed ? updated : prev;
            });
        }, 1000);
        
        return () => {
            socket.off('sandbox:update', handleUpdate);
            socket.off('sandbox:pointer_receive', handlePointer);
            socket.off('sandbox:cursor_receive', handleCursor);
            clearInterval(cleanupInterval);
        };
    }, [socket, channelId, sandboxId]);

    // Update monaco decorations when remote cursors change
    useEffect(() => {
        if (!decorationsCollection.current || !editorRef.current) return;
        
        const decorations = Object.entries(remoteCursors).map(([sid, cursor]: [string, any]) => {
            return {
                range: cursor.selection,
                options: {
                    className: `remote-cursor-${sid}`,
                    hoverMessage: { value: cursor.name },
                    stickiness: 1, // NeverGrowsWhenTypingAtEdges
                    beforeContentClassName: `remote-caret-${sid}`
                }
            };
        });
        decorationsCollection.current.set(decorations);
    }, [remoteCursors]);

    const handleEditorDidMount = (editor: any) => {
        editorRef.current = editor;
        decorationsCollection.current = editor.createDecorationsCollection([]);

        editor.onDidChangeCursorSelection((e: any) => {
            socket.emit('sandbox:cursor', {
                channelId,
                sandboxId,
                data: {
                    selection: e.selection
                }
            });
        });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!containerRef.current) return;
        const now = Date.now();
        if (now - pointerEmitThrottle.current < 50) return;
        pointerEmitThrottle.current = now;

        const rect = containerRef.current.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        socket.emit('sandbox:pointer', {
            channelId,
            sandboxId,
            data: { x, y }
        });
    };

    const handleCodeChange = (newCode: string | undefined) => {
        if (newCode === undefined || !activeFile) return;
        setFiles(prev => ({ ...prev, [activeFile]: { ...prev[activeFile], code: newCode } }));
        socket.emit('sandbox:update_file', { channelId, sandboxId, filename: activeFile, code: newCode });
    };

    const runCode = () => {
        setIsRunning(true);
        setOutput(['> Sandbox Executing on Host Machine...']);
        if (runMode === 'project') {
            socket.emit('sandbox:execute_project', { channelId, sandboxId, files });
        } else {
            const lang = files[activeFile]?.language || 'javascript';
            const c = files[activeFile]?.code || '';
            if (lang === 'html') {
                setOutput(['> Web Preview Updated.']);
                setIsRunning(false);
                return;
            }
            socket.emit('sandbox:execute', { channelId, sandboxId, language: lang, code: c });
        }
    };
    
    const handleCreateFile = () => {
        if (newFilename.trim()) {
            let lang = 'javascript';
            if (newFilename.endsWith('.html')) lang = 'html';
            else if (newFilename.endsWith('.css')) lang = 'css';
            else if (newFilename.endsWith('.py')) lang = 'python';
            else if (newFilename.endsWith('.ts')) lang = 'typescript';
            else if (newFilename.endsWith('.cpp')) lang = 'cpp';
            
            socket.emit('sandbox:create_file', { channelId, sandboxId, filename: newFilename.trim(), language: lang });
            setNewFilename('');
            setIsCreatingFile(false);
        }
    };
    
    const handleDeleteFile = (e: React.MouseEvent, filename: string) => {
        e.stopPropagation();
        socket.emit('sandbox:delete_file', { channelId, sandboxId, filename });
    };
    
    const handleSwitchFile = (filename: string) => {
        setActiveFile(filename);
        socket.emit('sandbox:switch_file', { channelId, sandboxId, filename });
    };

    const getPreviewHtml = () => {
        if (previewMode === 'single') {
            return activeFile && files[activeFile] ? files[activeFile].code : '';
        }

        let htmlCode = '';
        let cssCode = '';
        let jsCode = '';

        if (files['index.html']) {
            htmlCode = files['index.html'].code;
        } else {
            const htmlFile = Object.entries(files).find(([name]) => name.endsWith('.html'));
            if (htmlFile) htmlCode = htmlFile[1].code;
            else htmlCode = '<div style="color:white;font-family:sans-serif;padding:20px;">No HTML file found. Create index.html to see preview.</div>';
        }

        Object.entries(files).forEach(([name, file]) => {
            if (name.endsWith('.css')) cssCode += `\n/* ${name} */\n${file.code}`;
            if (name.endsWith('.js')) jsCode += `\n/* ${name} */\n${file.code}`;
        });

        if (cssCode) {
            const styleTag = `\n<style>\n${cssCode}\n</style>\n`;
            if (htmlCode.includes('</head>')) {
                htmlCode = htmlCode.replace('</head>', `${styleTag}</head>`);
            } else {
                htmlCode = styleTag + htmlCode;
            }
        }

        if (jsCode) {
            const scriptTag = `\n<script>\n${jsCode}\n</script>\n`;
            if (htmlCode.includes('</body>')) {
                htmlCode = htmlCode.replace('</body>', `${scriptTag}</body>`);
            } else {
                htmlCode = htmlCode + scriptTag;
            }
        }

        return htmlCode;
    };

    return (
        <div className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-md flex items-center justify-center p-2 md:p-6 animate-in fade-in duration-300">
            <div className="w-full max-w-[95vw] lg:max-w-[1400px] h-full max-h-[90vh] bg-[#0a0a0c] rounded-2xl border border-theme/30 shadow-[0_0_50px_rgba(var(--color-theme-glow),0.2)] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between p-4 bg-white/5 border-b border-white/10 shrink-0 gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-theme/20 text-theme-text-alt shadow-[0_0_15px_var(--color-theme)]">
                            <Code2 size={20} />
                        </div>
                        <div className="hidden sm:block">
                            <h2 className="text-white font-bold text-lg leading-tight">Collaborative Sandbox</h2>
                            <p className="text-theme-text-alt text-xs font-mono uppercase tracking-widest">{sandboxId} • {channelId}</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center bg-black/50 border border-white/10 rounded-lg overflow-hidden mr-1 sm:mr-2">
                            <button 
                                onClick={() => setActiveTab('code')}
                                className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-bold transition-colors ${activeTab === 'code' ? 'bg-theme/20 text-theme-text-alt' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
                            >
                                Code
                            </button>
                            <button 
                                onClick={() => setActiveTab('preview')}
                                className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-bold transition-colors ${activeTab === 'preview' ? 'bg-theme/20 text-theme-text-alt' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
                            >
                                Preview
                            </button>
                        </div>
                        <div className="flex items-center bg-black/50 border border-white/10 rounded-lg overflow-hidden max-w-[100px] sm:max-w-none">
                            <select 
                                value={activeFile && files[activeFile] ? files[activeFile].language : 'javascript'}
                                onChange={(e) => {
                                    if (activeFile) {
                                        setFiles(prev => ({ ...prev, [activeFile]: { ...prev[activeFile], language: e.target.value } }));
                                        socket.emit('sandbox:update_file', { channelId, sandboxId, filename: activeFile, language: e.target.value });
                                    }
                                }}
                                className="bg-transparent text-white text-xs sm:text-sm px-2 sm:px-3 py-1.5 focus:outline-none appearance-none cursor-pointer"
                            >
                                <option value="javascript">JS</option>
                                <option value="typescript">TS</option>
                                <option value="html">HTML</option>
                                <option value="python">PY</option>
                                <option value="go">Go</option>
                                <option value="cpp">C++</option>
                            </select>
                        </div>
                        <div className="flex items-center bg-black/50 border border-white/10 rounded-lg overflow-hidden">
                            <select
                                value={runMode}
                                onChange={(e) => setRunMode(e.target.value as 'file' | 'project')}
                                className="bg-transparent text-emerald-400 font-bold text-xs sm:text-sm px-2 sm:px-3 py-1.5 focus:outline-none appearance-none cursor-pointer"
                            >
                                <option value="file">Run Active File</option>
                                <option value="project">Run Full Stack</option>
                            </select>
                            <button 
                                onClick={runCode}
                                disabled={isRunning}
                                className="flex items-center gap-1 sm:gap-2 bg-theme/20 hover:bg-theme/30 text-theme-text-alt px-3 sm:px-4 py-1.5 transition-all font-bold tracking-wide bouncy-hover text-xs sm:text-sm border-l border-white/10"
                            >
                                {isRunning ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                                <span className="hidden sm:inline">RUN</span>
                            </button>
                        </div>
                        <div className="flex items-center bg-black/50 border border-white/10 rounded-lg overflow-hidden">
                            <select
                                value={previewMode}
                                onChange={(e) => setPreviewMode(e.target.value as 'multi' | 'single')}
                                className="bg-transparent text-white/70 text-xs sm:text-sm px-2 py-1.5 focus:outline-none appearance-none cursor-pointer"
                            >
                                <option value="multi">App Preview</option>
                                <option value="single">Single File</option>
                            </select>
                        </div>
                        <div className="flex items-center gap-1 bg-black/30 p-1 rounded-lg border border-white/5">
                            <button onClick={() => setIsFileExplorerOpen(!isFileExplorerOpen)} className={`p-1.5 transition-colors ${isFileExplorerOpen ? 'bg-theme/20 text-theme-text-alt' : 'text-white/50 hover:text-white hover:bg-white/5'} rounded-md`} title="Toggle File Explorer">
                                <PanelLeft size={16} />
                            </button>
                            <button onClick={() => setIsTerminalOpen(!isTerminalOpen)} className={`p-1.5 transition-colors ${isTerminalOpen ? 'bg-theme/20 text-theme-text-alt' : 'text-white/50 hover:text-white hover:bg-white/5'} rounded-md`} title="Toggle Terminal">
                                <PanelBottom size={16} />
                            </button>
                        </div>
                        <div className="w-px h-6 bg-white/10 mx-0 sm:mx-1"></div>
                        <button onClick={onClose} className="p-1.5 hover:bg-rose-500/20 text-white/50 hover:text-rose-400 rounded-lg transition-colors border border-transparent hover:border-rose-500/30" title="Close Sandbox">
                            <X size={18} />
                        </button>
                        <button 
                            onClick={onToggleAgent} 
                            className={`p-2 rounded-lg transition-colors border border-transparent ${isAgentOpen ? 'bg-emerald-500/20 text-emerald-400 hover:border-emerald-500/30' : 'hover:bg-theme/20 text-white/50 hover:text-white hover:border-theme/30'}`}
                            title="Toggle Agent IDE"
                        >
                            <Bot size={20} />
                        </button>
                    </div>
                </div>

                <style>
                    {Object.entries(remoteCursors).map(([sid, cursor]: [string, any]) => `
                        .remote-cursor-${sid} {
                            background-color: ${stringToColor(sid).replace('hsl', 'hsla').replace(')', ', 0.2)')};
                        }
                        .remote-caret-${sid} {
                            border-left: 2px solid ${stringToColor(sid)};
                            position: relative;
                            z-index: 10;
                        }
                        .remote-caret-${sid}::after {
                            content: '${cursor.name}';
                            position: absolute;
                            top: -16px;
                            left: 0;
                            background-color: ${stringToColor(sid)};
                            color: white;
                            font-size: 10px;
                            padding: 2px 4px;
                            border-radius: 2px;
                            white-space: nowrap;
                            pointer-events: none;
                        }
                    `).join('\n')}
                </style>
                <div className="flex flex-1 min-h-0 overflow-hidden">
                    {/* Sidebar */}
                    <div className={`${isFileExplorerOpen ? 'w-48 border-r border-white/10' : 'w-0 overflow-hidden opacity-0'} transition-all duration-300 bg-black/50 flex flex-col shrink-0`}>
                        <div className="px-3 py-2 flex justify-between items-center text-white/50 text-xs font-bold uppercase tracking-widest border-b border-white/10">
                            <span>Files</span>
                            <button onClick={() => setIsCreatingFile(true)} className="hover:text-white transition-colors" title="New File">
                                <Plus size={14} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                            {isCreatingFile && (
                                <div className="flex items-center gap-2 mb-2 bg-white/5 p-1 rounded">
                                    <input 
                                        type="text" 
                                        value={newFilename} 
                                        onChange={e => setNewFilename(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleCreateFile()}
                                        placeholder="index.js"
                                        className="w-full bg-transparent text-white text-xs outline-none"
                                        autoFocus
                                    />
                                    <button onClick={handleCreateFile} className="text-emerald-400 hover:text-emerald-300">
                                        <Plus size={14} />
                                    </button>
                                </div>
                            )}
                            {Object.entries(files).map(([filename]) => (
                                <div 
                                    key={filename}
                                    onClick={() => handleSwitchFile(filename)}
                                    className={`flex items-center justify-between group px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${activeFile === filename ? 'bg-theme/20 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'}`}
                                >
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        <FileText size={14} className="shrink-0" />
                                        <span className="text-sm truncate">{filename}</span>
                                    </div>
                                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const blob = new Blob([files[filename].code], { type: 'text/plain' });
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = url;
                                                a.download = filename;
                                                a.click();
                                                URL.revokeObjectURL(url);
                                            }}
                                            className="text-emerald-400/50 hover:text-emerald-400 transition-colors"
                                            title="Download File"
                                        >
                                            <Download size={12} />
                                        </button>
                                        <button 
                                            onClick={(e) => handleDeleteFile(e, filename)}
                                            className="text-rose-500/50 hover:text-rose-500 transition-colors"
                                            title="Delete File"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    
                    {/* Main Content Area (Editor + Terminal) */}
                    <div className="flex flex-col flex-1 min-w-0">
                        {/* Editor / Preview */}
                        <div className="flex-1 overflow-hidden relative" ref={containerRef} onMouseMove={handleMouseMove}>
                            <div className={activeTab === 'code' ? 'block h-full w-full' : 'hidden'}>
                                <Editor
                                height="100%"
                                language={(activeFile && files[activeFile]) ? (files[activeFile].language === 'js' ? 'javascript' : files[activeFile].language) : 'javascript'}
                                theme="vs-dark"
                                value={activeFile && files[activeFile] ? files[activeFile].code : ''}
                                onChange={handleCodeChange}
                                onMount={handleEditorDidMount}
                                options={{
                                    minimap: { enabled: false },
                                    fontSize: 14,
                                    fontFamily: '"Fira Code", "JetBrains Mono", monospace',
                                    wordWrap: 'on',
                                    padding: { top: 24, bottom: 24 },
                                    scrollBeyondLastLine: false,
                                    smoothScrolling: true
                                }}
                            />
                        </div>
                        <div className={`${activeTab === 'preview' ? 'block h-full w-full' : 'hidden'} bg-white`}>
                                <iframe 
                                    srcDoc={getPreviewHtml()}
                                className="w-full h-full border-none"
                                sandbox="allow-scripts allow-same-origin allow-modals"
                                title="Sandbox Preview"
                            />
                        </div>
                        {/* Render Virtual Pointers */}
                        {Object.entries(pointers).map(([sid, ptr]: [string, any]) => (
                            <div 
                                key={sid}
                                className="absolute pointer-events-none transition-all duration-75 z-50"
                                style={{
                                    left: `${ptr.x * 100}%`,
                                    top: `${ptr.y * 100}%`,
                                    transform: 'translate(-2px, -2px)'
                                }}
                            >
                                <MousePointer2 size={24} className="text-white drop-shadow-md" style={{ fill: stringToColor(sid) }} />
                                <div className="mt-1 ml-4 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-lg whitespace-nowrap" style={{ backgroundColor: stringToColor(sid) }}>
                                    {ptr.name}
                                </div>
                            </div>
                        ))}
                        </div>
                        
                        {/* Output Terminal */}
                        <div className={`${isTerminalOpen ? 'h-48 md:h-64 border-t border-white/10' : 'h-0 border-t-0'} transition-all duration-300 bg-black flex flex-col shrink-0 overflow-hidden`}>
                            <div className="px-4 py-2 bg-white/5 border-b border-white/5 text-white/40 text-xs font-bold uppercase tracking-widest flex justify-between items-center shrink-0">
                                <span>Console Output</span>
                                <button onClick={() => setOutput([])} className="hover:text-white transition-colors">Clear</button>
                            </div>
                            <div className="p-4 flex-1 overflow-y-auto custom-scrollbar font-mono text-xs space-y-2">
                                {output.length === 0 ? (
                                    <div className="text-white/20 italic">Run the code to see output...</div>
                                ) : (
                                    output.map((line, i) => (
                                        <div key={i} className={`${line.includes('[ERROR]') ? 'text-rose-400' : line.includes('[WARN]') ? 'text-amber-400' : line.startsWith('>') ? 'text-white/40 font-bold' : 'text-emerald-400'}`}>
                                            {line}
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Floating Side Tab UI for Agent IDE */}
            <button 
                onClick={onToggleAgent}
                className={`fixed right-0 top-1/2 -translate-y-1/2 z-[450] p-2 sm:p-3 rounded-l-xl border-y border-l border-theme/30 shadow-[0_0_15px_rgba(var(--color-theme-glow),0.3)] backdrop-blur-md transition-all duration-300 ${isAgentOpen ? 'translate-x-full opacity-0 pointer-events-none' : 'bg-black/60 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 translate-x-0 opacity-100'}`}
                title="Toggle Agent IDE"
            >
                <div className="flex flex-col items-center gap-1">
                    <Bot size={20} />
                    <span className="text-[10px] font-bold tracking-widest writing-vertical-rl rotate-180 hidden sm:block mt-2">AGENT</span>
                </div>
            </button>
        </div>
    );
}
