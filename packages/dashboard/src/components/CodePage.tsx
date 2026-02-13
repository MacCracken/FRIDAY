import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import Editor, { type OnMount } from '@monaco-editor/react';
import {
  Send,
  Loader2,
  Bot,
  User,
  Code2,
  ChevronDown,
  ArrowDownToLine,
  Terminal,
  FolderOpen,
  Play,
  Trash2,
  ChevronRight,
  File,
  Folder,
} from 'lucide-react';
import { fetchPersonalities, executeTerminalCommand } from '../api/client';
import { useChat } from '../hooks/useChat';
import { useVoice } from '../hooks/useVoice';
import { useTheme } from '../hooks/useTheme';
import { VoiceToggle } from './VoiceToggle';
import type { Personality, ChatMessage } from '../types';

type MonacoEditor = Parameters<OnMount>[0];

interface TerminalOutput {
  id: string;
  command: string;
  output: string;
  error: string;
  exitCode: number;
  timestamp: number;
}

const LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  sh: 'shell',
  bash: 'shell',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  html: 'html',
  css: 'css',
  sql: 'sql',
  xml: 'xml',
  toml: 'toml',
};

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return LANG_MAP[ext] ?? 'plaintext';
}

export function CodePage() {
  const { theme } = useTheme();
  const [filename, setFilename] = useState('untitled.ts');
  const [language, setLanguage] = useState(() => detectLanguage('untitled.ts'));
  const [filesPanelOpen, setFilesPanelOpen] = useState(false);
  const [cwd, setCwd] = useState('/tmp');
  const files = [{ name: 'untitled.ts', path: `${cwd}/untitled.ts` }];
  const [selectedPersonalityId, setSelectedPersonalityId] = useState<string | null>(null);
  const [terminalInput, setTerminalInput] = useState('');
  const [terminalHistory, setTerminalHistory] = useState<TerminalOutput[]>([]);
  const editorRef = useRef<MonacoEditor | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const terminalInputRef = useRef<HTMLInputElement>(null);

  const { data: personalitiesData } = useQuery({
    queryKey: ['personalities'],
    queryFn: fetchPersonalities,
  });

  const personalities = personalitiesData?.personalities ?? [];
  const activePersonality = personalities.find((p) => p.isActive);
  const effectivePersonalityId = selectedPersonalityId ?? activePersonality?.id ?? null;
  const currentPersonality = personalities.find((p) => p.id === effectivePersonalityId);

  const { messages, input, setInput, handleSend, isPending, clearMessages } = useChat({
    personalityId: effectivePersonalityId,
  });
  const voice = useVoice();

  const terminalMutation = useMutation({
    mutationFn: ({ command, cwd }: { command: string; cwd: string }) =>
      executeTerminalCommand(command, cwd),
    onSuccess: (result, variables) => {
      setTerminalHistory((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          command: variables.command,
          output: result.output,
          error: result.error,
          exitCode: result.exitCode,
          timestamp: Date.now(),
        },
      ]);
      if (result.cwd) {
        setCwd(result.cwd);
      }
      setTerminalInput('');
    },
    onError: (error: Error, variables) => {
      setTerminalHistory((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          command: variables.command,
          output: '',
          error: error.message,
          exitCode: 1,
          timestamp: Date.now(),
        },
      ]);
      setTerminalInput('');
    },
  });

  // Feed voice transcript into input
  useEffect(() => {
    if (voice.transcript) {
      setInput((prev: string) => prev + voice.transcript);
      voice.clearTranscript();
    }
  }, [voice.transcript, setInput, voice.clearTranscript]);

  // Speak assistant messages when voice is enabled
  const lastMsgCount = useRef(0);
  useEffect(() => {
    if (messages.length > lastMsgCount.current) {
      const latest = messages[messages.length - 1];
      if (latest.role === 'assistant' && voice.voiceEnabled) {
        voice.speak(latest.content);
      }
    }
    lastMsgCount.current = messages.length;
  }, [messages.length, voice.voiceEnabled, voice.speak, messages]);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isPending]);

  // Auto-scroll terminal
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalHistory.length, terminalMutation.isPending]);

  // Refocus terminal input after command completes
  useEffect(() => {
    if (!terminalMutation.isPending && terminalInputRef.current) {
      terminalInputRef.current.focus();
    }
  }, [terminalMutation.isPending, terminalHistory.length]);

  // Update language when filename changes
  useEffect(() => {
    setLanguage(detectLanguage(filename));
  }, [filename]);

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  const handleSendToChat = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const selection = editor.getSelection();
    let text = '';
    if (selection && !selection.isEmpty()) {
      text = editor.getModel()?.getValueInRange(selection) ?? '';
    } else {
      text = editor.getValue();
    }

    if (!text.trim()) return;
    setInput(`\`\`\`${language}\n${text}\n\`\`\``);
  }, [language, setInput]);

  const handleInsertAtCursor = useCallback((msg: ChatMessage) => {
    const editor = editorRef.current;
    if (!editor) return;

    const codeBlockMatch = msg.content.match(/```[\w]*\n([\s\S]*?)```/);
    const textToInsert = codeBlockMatch ? codeBlockMatch[1] : msg.content;

    const position = editor.getPosition();
    if (position) {
      editor.executeEdits('insert-from-chat', [
        {
          range: {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          },
          text: textToInsert,
        },
      ]);
      editor.focus();
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleTerminalSubmit = useCallback(() => {
    if (!terminalInput.trim() || terminalMutation.isPending) return;
    terminalMutation.mutate({ command: terminalInput.trim(), cwd: cwd });
  }, [terminalInput, cwd, terminalMutation]);

  const handleTerminalKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleTerminalSubmit();
      }
    },
    [handleTerminalSubmit]
  );

  const clearTerminal = useCallback(() => {
    setTerminalHistory([]);
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-180px)]">
      {/* Page header */}
      <div className="flex items-center gap-3 pb-3 border-b mb-3">
        <Code2 className="w-6 h-6 text-primary" />
        <h2 className="text-lg font-semibold">Code Editor</h2>
      </div>

      {/* Three-panel responsive layout: Editor | Chat side by side, Terminal at bottom */}
      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto">
        {/* Top row — Code Editor & Chat side by side */}
        <div className="flex-1 flex flex-col lg:flex-row gap-3 min-h-0 lg:min-h-0">
          {/* Left panel — Code Editor */}
          <div className="flex flex-col flex-1 lg:flex-[60] min-h-[250px] lg:min-h-0 border rounded-lg overflow-hidden bg-card">
            {/* Editor toolbar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 flex-wrap">
              <button
                onClick={() => setFilesPanelOpen(!filesPanelOpen)}
                className="btn-ghost p-1 rounded"
                title="Toggle files panel"
              >
                <ChevronRight
                  className={`w-4 h-4 transition-transform ${filesPanelOpen ? 'rotate-90' : ''}`}
                />
              </button>
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                className="bg-transparent border border-border rounded px-2 py-1 text-sm font-mono w-32 sm:w-48 focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="filename.ext"
              />
              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded hidden sm:inline">
                {language}
              </span>
              <div className="flex-1" />
              <button
                onClick={handleSendToChat}
                className="btn-ghost text-xs px-2 sm:px-3 py-1.5 rounded border hover:border-primary"
                title="Send selected text (or all) to chat"
              >
                <span className="hidden sm:inline">Send to Chat</span>
                <span className="sm:hidden">Send</span>
              </button>
            </div>

            {/* Collapsible Files Panel */}
            <div
              className={`border-b bg-muted transition-all ${filesPanelOpen ? 'max-h-48' : 'max-h-0'} overflow-hidden`}
            >
              <div className="px-3 py-2 space-y-2">
                <div className="flex items-center gap-2">
                  <Folder className="w-3 h-3 text-muted-foreground" />
                  <input
                    type="text"
                    value={cwd}
                    onChange={(e) => setCwd(e.target.value)}
                    className="flex-1 bg-transparent border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="/path/to/folder"
                  />
                </div>
                <div className="space-y-1">
                  {files.map((file) => (
                    <button
                      key={file.path}
                      onClick={() => setFilename(file.name)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono text-left hover:bg-muted/50 ${
                        filename === file.name ? 'bg-primary/10 text-primary' : ''
                      }`}
                    >
                      <File className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{file.path}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Monaco Editor placeholder */}
            <div className="flex-1 min-h-0 flex items-center justify-center bg-card">
              <p className="text-muted-foreground">Code editor coming soon...</p>
            </div>
          </div>

          {/* Right panel — Chat Sidebar */}
          <div className="flex flex-col flex-1 lg:flex-[40] min-h-[200px] lg:min-h-0 border rounded-lg overflow-hidden bg-card">
            {/* Sidebar header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
              <Bot className="w-4 h-4 text-primary flex-shrink-0" />

              {/* Personality selector */}
              <div className="relative flex-1 min-w-0">
                <select
                  value={effectivePersonalityId ?? ''}
                  onChange={(e) => setSelectedPersonalityId(e.target.value || null)}
                  className="w-full bg-transparent border border-border rounded px-2 py-1 text-xs appearance-none pr-6 focus:outline-none focus:ring-1 focus:ring-primary truncate"
                >
                  <option value="">Default Assistant</option>
                  {personalities.map((p: Personality) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.isActive ? ' (active)' : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
              </div>

              <VoiceToggle
                voiceEnabled={voice.voiceEnabled}
                isListening={voice.isListening}
                isSpeaking={voice.isSpeaking}
                supported={voice.supported}
                onToggle={voice.toggleVoice}
              />
            </div>

            {/* Chat messages */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
              {messages.length === 0 && (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <Bot className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-xs">
                      Chat with {currentPersonality?.name ?? 'the assistant'} about your code.
                    </p>
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[90%] rounded-lg px-3 py-2 ${
                      msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      {msg.role === 'user' ? (
                        <User className="w-3 h-3" />
                      ) : (
                        <Bot className="w-3 h-3" />
                      )}
                      <span className="text-[10px] opacity-70">
                        {msg.role === 'user' ? 'You' : (currentPersonality?.name ?? 'Assistant')}
                      </span>
                    </div>
                    <p className="text-xs whitespace-pre-wrap">{msg.content}</p>
                    {msg.role === 'assistant' && (
                      <button
                        onClick={() => handleInsertAtCursor(msg)}
                        className="flex items-center gap-1 text-[10px] text-primary mt-1.5 hover:underline"
                        title="Insert code at cursor position in editor"
                      >
                        <ArrowDownToLine className="w-3 h-3" />
                        Insert at Cursor
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {isPending && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-lg px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <Bot className="w-3 h-3" />
                      <span className="text-[10px] opacity-70">
                        {currentPersonality?.name ?? 'Assistant'}
                      </span>
                    </div>
                    <div className="flex gap-1 mt-1.5">
                      <span
                        className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce"
                        style={{ animationDelay: '0ms' }}
                      />
                      <span
                        className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce"
                        style={{ animationDelay: '150ms' }}
                      />
                      <span
                        className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce"
                        style={{ animationDelay: '300ms' }}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Chat input */}
            <div className="border-t px-3 py-2">
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message ${currentPersonality?.name ?? 'assistant'}...`}
                  disabled={isPending}
                  rows={1}
                  className="flex-1 resize-none rounded border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isPending}
                  className="btn-primary px-3 py-2 rounded disabled:opacity-50"
                >
                  {isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Send className="w-3 h-3" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom panel — Terminal (full width, below Editor+Chat) */}
        <div className="flex flex-col h-[150px] sm:h-[180px] lg:h-[200px] border rounded-lg overflow-hidden bg-card flex-shrink-0">
          {/* Terminal toolbar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 flex-wrap">
            <Terminal className="w-4 h-4 text-primary flex-shrink-0" />
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <FolderOpen className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <input
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                className="bg-transparent border-none px-1 py-0.5 text-xs font-mono flex-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-primary rounded"
                placeholder="Working directory"
              />
            </div>
            <button
              onClick={clearTerminal}
              className="btn-ghost text-xs p-1.5 rounded hover:text-destructive flex-shrink-0"
              title="Clear terminal"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>

          {/* Terminal output */}
          <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs space-y-1 bg-black text-white">
            {terminalHistory.length === 0 && !terminalInput && (
              <div className="text-muted-foreground opacity-50">
                # Terminal ready. Type commands below.
              </div>
            )}
            {terminalHistory.map((entry) => (
              <div key={entry.id} className="space-y-1">
                <div className="flex items-start gap-1">
                  <span className="text-green-400">➜</span>
                  <span className="text-blue-400">{cwd}</span>
                  <span className="text-white">$</span>
                  <span className="text-white">{entry.command}</span>
                </div>
                {entry.output && (
                  <div className="text-gray-300 whitespace-pre-wrap pl-4">{entry.output}</div>
                )}
                {entry.error && (
                  <div className="text-red-400 whitespace-pre-wrap pl-4">{entry.error}</div>
                )}
                {entry.exitCode !== 0 && (
                  <div className="text-red-500 text-[10px] pl-4">Exit code: {entry.exitCode}</div>
                )}
              </div>
            ))}
            {terminalMutation.isPending && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Running...</span>
              </div>
            )}
            {/* Current input line */}
            <div className="flex items-center gap-1">
              <span className="text-green-400">➜</span>
              <span className="text-blue-400">{cwd}</span>
              <span className="text-white">$</span>
              <input
                ref={terminalInputRef}
                type="text"
                value={terminalInput}
                onChange={(e) => setTerminalInput(e.target.value)}
                onKeyDown={handleTerminalKeyDown}
                placeholder="Type command..."
                disabled={terminalMutation.isPending}
                className="flex-1 bg-transparent border-none px-0 py-0 text-xs font-mono focus:outline-none text-white placeholder:text-gray-500 disabled:opacity-50"
              />
            </div>
            <div ref={terminalEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
