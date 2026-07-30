import React from 'react';
import ReactDOM from 'react-dom/client';
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import App from './App';
import { bootstrap } from './lib/bootstrap';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import './themes.css';
import './settings.css';
import './appearance.css';
import './claude-usage.css';
import './workspaces.css';
import './brand.css';
import './browser.css';
import './swarm.css';
import './memory.css';
import './updates.css';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

// Tracks the tokens in styles.css so the editor reads as part of the panel
// rather than a window pasted into it.
monaco.editor.defineTheme('eaon-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#0f0f0f',
    'editor.foreground': '#d4d4d4',
    'editor.lineHighlightBackground': '#161616',
    'editor.selectionBackground': '#3f2a22',
    'editorCursor.foreground': '#f17455',
    'editorLineNumber.foreground': '#4d4d4d',
    'editorLineNumber.activeForeground': '#a8a8a8',
    'editorIndentGuide.background1': '#1f1f1f',
    'editorGutter.background': '#0f0f0f',
    'editorWidget.background': '#191919',
    'editorWidget.border': '#262626',
    'editorSuggestWidget.background': '#191919',
    'editorSuggestWidget.selectedBackground': '#262626',
    'editorOverviewRuler.border': '#00000000',
    'diffEditor.insertedTextBackground': '#4ec26a1f',
    'diffEditor.removedTextBackground': '#f2635a1f',
    'scrollbarSlider.background': '#ffffff14',
    'scrollbarSlider.hoverBackground': '#ffffff26',
    'scrollbarSlider.activeBackground': '#ffffff33',
    'input.background': '#0a0a0a',
    'input.border': '#262626',
    'focusBorder': '#f1745566',
  },
});
monaco.editor.setTheme('eaon-dark');

loader.config({ monaco });

bootstrap();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
