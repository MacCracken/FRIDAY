import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Check, Loader2, X, Cpu } from 'lucide-react';
import { fetchModelInfo, switchModel } from '../api/client';
import type { ModelInfo } from '../types';

interface ModelWidgetProps {
  onClose: () => void;
  onModelSwitch?: () => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
  ollama: 'Ollama (Local)',
  opencode: 'OpenCode (Zen)',
};

function formatPrice(inputPer1M: number, outputPer1M: number): string {
  if (inputPer1M === 0 && outputPer1M === 0) return 'Free';
  return `$${inputPer1M} / $${outputPer1M} per 1M tokens`;
}

export function ModelWidget({ onClose, onModelSwitch }: ModelWidgetProps) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['model-info'],
    queryFn: fetchModelInfo,
  });

  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());

  // Expand current provider on initial data load
  const didAutoExpand = useRef(false);
  useEffect(() => {
    if (data?.current.provider && !didAutoExpand.current) {
      didAutoExpand.current = true;
      setExpandedProviders(new Set([data.current.provider]));
    }
  }, [data?.current.provider]);

  const switchMutation = useMutation({
    mutationFn: switchModel,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['model-info'] });
      onModelSwitch?.();
    },
  });

  const toggleProvider = (provider: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) {
        next.delete(provider);
      } else {
        next.add(provider);
      }
      return next;
    });
  };

  const handleSwitch = (provider: string, model: string) => {
    if (data?.current.provider === provider && data?.current.model === model) return;
    switchMutation.mutate({ provider, model });
  };

  if (isLoading) {
    return (
      <div className="card p-4 w-80 shadow-lg">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const currentProvider = data.current.provider;
  const currentModel = data.current.model;

  return (
    <div className="card w-80 shadow-lg max-h-[500px] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Model Selection</span>
        </div>
        <button onClick={onClose} className="btn-ghost p-1 rounded">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Current model */}
      <div className="px-3 py-2 bg-primary/5 border-b">
        <p className="text-xs text-muted-foreground">Current Model</p>
        <p className="text-sm font-medium">
          {currentModel}
          <span className="text-xs text-muted-foreground ml-2">
            {PROVIDER_LABELS[currentProvider] ?? currentProvider}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          max tokens: {data.current.maxTokens} | temp: {data.current.temperature}
        </p>
      </div>

      {/* Model list */}
      <div className="overflow-y-auto flex-1">
        {Object.entries(data.available).map(([provider, models]) => (
          <div key={provider}>
            <button
              onClick={() => toggleProvider(provider)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/50 border-b"
            >
              {expandedProviders.has(provider) ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              {PROVIDER_LABELS[provider] ?? provider}
              <span className="text-xs text-muted-foreground ml-auto">
                {(models as ModelInfo[]).length} models
              </span>
            </button>

            {expandedProviders.has(provider) && (
              <div className="divide-y">
                {(models as ModelInfo[]).map((m) => {
                  const isActive =
                    m.provider === currentProvider && m.model === currentModel;
                  const isSwitching =
                    switchMutation.isPending &&
                    switchMutation.variables?.provider === m.provider &&
                    switchMutation.variables?.model === m.model;

                  return (
                    <button
                      key={m.model}
                      onClick={() => handleSwitch(m.provider, m.model)}
                      disabled={isActive || switchMutation.isPending}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-muted/50 disabled:opacity-60 ${
                        isActive ? 'bg-primary/15 border-l-2 border-primary' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs">{m.model}</span>
                        {isActive && <Check className="w-3 h-3 text-primary" />}
                        {isSwitching && <Loader2 className="w-3 h-3 animate-spin" />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatPrice(m.inputPer1M, m.outputPer1M)}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Error feedback */}
      {switchMutation.isError && (
        <div className="px-3 py-2 bg-destructive/10 border-t text-xs text-destructive">
          Failed to switch model: {(switchMutation.error as Error).message}
        </div>
      )}
    </div>
  );
}
