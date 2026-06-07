/**
 * Lazy-loaded Excalidraw editor wrapper.
 *
 * Code-splits the ~2MB Excalidraw bundle so it's only loaded when
 * the widget is first rendered in Draw mode.
 */

import { lazy, Suspense, useCallback } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

const ExcalidrawComponent = lazy(async () => {
  const mod = await import('@excalidraw/excalidraw');
  return { default: mod.Excalidraw };
});

export interface ExcalidrawEditorLazyProps {
  initialData?: {
    elements?: readonly Record<string, unknown>[];
    appState?: Record<string, unknown>;
  };
  onChange?: (
    elements: readonly Record<string, unknown>[],
    appState: Record<string, unknown>
  ) => void;
  theme?: 'light' | 'dark';
  excalidrawAPI?: (api: ExcalidrawImperativeAPI) => void;
}

export function ExcalidrawEditorLazy({
  initialData,
  onChange,
  theme,
  excalidrawAPI,
}: ExcalidrawEditorLazyProps) {
  const handleChange = useCallback(
    (elements: readonly Record<string, unknown>[], appState: Record<string, unknown>) => {
      onChange?.(elements, appState);
    },
    [onChange]
  );

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
          Loading editor...
        </div>
      }
    >
      <ExcalidrawComponent
        initialData={initialData as never}
        onChange={handleChange as never}
        theme={theme}
        excalidrawAPI={excalidrawAPI}
      />
    </Suspense>
  );
}
