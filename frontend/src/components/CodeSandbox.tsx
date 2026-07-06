import { useState } from 'react';
import { Play, Terminal, X, RefreshCw } from 'lucide-react';

interface CodeSandboxProps {
    language: string;
    code: string;
}

export function CodeSandbox({ language, code }: CodeSandboxProps) {
    const [output, setOutput] = useState<string[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [showTerminal, setShowTerminal] = useState(false);
    
    const runCode = () => {
        setIsRunning(true);
        setShowTerminal(true);
        setOutput(['> Sandbox Started...']);
        
        setTimeout(() => {
            let logs: string[] = [];
            const originalLog = console.log;
            const originalError = console.error;
            const originalWarn = console.warn;
            
            console.log = (...args) => {
                logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
                originalLog(...args);
            };
            console.error = (...args) => {
                logs.push('[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
                originalError(...args);
            };
            console.warn = (...args) => {
                logs.push('[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
                originalWarn(...args);
            };
            
            try {
                const result = new Function(code)();
                if (result !== undefined) {
                    logs.push(`\n<- ${typeof result === 'object' ? JSON.stringify(result) : String(result)}`);
                }
            } catch (err: any) {
                logs.push(`[RUNTIME ERROR] ${err.message || String(err)}`);
            }
            
            console.log = originalLog;
            console.error = originalError;
            console.warn = originalWarn;
            
            logs.push('> Execution Complete.');
            setOutput(prev => [...prev, ...logs]);
            setIsRunning(false);
        }, 100);
    };

    return (
        <div className="relative group my-2 border border-white/10 rounded-xl overflow-hidden bg-black/50">
            <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/5">
                <span className="text-xs font-mono text-white/50 lowercase">{language}</span>
                {language.toLowerCase() === 'javascript' || language.toLowerCase() === 'js' ? (
                    <button 
                        onClick={runCode}
                        disabled={isRunning}
                        className="flex items-center gap-1.5 text-xs bg-theme/20 hover:bg-theme/30 text-theme-text-alt px-2 py-1 rounded-md transition-colors font-medium bouncy-hover"
                    >
                        {isRunning ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}
                        Run Sandbox
                    </button>
                ) : (
                    <span className="text-xs text-white/30 italic">Not executable</span>
                )}
            </div>
            
            <div className="p-3 overflow-x-auto text-sm font-mono text-white/80 custom-scrollbar whitespace-pre-wrap break-words">
                {code}
            </div>

            {showTerminal && (
                <div className="border-t border-theme/20 bg-[#0a0a0c] p-3 text-xs font-mono">
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/5">
                        <div className="flex items-center gap-2 text-theme-text-alt font-semibold">
                            <Terminal size={14} /> Output
                        </div>
                        <button onClick={() => setShowTerminal(false)} className="text-white/40 hover:text-white transition-colors">
                            <X size={14} />
                        </button>
                    </div>
                    <div className="space-y-1 max-h-60 overflow-y-auto custom-scrollbar">
                        {output.map((line, i) => (
                            <div key={i} className={`${line.includes('[ERROR]') ? 'text-rose-400' : line.includes('[WARN]') ? 'text-amber-400' : line.startsWith('>') ? 'text-white/40' : 'text-emerald-400'}`}>
                                {line}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

