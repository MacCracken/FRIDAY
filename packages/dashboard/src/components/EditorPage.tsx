import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
import {
  Send,
  Loader2,
  Bot,
  User,
  ChevronDown,
  ArrowDownToLine,
  Play,
  Folder,
  Mic,
  Eye,
  Sparkles,
  Settings,
  Plus,
  X,
  Wrench,
  Star,
  Globe,
  GitBranch,
} from 'lucide-react';
import {
  fetchPersonalities,
  executeTerminalCommand,
  fetchSecurityPolicy,
  addMemory,
  fetchModelInfo,
  switchModel,
} from '../api/client';
import { useChatStream } from '../hooks/useChat';
import { useCommandPalette, type CommandItem } from '../hooks/useCommandPalette';
import { useAiCommitMessage } from '../hooks/useAiCommitMessage';
import { ThinkingBlock } from './ThinkingBlock';
import { useVoice } from '../hooks/useVoice';
import { usePushToTalk } from '../hooks/usePushToTalk';
import { useTheme } from '../hooks/useTheme';
import { VoiceOverlay } from './VoiceOverlay';
import type { Personality, ChatMessage, CreationEvent } from '../types';
import { sanitizeText } from '../utils/sanitize';
import { ChatMarkdown } from './ChatMarkdown';
import { Link, useNavigate } from 'react-router-dom';
import { AgentWorldWidget } from './AgentWorldWidget';
import { AdvancedEditorPage } from './AdvancedEditor/AdvancedEditorPage';
import { useKeybindings, matchesShortcut } from '../hooks/useKeybindings';
import { EntityWidget, type EntityState } from './EntityWidget';
import { useCollabMonaco } from '../hooks/useCollabMonaco';
import { useInlineCompletion } from '../hooks/useInlineCompletion';

import {
  type MonacoEditor,
  type BottomTab,
  type EditorTab,
  detectLanguage,
  createEditorTab,
  RUN_COMMANDS,
  CommandPalette,
  ProjectExplorer,
  GitPanel,
  EditorToolbar,
  KeybindingsEditor,
  AiPlanPanel,
  type AiPlan,
  type PlanStep,
  SearchPanel,
  useAnnotationContextMenu,
  MultiTerminal,
  SessionsPanel,
  HistoryPanel,
  ExecutionGated,
} from './editor';

// ── Main Component ───────────────────────────────────────────────

export function EditorPage() {
  const { data: policy } = useQuery({
    queryKey: ['security-policy'],
    queryFn: fetchSecurityPolicy,
    staleTime: 30000,
  });
  if (policy?.allowAdvancedEditor) return <AdvancedEditorPage />;
  return <StandardEditorPage />;
}

function StandardEditorPage() {
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tabs, setTabs] = useState<EditorTab[]>(() => [createEditorTab('untitled.ts', '/tmp')]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  const [showExplorer, setShowExplorer] = useState(
    () => localStorage.getItem('editor:showExplorer') === 'true'
  );
  const [cwd, setCwd] = useState('/tmp');
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [selectedPersonalityId, setSelectedPersonalityIdRaw] = useState<string | null>(() =>
    localStorage.getItem('soul:editorPersonalityId')
  );
  const setSelectedPersonalityId = (id: string | null) => {
    if (id) localStorage.setItem('soul:editorPersonalityId', id);
    else localStorage.removeItem('soul:editorPersonalityId');
    setSelectedPersonalityIdRaw(id);
  };
  const [activeBottomTab, setActiveBottomTab] = useState<BottomTab>('terminal');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [splitView, setSplitView] = useState(false);
  const [editorSettings, setEditorSettings] = useState({
    fontSize: 14,
    tabSize: 2,
    minimap: false,
    wordWrap: true,
    lineNumbers: true,
  });
  const editorRef = useRef<MonacoEditor | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Inline AI completion ──
  const [inlineCompletionEnabled, _setInlineCompletionEnabled] = useState(
    () => localStorage.getItem('editor:inlineCompletion') !== 'false'
  );
  const { bindEditor: completionBindEditor, unbindEditor: _completionUnbindEditor } =
    useInlineCompletion({ enabled: inlineCompletionEnabled, personalityId: selectedPersonalityId });

  // ── Training annotations ──
  const { registerAction: registerAnnotationAction, PopoverComponent: annotationPopover } =
    useAnnotationContextMenu(selectedPersonalityId);

  // ── Multi-file search ──
  const [showSearch, setShowSearch] = useState(false);

  // ── Terminal output ref (feeds watch mode in chat) ──
  const terminalOutputRef = useRef('');

  // ── Memory ──
  const [memoryEnabled, setMemoryEnabled] = useState(
    () => localStorage.getItem('editor:memoryEnabled') !== 'false'
  );

  // ── Model ──
  const { data: modelInfo } = useQuery({
    queryKey: ['model-info'],
    queryFn: fetchModelInfo,
    staleTime: 30000,
  });

  // ── Chat visibility ──
  const [showChat, setShowChat] = useState(
    () => localStorage.getItem('editor:showChat') !== 'false'
  );

  // ── Agent World ──
  const [showWorld, setShowWorld] = useState(
    () => localStorage.getItem('editor:showWorld') === 'true'
  );
  const [worldViewMode, setWorldViewMode] = useState<'grid' | 'map' | 'large'>(
    () => (localStorage.getItem('world:viewMode') ?? 'grid') as 'grid' | 'map' | 'large'
  );

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const filename = activeTab?.name ?? 'untitled.ts';
  const language = activeTab?.language ?? 'typescript';
  const editorContent = activeTab?.content ?? '';

  // ── Collaborative editing ──
  const collabDocId = activeTab?.path ? `file:${activeTab.path}` : null;
  const {
    bindEditor: collabBindEditor,
    unbindEditor: _collabUnbindEditor,
    presenceUsers: collabUsers,
    connected: collabConnected,
  } = useCollabMonaco(collabDocId);

  const updateTabContent = useCallback(
    (content: string) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, content, isDirty: true } : t))
      );
    },
    [activeTabId]
  );

  const _updateTabName = useCallback(
    (name: string) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? { ...t, name, path: `${cwd}/${name}`, language: detectLanguage(name), isDirty: true }
            : t
        )
      );
    },
    [activeTabId, cwd]
  );

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const newTabs = prev.filter((t) => t.id !== tabId);
        if (newTabs.length === 0) {
          return [createEditorTab('untitled.ts', cwd)];
        }
        return newTabs;
      });
      if (activeTabId === tabId) {
        setActiveTabId(tabs[0]?.id ?? tabs[0].id);
      }
    },
    [activeTabId, tabs, cwd]
  );

  const createNewTab = useCallback(() => {
    const newTab = createEditorTab('untitled.ts', cwd);
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [cwd]);

  const { data: personalitiesData } = useQuery({
    queryKey: ['personalities'],
    queryFn: fetchPersonalities,
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const personalities = personalitiesData?.personalities ?? [];
  const defaultPersonality =
    personalities.find((p) => p.isDefault) ??
    [...personalities].sort((a, b) => a.name.localeCompare(b.name))[0];
  const effectivePersonalityId = selectedPersonalityId ?? defaultPersonality?.id ?? null;
  const currentPersonality = personalities.find((p) => p.id === effectivePersonalityId);

  const hasVision = currentPersonality?.body?.capabilities?.includes('vision') ?? false;
  const [watchEnabled, setWatchEnabled] = useState(false);

  // saveMemory — called by MultiTerminal after each command completes
  const saveMemory = useCallback(
    (command: string, output: string) => {
      if (!memoryEnabled) return;
      void addMemory({
        type: 'episodic',
        content: `Command: ${command}\nOutput: ${output}`,
        source: 'workspace',
        context: effectivePersonalityId ? { personalityId: effectivePersonalityId } : {},
        importance: 0.5,
      }).then(() => {
        void queryClient.invalidateQueries({ queryKey: ['workspace-memories'] });
      });
    },
    [memoryEnabled, effectivePersonalityId, queryClient]
  );

  // Auto-switch model when personality changes
  useEffect(() => {
    if (currentPersonality?.defaultModel) {
      void switchModel({
        provider: currentPersonality.defaultModel.provider,
        model: currentPersonality.defaultModel.model,
      }).then(() => {
        void queryClient.invalidateQueries({ queryKey: ['model-info'] });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePersonalityId, queryClient]);

  const { messages, sendMessage, isPending, streamingThinking, streamingContent, activeToolCalls } =
    useChatStream({
      personalityId: effectivePersonalityId,
      editorContent: watchEnabled ? terminalOutputRef.current || undefined : undefined,
    });

  // Local chat input state (decoupled from useChatStream)
  const [chatInput, setChatInput] = useState('');
  const handleSend = useCallback(() => {
    const trimmed = chatInput.trim();
    if (!trimmed || isPending) return;
    void sendMessage(trimmed);
    setChatInput('');
  }, [chatInput, isPending, sendMessage]);

  const [hadActiveTools, setHadActiveTools] = useState(false);
  useEffect(() => {
    if (activeToolCalls.length > 0) setHadActiveTools(true);
  }, [activeToolCalls.length]);
  useEffect(() => {
    if (!isPending) setHadActiveTools(false);
  }, [isPending]);

  const voice = useVoice();

  const ptt = usePushToTalk(
    { hotkey: 'ctrl+shift+v', maxDurationMs: 60000, silenceTimeoutMs: 2000 },
    (transcript) => {
      if (transcript) {
        setChatInput((prev) => prev + transcript);
      }
    }
  );

  useEffect(() => {
    loader.config({ paths: { vs: '/vs' } });
  }, []);

  // Minimal mutation used by the Run Code button (output rendered in MultiTerminal by user)
  const runCodeMutation = useMutation({
    mutationFn: ({ command, cwd }: { command: string; cwd: string }) =>
      executeTerminalCommand(command, cwd),
    onSuccess: (result) => {
      if (result.cwd) setCwd(result.cwd);
    },
  });

  // Feed voice transcript into chat input
  useEffect(() => {
    if (voice.transcript) {
      setChatInput((prev) => prev + voice.transcript);
      voice.clearTranscript();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.transcript, voice.clearTranscript]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, voice.voiceEnabled, voice.speak, messages]);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isPending]);

  // Update tab language when filename changes
  useEffect(() => {
    if (activeTab && activeTab.name !== filename) {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, language: detectLanguage(t.name) } : t))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({ theme: isDark ? 'vs-dark' : 'vs' });
    }
  }, [isDark]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.updateOptions({ theme: isDark ? 'vs-dark' : 'vs' });
    collabBindEditor(editor);
    completionBindEditor(editor, monaco);
    registerAnnotationAction(editor, monaco);
  };

  const handleSendToChat = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const selection = editor.getSelection();
    let text: string;
    if (selection && !selection.isEmpty()) {
      text = editor.getModel()?.getValueInRange(selection) ?? '';
    } else {
      text = editor.getValue();
    }

    if (!text.trim()) return;
    setChatInput(`\`\`\`${language}\n${text}\n\`\`\``);
  }, [language]);

  const handleRunCode = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const selection = editor.getSelection();
    let code: string;
    if (selection && !selection.isEmpty()) {
      code = editor.getModel()?.getValueInRange(selection) ?? '';
    } else {
      code = editor.getValue();
    }

    if (!code.trim()) return;

    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const runner = RUN_COMMANDS[ext] || RUN_COMMANDS[language] || 'node';

    const filePath = `${cwd}/${filename}`;

    if (!runner) return;

    const writeCommand = `cat << 'FRIDAY_EOF' > "${filePath}"\n${code}\nFRIDAY_EOF`;
    const runCommand = runner.includes(' ') ? `${runner} ${filePath}` : `${runner} "${filePath}"`;

    runCodeMutation.mutate({ command: `${writeCommand} && ${runCommand}`, cwd });
  }, [filename, language, cwd, runCodeMutation]);

  // Keybindings editor
  const [keybindingsOpen, setKeybindingsOpen] = useState(false);
  const keybindings = useKeybindings();

  // Keyboard shortcuts — driven by user-configurable keybindings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Keybinding-driven shortcuts
      const actions: Record<string, () => void> = {
        'run-code': handleRunCode,
        'save-file': () => {
          setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, isDirty: false } : t)));
        },
        'new-file': createNewTab,
        'toggle-explorer': () => {
          const n = !showExplorer;
          localStorage.setItem('editor:showExplorer', String(n));
          setShowExplorer(n);
        },
        'toggle-chat': () => {
          const n = !showChat;
          localStorage.setItem('editor:showChat', String(n));
          setShowChat(n);
        },
        'toggle-git': () => {
          setActiveBottomTab(activeBottomTab === 'git' ? 'terminal' : 'git');
        },
        'toggle-settings': () => {
          setSettingsOpen((v) => !v);
        },
        'toggle-split': () => {
          setSplitView((v) => !v);
        },
        'toggle-search': () => {
          setShowSearch((v) => !v);
        },
        'close-tab': () => {
          closeTab(activeTabId);
        },
      };

      for (const binding of keybindings.bindings) {
        if (binding.shortcut && actions[binding.id] && matchesShortcut(e, binding.shortcut)) {
          e.preventDefault();
          actions[binding.id]();
          return;
        }
      }

      // Ctrl+Shift+F — toggle search panel
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setShowSearch((v) => !v);
        return;
      }

      if (e.key === 'Escape') {
        setSettingsOpen(false);
        setKeybindingsOpen(false);
        setShowSearch(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    activeTabId,
    handleRunCode,
    createNewTab,
    closeTab,
    keybindings.bindings,
    showExplorer,
    showChat,
    activeBottomTab,
  ]);

  // Command palette
  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      {
        id: 'new-file',
        label: 'New File',
        category: 'file',
        icon: <Plus className="w-3.5 h-3.5" />,
        shortcut: 'Ctrl+Shift+N',
        action: createNewTab,
        keywords: ['create', 'tab'],
      },
      {
        id: 'run-code',
        label: 'Run Code',
        category: 'file',
        icon: <Play className="w-3.5 h-3.5" />,
        shortcut: 'Ctrl+Enter',
        action: handleRunCode,
        keywords: ['execute'],
      },
      {
        id: 'toggle-explorer',
        label: 'Toggle Explorer',
        category: 'panel',
        icon: <Folder className="w-3.5 h-3.5" />,
        action: () => {
          const n = !showExplorer;
          localStorage.setItem('editor:showExplorer', String(n));
          setShowExplorer(n);
        },
        keywords: ['files', 'sidebar'],
      },
      {
        id: 'toggle-chat',
        label: 'Toggle Chat',
        category: 'panel',
        icon: <Bot className="w-3.5 h-3.5" />,
        action: () => {
          const n = !showChat;
          localStorage.setItem('editor:showChat', String(n));
          setShowChat(n);
        },
        keywords: ['ai', 'assistant'],
      },
      {
        id: 'toggle-git',
        label: 'Toggle Git Panel',
        category: 'panel',
        icon: <GitBranch className="w-3.5 h-3.5" />,
        action: () => {
          setActiveBottomTab(activeBottomTab === 'git' ? 'terminal' : 'git');
        },
        keywords: ['version', 'commit'],
      },
      {
        id: 'toggle-world',
        label: 'Toggle Agent World',
        category: 'panel',
        icon: <Globe className="w-3.5 h-3.5" />,
        action: () => {
          const n = !showWorld;
          localStorage.setItem('editor:showWorld', String(n));
          setShowWorld(n);
        },
        keywords: ['agents'],
      },
      {
        id: 'toggle-settings',
        label: 'Editor Settings',
        category: 'panel',
        icon: <Settings className="w-3.5 h-3.5" />,
        action: () => {
          setSettingsOpen((v) => !v);
        },
        keywords: ['preferences', 'config'],
      },
      {
        id: 'keybindings',
        label: 'Keyboard Shortcuts',
        category: 'panel',
        icon: <Settings className="w-3.5 h-3.5" />,
        action: () => {
          setKeybindingsOpen(true);
        },
        keywords: ['keybindings', 'hotkeys', 'shortcuts'],
      },
      {
        id: 'nav-dashboard',
        label: 'Go to Dashboard',
        category: 'navigation',
        icon: <Globe className="w-3.5 h-3.5" />,
        action: () => void navigate('/'),
        keywords: ['home'],
      },
      {
        id: 'nav-personality',
        label: 'Go to Personalities',
        category: 'navigation',
        icon: <Bot className="w-3.5 h-3.5" />,
        action: () => void navigate('/personality'),
        keywords: ['souls'],
      },
      {
        id: 'nav-security',
        label: 'Go to Security',
        category: 'navigation',
        icon: <Eye className="w-3.5 h-3.5" />,
        action: () => void navigate('/security'),
        keywords: ['policy'],
      },
    ];
    // Dynamic personality items
    personalities.forEach((p: Personality) => {
      items.push({
        id: `personality-${p.id}`,
        label: `Switch to ${p.name}`,
        category: 'personality',
        icon: <Star className="w-3.5 h-3.5" />,
        action: () => {
          setSelectedPersonalityId(p.id);
        },
        keywords: [p.name.toLowerCase()],
      });
    });
    return items;
  }, [
    createNewTab,
    handleRunCode,
    showExplorer,
    showChat,
    showWorld,
    activeBottomTab,
    personalities,
    navigate,
  ]);

  const palette = useCommandPalette(commands);

  // AI commit messages
  const aiCommit = useAiCommitMessage(cwd, effectivePersonalityId);

  // AI Plan state — populated when the AI generates a plan during chat
  const [aiPlan, setAiPlan] = useState<AiPlan | null>(null);

  const handleApproveStep = useCallback((stepId: string) => {
    setAiPlan((prev) => {
      if (!prev) return prev;
      const updateStep = (steps: PlanStep[]): PlanStep[] =>
        steps.map((s) =>
          s.id === stepId
            ? { ...s, status: 'completed' as const }
            : s.children
              ? { ...s, children: updateStep(s.children) }
              : s
        );
      return { ...prev, steps: updateStep(prev.steps) };
    });
  }, []);

  const handleRejectStep = useCallback((stepId: string) => {
    setAiPlan((prev) => {
      if (!prev) return prev;
      const updateStep = (steps: PlanStep[]): PlanStep[] =>
        steps.map((s) =>
          s.id === stepId
            ? { ...s, status: 'skipped' as const }
            : s.children
              ? { ...s, children: updateStep(s.children) }
              : s
        );
      return { ...prev, steps: updateStep(prev.steps) };
    });
  }, []);

  const handlePlanPauseResume = useCallback(() => {
    setAiPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        status: prev.status === 'paused' ? 'executing' : 'paused',
      };
    });
  }, []);

  // Build plan from AI response tool calls
  useEffect(() => {
    if (!isPending || activeToolCalls.length === 0) return;

    setAiPlan((prev) => {
      const existingIds = new Set((prev?.steps ?? []).map((s) => s.id));
      const newSteps: PlanStep[] = [];
      for (const tc of activeToolCalls) {
        const stepId = `tool-${tc.toolName}`;
        if (!existingIds.has(stepId)) {
          newSteps.push({
            id: stepId,
            description: tc.isMcp ? `${tc.serverName}: ${tc.toolName}` : tc.label,
            status: 'running',
            toolName: tc.toolName,
          });
        }
      }
      if (newSteps.length === 0 && prev) return prev;
      const steps = [...(prev?.steps ?? []), ...newSteps];
      return {
        id: prev?.id ?? `plan-${Date.now()}`,
        title: prev?.title ?? 'AI Task Plan',
        steps,
        status: 'executing',
        createdAt: prev?.createdAt ?? Date.now(),
      };
    });
  }, [activeToolCalls, isPending]);

  // Mark completed tool steps
  useEffect(() => {
    if (!aiPlan) return;
    const activeNames = new Set(activeToolCalls.map((tc) => tc.toolName));
    setAiPlan((prev) => {
      if (!prev) return prev;
      let changed = false;
      const steps = prev.steps.map((s) => {
        if (s.status === 'running' && s.toolName && !activeNames.has(s.toolName)) {
          changed = true;
          return { ...s, status: 'completed' as const };
        }
        return s;
      });
      return changed ? { ...prev, steps } : prev;
    });
  }, [activeToolCalls, aiPlan]);

  // Clear plan when chat completes
  useEffect(() => {
    if (!isPending && aiPlan?.status === 'executing') {
      setAiPlan((prev) => (prev ? { ...prev, status: 'completed' } : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending]);

  const handleInsertAtCursor = useCallback((msg: ChatMessage) => {
    const editor = editorRef.current;
    if (!editor) return;

    const codeBlockMatch = /```[\w]*\n([\s\S]*?)```/.exec(msg.content);
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

  const BOTTOM_TABS: { id: BottomTab; label: string }[] = [
    { id: 'terminal', label: 'Terminal' },
    { id: 'sessions', label: 'Sessions' },
    { id: 'history', label: 'History' },
    { id: 'git', label: 'Git' },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] sm:h-[calc(100vh-140px)]">
      {/* Page header */}
      <div className="pb-3 border-b mb-3">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Editor</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Write, run, and debug code with AI-assisted execution and sandboxed sessions
        </p>
      </div>

      {/* Three-panel responsive layout: Editor | Chat side by side, Bottom panel */}
      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto">
        {/* Top row — Code Editor & Chat side by side */}
        <div className="flex-1 flex flex-col lg:flex-row gap-3 min-h-0 lg:min-h-0">
          {/* Left panel — Code Editor */}
          <div
            className={`flex flex-col flex-1 ${showChat ? 'lg:flex-[60]' : ''} min-h-[250px] lg:min-h-0 border rounded-lg overflow-hidden bg-card`}
          >
            {/* Editor toolbar with tabs */}
            <EditorToolbar
              tabs={tabs}
              activeTabId={activeTabId}
              language={language}
              showExplorer={showExplorer}
              showChat={showChat}
              showWorld={showWorld}
              settingsOpen={settingsOpen}
              splitView={splitView}
              memoryEnabled={memoryEnabled}
              modelInfo={modelInfo}
              runDisabled={runCodeMutation.isPending || !editorContent.trim()}
              renamingTabId={renamingTabId}
              renameValue={renameValue}
              onToggleExplorer={() => {
                const n = !showExplorer;
                localStorage.setItem('editor:showExplorer', String(n));
                setShowExplorer(n);
              }}
              onToggleChat={() => {
                const n = !showChat;
                localStorage.setItem('editor:showChat', String(n));
                setShowChat(n);
              }}
              onToggleWorld={() => {
                const n = !showWorld;
                localStorage.setItem('editor:showWorld', String(n));
                setShowWorld(n);
              }}
              onToggleSettings={() => {
                setSettingsOpen((v) => !v);
              }}
              onToggleSplitView={() => {
                setSplitView((v) => !v);
              }}
              onToggleMemory={() => {
                const n = !memoryEnabled;
                localStorage.setItem('editor:memoryEnabled', String(n));
                setMemoryEnabled(n);
              }}
              onTabClick={(id) => {
                setActiveTabId(id);
              }}
              onTabClose={closeTab}
              onTabRenameStart={(id, name) => {
                setActiveTabId(id);
                setRenamingTabId(id);
                setRenameValue(name);
              }}
              onTabRenameChange={setRenameValue}
              onTabRenameConfirm={() => {
                if (renamingTabId && renameValue.trim()) {
                  setTabs((prev) =>
                    prev.map((t) =>
                      t.id === renamingTabId
                        ? {
                            ...t,
                            name: renameValue.trim(),
                            path: `${cwd}/${renameValue.trim()}`,
                            language: detectLanguage(renameValue.trim()),
                            isDirty: true,
                          }
                        : t
                    )
                  );
                }
                setRenamingTabId(null);
              }}
              onTabRenameCancel={() => {
                setRenamingTabId(null);
              }}
              onNewTab={createNewTab}
              onRun={handleRunCode}
              onSendToChat={handleSendToChat}
              onCommandPalette={palette.toggle}
              showGitButton
              onToggleGit={() => {
                setActiveBottomTab(activeBottomTab === 'git' ? 'terminal' : 'git');
              }}
              onToggleKeybindings={() => {
                setKeybindingsOpen(true);
              }}
              collabUsers={collabUsers}
              collabConnected={collabConnected}
            />

            {/* Settings Panel */}
            {settingsOpen && (
              <div className="border-b bg-muted/50 px-3 py-2 space-y-2">
                <div className="flex items-center gap-4 flex-wrap">
                  <label className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Font Size:</span>
                    <input
                      type="number"
                      min={10}
                      max={24}
                      value={editorSettings.fontSize}
                      onChange={(e) => {
                        setEditorSettings((s) => ({
                          ...s,
                          fontSize: parseInt(e.target.value) || 14,
                        }));
                      }}
                      className="w-14 bg-card border border-border rounded px-2 py-1 text-xs"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Tab Size:</span>
                    <select
                      value={editorSettings.tabSize}
                      onChange={(e) => {
                        setEditorSettings((s) => ({ ...s, tabSize: parseInt(e.target.value) }));
                      }}
                      className="bg-card border border-border rounded px-2 py-1 text-xs"
                    >
                      <option value={2}>2</option>
                      <option value={4}>4</option>
                      <option value={8}>8</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editorSettings.minimap}
                      onChange={(e) => {
                        setEditorSettings((s) => ({ ...s, minimap: e.target.checked }));
                      }}
                      className="rounded"
                    />
                    <span className="text-muted-foreground">Minimap</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editorSettings.wordWrap}
                      onChange={(e) => {
                        setEditorSettings((s) => ({ ...s, wordWrap: e.target.checked }));
                      }}
                      className="rounded"
                    />
                    <span className="text-muted-foreground">Word Wrap</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editorSettings.lineNumbers}
                      onChange={(e) => {
                        setEditorSettings((s) => ({ ...s, lineNumbers: e.target.checked }));
                      }}
                      className="rounded"
                    />
                    <span className="text-muted-foreground">Line Numbers</span>
                  </label>
                </div>
              </div>
            )}

            {/* Editor area with optional explorer sidebar */}
            <div className="flex-1 flex min-h-0">
              {/* Project Explorer sidebar */}
              {showExplorer && (
                <div className="w-[220px] flex-shrink-0 overflow-hidden">
                  <ProjectExplorer
                    cwd={cwd}
                    onOpenFile={(path, name, content) => {
                      const existing = tabs.find((t) => t.path === path);
                      if (existing) {
                        setActiveTabId(existing.id);
                      } else {
                        const newTab = createEditorTab(name, cwd, content);
                        newTab.path = path;
                        newTab.language = detectLanguage(name);
                        setTabs((prev) => [...prev, newTab]);
                        setActiveTabId(newTab.id);
                      }
                    }}
                    onCwdChange={setCwd}
                  />
                </div>
              )}

              {/* Search Panel sidebar */}
              {showSearch && (
                <div className="w-[300px] flex-shrink-0 overflow-hidden border-r border-border">
                  <SearchPanel
                    cwd={cwd}
                    onNavigate={(file, line) => {
                      // Open file and go to line
                      const existing = tabs.find((t) => t.path === `${cwd}/${file}`);
                      if (existing) {
                        setActiveTabId(existing.id);
                      }
                      if (editorRef.current) {
                        editorRef.current.revealLineInCenter(line);
                        editorRef.current.setPosition({ lineNumber: line, column: 1 });
                        editorRef.current.focus();
                      }
                    }}
                    onClose={() => {
                      setShowSearch(false);
                    }}
                  />
                </div>
              )}

              {/* Monaco Editor */}
              <div className={`flex-1 min-h-0 ${splitView ? 'flex gap-1' : ''}`}>
                <Editor
                  height="100%"
                  width={splitView ? '50%' : '100%'}
                  language={language}
                  theme={isDark ? 'vs-dark' : 'vs'}
                  value={editorContent}
                  onChange={(value) => {
                    updateTabContent(value ?? '');
                  }}
                  onMount={handleEditorMount}
                  options={{
                    minimap: { enabled: editorSettings.minimap },
                    fontSize: editorSettings.fontSize,
                    tabSize: editorSettings.tabSize,
                    lineNumbers: editorSettings.lineNumbers ? 'on' : 'off',
                    wordWrap: editorSettings.wordWrap ? 'on' : 'off',
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                    padding: { top: 8 },
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  }}
                />
                {splitView && (
                  <Editor
                    height="100%"
                    width="50%"
                    language={language}
                    theme={isDark ? 'vs-dark' : 'vs'}
                    value={editorContent}
                    onChange={(value) => {
                      updateTabContent(value ?? '');
                    }}
                    options={{
                      minimap: { enabled: editorSettings.minimap },
                      fontSize: editorSettings.fontSize,
                      tabSize: editorSettings.tabSize,
                      lineNumbers: editorSettings.lineNumbers ? 'on' : 'off',
                      wordWrap: editorSettings.wordWrap ? 'on' : 'off',
                      automaticLayout: true,
                      scrollBeyondLastLine: false,
                      padding: { top: 8 },
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      readOnly: true,
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Right panel — Chat Sidebar */}
          {showChat && (
            <div className="flex flex-col flex-1 lg:flex-[40] min-h-[200px] lg:min-h-0 border rounded-lg overflow-hidden bg-card">
              {/* Sidebar header */}
              <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
                <Bot className="w-4 h-4 text-primary flex-shrink-0" />
                {currentPersonality?.isDefault && (
                  <span title="Default personality">
                    <Star className="w-3 h-3 fill-current text-primary flex-shrink-0" />
                  </span>
                )}

                {/* Personality selector */}
                <div className="relative flex-1 min-w-0">
                  <select
                    value={effectivePersonalityId ?? ''}
                    onChange={(e) => {
                      setSelectedPersonalityId(e.target.value || null);
                    }}
                    className="w-full bg-transparent border border-border rounded px-2 py-1 text-xs appearance-none pr-6 focus:outline-none focus:ring-1 focus:ring-primary truncate"
                  >
                    <option value="">Default Assistant</option>
                    {personalities.map((p: Personality) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.isActive ? ' (active)' : ''}
                        {p.isDefault ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
                </div>
                <button
                  onClick={() => {
                    localStorage.setItem('editor:showChat', 'false');
                    setShowChat(false);
                  }}
                  className="text-muted-foreground hover:text-foreground flex-shrink-0"
                  title="Close chat"
                  aria-label="Close chat"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* The Entity — AI consciousness visualization */}
              <EntityWidget
                state={
                  isPending && activeToolCalls.length > 0
                    ? 'active'
                    : isPending
                      ? 'thinking'
                      : 'dormant'
                }
                height={120}
                compact
                label={
                  isPending && activeToolCalls.length > 0
                    ? `EXECUTING ${activeToolCalls.length} TOOL${activeToolCalls.length > 1 ? 'S' : ''}`
                    : isPending && streamingThinking
                      ? 'REASONING'
                      : isPending
                        ? 'PROCESSING'
                        : (currentPersonality?.name?.toUpperCase() ?? 'STANDBY')
                }
              />

              {/* AI Plan Panel */}
              {aiPlan && (
                <div className="px-3 pt-2">
                  <AiPlanPanel
                    plan={aiPlan}
                    onApproveStep={handleApproveStep}
                    onRejectStep={handleRejectStep}
                    onPauseResume={handlePlanPauseResume}
                    onFileClick={(path) => {
                      // Open file in a new tab
                      const name = path.split('/').pop() ?? path;
                      const existing = tabs.find((t) => t.path === path);
                      if (existing) {
                        setActiveTabId(existing.id);
                      } else {
                        const newTab = createEditorTab(name, cwd);
                        newTab.path = path;
                        newTab.language = detectLanguage(name);
                        setTabs((prev) => [...prev, newTab]);
                        setActiveTabId(newTab.id);
                      }
                    }}
                  />
                </div>
              )}

              {/* Chat messages */}
              <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                {messages.length === 0 && (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <div className="text-center">
                      <Bot className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      {personalitiesData && personalities.length === 0 ? (
                        <>
                          <p className="text-xs font-medium">No personalities configured.</p>
                          <p className="text-xs mt-1">
                            <Link to="/personality" className="text-primary hover:underline">
                              Create a personality
                            </Link>{' '}
                            to start chatting.
                          </p>
                        </>
                      ) : (
                        <p className="text-xs">
                          Chat with {currentPersonality?.name ?? 'the assistant'} about your code.
                        </p>
                      )}
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
                      {/* Phase 1 — Thinking */}
                      {msg.role === 'assistant' && msg.thinkingContent && (
                        <ThinkingBlock thinking={msg.thinkingContent} />
                      )}

                      {/* Phase 2 — Tool use (badges + creation outcomes), shown before the response */}
                      {msg.role === 'assistant' &&
                        ((msg.toolCalls?.length ?? 0) > 0 ||
                          (msg.creationEvents?.length ?? 0) > 0) && (
                          <div
                            className={`space-y-0.5 mb-1.5 ${msg.thinkingContent ? 'border-t border-muted-foreground/15 pt-1.5 mt-1' : ''}`}
                          >
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70 mb-1">
                              <Wrench className="w-2.5 h-2.5 shrink-0" />
                              <span>Tools used</span>
                            </div>
                            {/* Tool call badges */}
                            {msg.toolCalls && msg.toolCalls.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-0.5">
                                {msg.toolCalls.map((tc, j) => (
                                  <span
                                    key={j}
                                    className="inline-flex items-center gap-0.5 text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full"
                                  >
                                    <Sparkles className="w-2 h-2" />
                                    {tc.isMcp && tc.serverName
                                      ? `${tc.serverName}: ${tc.toolName}`
                                      : tc.label}
                                  </span>
                                ))}
                              </div>
                            )}
                            {/* Creation outcomes */}
                            {msg.creationEvents?.map((ev: CreationEvent, j: number) => (
                              <div
                                key={j}
                                className="flex items-center gap-1 text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded border border-primary/20"
                              >
                                <Sparkles className="w-2.5 h-2.5 shrink-0" />
                                <span>
                                  {ev.label} {ev.action ?? 'Created'}:{' '}
                                  <strong className="font-medium">{sanitizeText(ev.name)}</strong>
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                      {/* Phase 3 — Response */}
                      {msg.role === 'assistant' ? (
                        <div
                          className={
                            msg.thinkingContent ||
                            (msg.toolCalls?.length ?? 0) > 0 ||
                            (msg.creationEvents?.length ?? 0) > 0
                              ? 'border-t border-muted-foreground/15 pt-1.5 mt-1'
                              : ''
                          }
                        >
                          <ChatMarkdown content={sanitizeText(msg.content)} size="xs" />
                        </div>
                      ) : (
                        <p className="text-xs whitespace-pre-wrap">{sanitizeText(msg.content)}</p>
                      )}

                      {msg.role === 'assistant' && (
                        <button
                          onClick={() => {
                            handleInsertAtCursor(msg);
                          }}
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

                {/* Live streaming response */}
                {isPending && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-lg px-3 py-2">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Bot className="w-3 h-3" />
                        <span className="text-[10px] opacity-70">
                          {currentPersonality?.name ?? 'Assistant'}
                        </span>
                      </div>

                      {/* Phase 1 — Live thinking */}
                      {streamingThinking && (
                        <ThinkingBlock thinking={streamingThinking} live={true} />
                      )}

                      {/* Phase 2 — Active tool calls */}
                      {activeToolCalls.length > 0 && (
                        <div
                          className={`mb-1 ${streamingThinking ? 'border-t border-muted-foreground/15 pt-1.5 mt-1' : ''}`}
                        >
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70 mb-1">
                            <Wrench className="w-2.5 h-2.5 shrink-0" />
                            <span>Using tools</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {activeToolCalls.map((tc) => (
                              <span
                                key={tc.toolName}
                                className="inline-flex items-center gap-0.5 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full animate-pulse"
                              >
                                <Sparkles className="w-2 h-2" />
                                {tc.isMcp ? `${tc.serverName}: ${tc.toolName}` : tc.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Phase 3 — Response */}
                      {streamingContent ? (
                        <div
                          className={
                            streamingThinking || hadActiveTools
                              ? 'border-t border-muted-foreground/15 pt-1.5 mt-1'
                              : ''
                          }
                        >
                          <p className="text-xs whitespace-pre-wrap">{streamingContent}</p>
                        </div>
                      ) : (
                        !streamingThinking &&
                        activeToolCalls.length === 0 && (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <span className="text-[10px] text-muted-foreground animate-pulse">
                              Thinking
                            </span>
                            <div className="flex gap-1">
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
                        )
                      )}
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Chat input */}
              <div className="border-t px-3 py-2">
                <div className="flex gap-2 items-end">
                  <textarea
                    value={chatInput}
                    onChange={(e) => {
                      setChatInput(e.target.value);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={`Message ${currentPersonality?.name ?? 'assistant'}...`}
                    disabled={isPending}
                    rows={3}
                    className="flex-1 resize-none rounded border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 min-h-[80px] max-h-[200px]"
                  />
                  <button
                    onClick={voice.toggleVoice}
                    disabled={!voice.supported}
                    className={`btn px-3 py-2 rounded disabled:opacity-50 h-[52px] ${
                      voice.voiceEnabled ? 'btn-primary' : 'btn-ghost'
                    }`}
                    title={voice.voiceEnabled ? 'Voice enabled' : 'Enable voice'}
                  >
                    {voice.isListening ? (
                      <Mic className="w-3 h-3 animate-pulse" />
                    ) : voice.voiceEnabled ? (
                      <Mic className="w-3 h-3" />
                    ) : (
                      <Mic className="w-3 h-3 opacity-50" />
                    )}
                  </button>
                  {hasVision && (
                    <button
                      onClick={() => {
                        setWatchEnabled((v) => !v);
                      }}
                      className={`btn px-3 py-2 rounded h-[52px] ${
                        watchEnabled ? 'btn-primary' : 'btn-ghost'
                      }`}
                      title={
                        watchEnabled
                          ? 'Watch on — terminal output visible to personality'
                          : 'Watch off — enable terminal vision'
                      }
                    >
                      <Eye className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={handleSend}
                    disabled={!chatInput.trim() || isPending}
                    className="btn btn-ghost px-3 py-2 rounded disabled:opacity-50 h-[52px]"
                  >
                    {isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Send className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>

              <VoiceOverlay
                isActive={ptt.isActive}
                audioLevel={ptt.audioLevel}
                duration={ptt.duration}
                transcript={ptt.transcript}
                error={ptt.error}
              />
            </div>
          )}
        </div>

        {/* Bottom row — Terminal (+ Agent World side-by-side when visible) */}
        <div
          className={`flex ${showWorld ? 'flex-col lg:flex-row' : 'flex-col'} gap-3 h-[200px] sm:h-[220px] lg:h-[240px] flex-shrink-0`}
        >
          {/* Terminal / Sessions / History */}
          <div
            className={`flex flex-col border rounded-lg overflow-hidden bg-card ${showWorld ? 'flex-1 lg:flex-[60]' : 'flex-1'} min-h-0`}
          >
            {/* Tab bar */}
            <div className="flex items-center border-b bg-muted/30 min-w-0">
              <div className="flex flex-shrink-0">
                {BOTTOM_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveBottomTab(tab.id);
                    }}
                    className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                      activeBottomTab === tab.id
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            {activeBottomTab === 'terminal' && (
              <div className="flex-1 min-h-0 overflow-hidden">
                <MultiTerminal outputRef={terminalOutputRef} onCommandComplete={saveMemory} />
              </div>
            )}

            {activeBottomTab === 'sessions' && (
              <ExecutionGated>
                <SessionsPanel />
              </ExecutionGated>
            )}

            {activeBottomTab === 'history' && (
              <ExecutionGated>
                <HistoryPanel />
              </ExecutionGated>
            )}

            {activeBottomTab === 'git' && (
              <div className="flex-1 min-h-0 overflow-hidden">
                <GitPanel
                  cwd={cwd}
                  commitMessage={aiCommit.message}
                  onCommitMessageChange={aiCommit.setMessage}
                  isGeneratingMessage={aiCommit.isGenerating}
                  onGenerateMessage={() => void aiCommit.generate()}
                />
              </div>
            )}
          </div>

          {/* Agent World panel (right of terminal, same width as chat) */}
          {showWorld && (
            <div className="flex flex-col flex-1 lg:flex-[40] border border-border rounded-lg bg-card overflow-hidden min-h-0">
              <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                  <Globe className="w-3.5 h-3.5" /> Agent World
                </div>
                <div className="flex items-center gap-0.5">
                  {(['grid', 'map', 'large'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        setWorldViewMode(m);
                        localStorage.setItem('world:viewMode', m);
                      }}
                      className={`px-1.5 py-0.5 text-[11px] rounded transition-colors ${worldViewMode === m ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      localStorage.setItem('editor:showWorld', 'false');
                      setShowWorld(false);
                    }}
                    className="ml-1 text-muted-foreground hover:text-foreground"
                    title="Close agent world"
                    aria-label="Close agent world"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0 p-2 overflow-auto">
                <AgentWorldWidget
                  maxAgents={8}
                  viewMode={worldViewMode}
                  onAgentClick={(id) => void navigate(`/soul/personalities?focus=${id}`)}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Command Palette overlay */}
      <CommandPalette
        open={palette.open}
        query={palette.query}
        setQuery={palette.setQuery}
        filtered={palette.filtered}
        selectedIndex={palette.selectedIndex}
        setSelectedIndex={palette.setSelectedIndex}
        execute={palette.execute}
        close={palette.close}
      />

      {/* Keybindings Editor overlay */}
      <KeybindingsEditor
        open={keybindingsOpen}
        onClose={() => {
          setKeybindingsOpen(false);
        }}
      />
      {annotationPopover}
    </div>
  );
}
