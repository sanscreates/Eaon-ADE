import { useCallback, useEffect, useMemo, useState } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { useUi } from '../../store/ui';
import { useSettings } from '../../store/settings';
import { api } from '../../lib/api';
import { langForPath, shortPath } from '../../lib/utils';
import { IconSave, IconX } from '../Icons';

const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 12,
  lineHeight: 1.6,
  fontFamily: '"SF Mono", ui-monospace, Menlo, Monaco, monospace',
  tabSize: 2,
  automaticLayout: true,
  scrollBeyondLastLine: false,
  padding: { top: 10, bottom: 10 },
  renderLineHighlight: 'line' as const,
  smoothScrolling: true,
  cursorBlinking: 'smooth' as const,
  guides: { indentation: false },
  overviewRulerBorder: false,
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
};

export function EditorPanel() {
  const openFile = useUi((s) => s.openFile);
  const fileDirty = useUi((s) => s.fileDirty);
  const setFileDirty = useUi((s) => s.setFileDirty);
  const closeEditorFile = useUi((s) => s.closeEditorFile);
  const toast = useUi((s) => s.toast);
  const editorFontSize = useSettings((s) => s.editorFontSize);
  const editorMinimap = useSettings((s) => s.editorMinimap);
  const editorWordWrap = useSettings((s) => s.editorWordWrap);
  const [content, setContent] = useState<string>('');

  const options = useMemo(
    () => ({
      ...EDITOR_OPTIONS,
      fontSize: editorFontSize,
      minimap: { enabled: editorMinimap },
      wordWrap: (editorWordWrap ? 'on' : 'off') as 'on' | 'off',
    }),
    [editorFontSize, editorMinimap, editorWordWrap],
  );

  useEffect(() => {
    setContent(openFile?.content ?? '');
  }, [openFile?.path]);

  const save = useCallback(async () => {
    if (!openFile || openFile.diff) return;
    try {
      await api.put('/api/files/write', { path: openFile.path, content });
      setFileDirty(false);
      toast(`Saved ${shortPath(openFile.path)}`, 'success');
    } catch (err) {
      toast(`Save failed: ${err}`, 'error');
    }
  }, [openFile, content]);

  useEffect(() => {
    const onSave = () => {
      if (fileDirty) save();
    };
    window.addEventListener('eaon:save-file', onSave);
    return () => window.removeEventListener('eaon:save-file', onSave);
  }, [fileDirty, save]);

  if (!openFile) {
    return (
      <div className="panel-empty">
        <p>No file open.</p>
        <p className="panel-empty-hint">Open a file from the Files tab, or a diff from the Git tab.</p>
      </div>
    );
  }

  const language = langForPath(openFile.path);

  return (
    <div className="editor-panel">
      <div className="panel-toolbar editor-toolbar">
        <span className="editor-path" title={openFile.path}>
          {shortPath(openFile.path)}
          {openFile.diff && <span className="editor-diff-tag">diff</span>}
          {fileDirty && <span className="editor-dirty" title="Unsaved changes" />}
        </span>
        <div className="editor-actions">
          {!openFile.diff && (
            <button className="icon-btn" title="Save (⌘S)" onClick={save} disabled={!fileDirty}>
              <IconSave size={13} />
            </button>
          )}
          <button className="icon-btn" title="Close file" onClick={closeEditorFile}>
            <IconX size={13} />
          </button>
        </div>
      </div>
      <div className="editor-host">
        {openFile.diff ? (
          <DiffEditor
            original={openFile.diff.original}
            modified={openFile.diff.modified}
            language={language}
            theme="eaon-dark"
            options={{ ...options, readOnly: true, renderSideBySide: true }}
          />
        ) : (
          <Editor
            path={openFile.path}
            value={content}
            language={language}
            theme="eaon-dark"
            onChange={(value) => {
              setContent(value ?? '');
              setFileDirty(true);
            }}
            options={options}
          />
        )}
      </div>
    </div>
  );
}
