const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

function activate(context) {
  // 1. Custom Editor Provider (Open With & Default Editor support)
  context.subscriptions.push(SimpleImageCropEditorProvider.register(context));

  // 2. Context Menu Command
  let disposable = vscode.commands.registerCommand('simple-image-crop.crop', async (uri) => {
    let targetUri = uri;
    if (!targetUri) {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        targetUri = activeEditor.document.uri;
      }
    }
    if (!targetUri || !targetUri.fsPath) {
      vscode.window.showErrorMessage('Please select an image file.');
      return;
    }

    const filePath = targetUri.fsPath;
    const ext = path.extname(filePath).toLowerCase();
    const validExts = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];
    if (!validExts.includes(ext)) {
      vscode.window.showErrorMessage('Unsupported image format (supports PNG, JPG, WEBP, BMP).');
      return;
    }

    await vscode.commands.executeCommand('vscode.openWith', targetUri, 'simple-image-crop.editor');
  });

  context.subscriptions.push(disposable);
}

// File level undo/redo history for direct overwrite saves
const fileUndoHistory = new Map(); // filePath -> Array<Buffer>
const fileRedoHistory = new Map(); // filePath -> Array<Buffer>

class SimpleImageCropEditorProvider {
  static register(context) {
    const provider = new SimpleImageCropEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(
      'simple-image-crop.editor',
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
          enableScripts: true
        },
        supportsMultipleEditorsPerDocument: false
      }
    );
  }

  constructor(context) {
    this.context = context;
  }

  async openCustomDocument(uri, openContext, token) {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(document, webviewPanel, token) {
    webviewPanel.webview.options = {
      enableScripts: true
    };

    const isReadOnly = document.uri.scheme !== 'file';
    const filePath = document.uri.fsPath;
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    let mimeType = 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.webp') mimeType = 'image/webp';
    else if (ext === '.bmp') mimeType = 'image/bmp';

    let base64Data;
    try {
      // Use vscode.workspace.fs to accurately read both local files and git/scm virtual schemas (e.g. HEAD before changes)
      const uint8Array = await vscode.workspace.fs.readFile(document.uri);
      const fileBuffer = Buffer.from(uint8Array);
      base64Data = fileBuffer.toString('base64');
    } catch (err) {
      try {
        const fileBuffer = fs.readFileSync(filePath);
        base64Data = fileBuffer.toString('base64');
      } catch (e2) {
        vscode.window.showErrorMessage(`Failed to load image: ${err.message}`);
        return;
      }
    }

    // Default theme is 'light'. If user changes it, globalState persists it across sessions.
    const initialTheme = this.context.globalState.get('simple-image-crop.theme', 'light');
    const defaultLang = (vscode.env.language && vscode.env.language.startsWith('ja')) ? 'ja' : 'en';
    const initialLanguage = this.context.globalState.get('simple-image-crop.language', defaultLang);
    let initialStyle = this.context.globalState.get('simple-image-crop.style', null);
    if (!initialStyle || initialStyle.fontSize === 32) {
      initialStyle = Object.assign({}, initialStyle, {
        strokeColor: initialStyle && initialStyle.strokeColor ? initialStyle.strokeColor : '#ff3b30',
        strokeWidth: initialStyle && initialStyle.strokeWidth ? initialStyle.strokeWidth : 4,
        fillColor: initialStyle && initialStyle.fillColor ? initialStyle.fillColor : 'transparent',
        fontSize: 18,
        fontWeight: initialStyle && initialStyle.fontWeight ? initialStyle.fontWeight : 'bold'
      });
      this.context.globalState.update('simple-image-crop.style', initialStyle);
    }

    webviewPanel.webview.html = getWebviewContent(fileName, mimeType, base64Data, {
      theme: initialTheme,
      language: initialLanguage,
      style: initialStyle,
      isReadOnly: isReadOnly,
      scheme: document.uri.scheme
    });

    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'save') {
        if (isReadOnly) {
          vscode.window.showWarningMessage('Cannot save to read-only or Git Diff source image.');
          return;
        }
        try {
          const rawBase64 = message.data.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(rawBase64, 'base64');

          // 1. Backup current file content before overwriting (for Undo Save / Cmd+Z support)
          if (fs.existsSync(filePath)) {
            const currentBuffer = fs.readFileSync(filePath);
            if (!fileUndoHistory.has(filePath)) {
              fileUndoHistory.set(filePath, []);
            }
            const stack = fileUndoHistory.get(filePath);
            stack.push(currentBuffer);
            if (stack.length > 25) stack.shift(); // keep up to 25 steps
            fileRedoHistory.delete(filePath);
          }

          // 2. Overwrite file
          fs.writeFileSync(filePath, buffer);
          vscode.window.showInformationMessage(`✅ Overwritten: ${fileName} (${buffer.length} bytes)`);

          // 3. Re-feed new image to webview
          base64Data = buffer.toString('base64');
          webviewPanel.webview.postMessage({
            command: 'saved',
            imageSrc: `data:${mimeType};base64,${base64Data}`,
            canUndoSave: true
          });
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to overwrite file: ${err.message}`);
        }
      } else if (message.command === 'undoSave') {
        // Restore file to state prior to last overwrite save
        try {
          const stack = fileUndoHistory.get(filePath);
          if (!stack || stack.length === 0) {
            vscode.window.showInformationMessage('これ以上元に戻す保存履歴がありません (No more overwrite history to undo)');
            return;
          }

          if (fs.existsSync(filePath)) {
            const currentBuffer = fs.readFileSync(filePath);
            if (!fileRedoHistory.has(filePath)) fileRedoHistory.set(filePath, []);
            fileRedoHistory.get(filePath).push(currentBuffer);
          }

          const prevBuffer = stack.pop();
          fs.writeFileSync(filePath, prevBuffer);
          vscode.window.showInformationMessage(`↺ 保存前の画像に復元しました: ${fileName}`);

          base64Data = prevBuffer.toString('base64');
          webviewPanel.webview.postMessage({
            command: 'saveUndone',
            imageSrc: `data:${mimeType};base64,${base64Data}`,
            canUndoSave: stack.length > 0
          });
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to restore previous version: ${err.message}`);
        }
      } else if (message.command === 'redoSave') {
        try {
          const redoStack = fileRedoHistory.get(filePath);
          if (!redoStack || redoStack.length === 0) return;

          if (fs.existsSync(filePath)) {
            const currentBuffer = fs.readFileSync(filePath);
            if (!fileUndoHistory.has(filePath)) fileUndoHistory.set(filePath, []);
            fileUndoHistory.get(filePath).push(currentBuffer);
          }

          const nextBuffer = redoStack.pop();
          fs.writeFileSync(filePath, nextBuffer);
          vscode.window.showInformationMessage(`↷ やり直しました (Redone save): ${fileName}`);

          base64Data = nextBuffer.toString('base64');
          webviewPanel.webview.postMessage({
            command: 'saveRedone',
            imageSrc: `data:${mimeType};base64,${base64Data}`,
            canUndoSave: true
          });
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to redo save: ${err.message}`);
        }
      } else if (message.command === 'copyImage') {
        try {
          const rawBase64 = message.data.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(rawBase64, 'base64');
          const tmpPath = path.join(os.tmpdir(), `temp_crop_copy_${Date.now()}.png`);
          fs.writeFileSync(tmpPath, buffer);

          if (process.platform === 'darwin') {
            exec(`osascript -e 'set the clipboard to (read (POSIX file "${tmpPath}") as «class PNGf»)'`, (error) => {
              try { fs.unlinkSync(tmpPath); } catch (e) {}
              if (error) {
                vscode.window.showErrorMessage(`Failed to copy image: ${error.message}`);
              } else {
                vscode.window.showInformationMessage('📋 Image copied to clipboard!');
              }
            });
          } else if (process.platform === 'win32') {
            exec(`powershell -command "Set-Clipboard -Path '${tmpPath}'"`, (error) => {
              try { fs.unlinkSync(tmpPath); } catch (e) {}
              if (error) {
                vscode.window.showErrorMessage(`Failed to copy image: ${error.message}`);
              } else {
                vscode.window.showInformationMessage('📋 Image copied to clipboard!');
              }
            });
          } else {
            exec(`xclip -selection clipboard -t image/png -i "${tmpPath}"`, (error) => {
              try { fs.unlinkSync(tmpPath); } catch (e) {}
              if (error) {
                vscode.window.showErrorMessage(`Failed to copy image: ${error.message}`);
              } else {
                vscode.window.showInformationMessage('📋 Image copied to clipboard!');
              }
            });
          }
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to copy image: ${err.message}`);
        }
      } else if (message.command === 'saveSettings') {
        if (message.settings) {
          if (message.settings.theme) {
            await this.context.globalState.update('simple-image-crop.theme', message.settings.theme);
          }
          if (message.settings.language) {
            await this.context.globalState.update('simple-image-crop.language', message.settings.language);
          }
          if (message.settings.style) {
            await this.context.globalState.update('simple-image-crop.style', message.settings.style);
          }
        }
      } else if (message.command === 'cancel') {
        webviewPanel.dispose();
      }
    });
  }
}

function getWebviewContent(fileName, mimeType, base64Data, config) {
  const imageSrc = `data:${mimeType};base64,${base64Data}`;
  const initialTheme = config && config.theme ? config.theme : 'light';
  const initialLanguage = config && config.language ? config.language : 'en';
  const initialStyle = (config && config.style) ? config.style : {
    strokeColor: '#ff3b30',
    strokeWidth: 4,
    fillColor: 'transparent',
    fontSize: 18,
    fontWeight: 'bold'
  };
  const isReadOnly = Boolean(config && config.isReadOnly);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Crop: ${fileName}</title>
  <style>
    :root {
      --bg-app: #181818;
      --bg-toolbar: #252526;
      --bg-footer: #202020;
      --border-color: #3c3c3c;
      --text-main: #cccccc;
      --text-title: #ffffff;
      --text-muted: #888888;
      --badge-bg: #333333;
      --badge-text: #9cdcfe;
      --btn-group-bg: #2d2d2d;
      --btn-toggle-color: #aaaaaa;
      --btn-toggle-hover: #3d3d3d;
      --btn-toggle-active-bg: #0e639c;
      --btn-toggle-active-color: #ffffff;
      --btn-sec-bg: #383838;
      --btn-sec-hover: #4a4a4a;
      --btn-sec-text: #e0e0e0;
      --btn-pri-bg: #107c41;
      --btn-pri-hover: #13914c;
      --btn-pri-text: #ffffff;
      --input-bg: #1e1e1e;
      --input-border: #4a4a4a;
      --input-text: #ffffff;
      --checker-1: #222222;
      --checker-2: transparent;
      --mask-color: rgba(10, 10, 10, 0.72);
      --crop-outline: rgba(255, 255, 255, 0.9);
      --handle-corner-border: #000000;
      --handle-corner-shadow: #ffffff;
      --handle-bar-bg: #000000;
      --handle-bar-shadow: #ffffff;
      --modal-bg: #252526;
      --modal-overlay: rgba(0, 0, 0, 0.65);
      --modal-box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6);
    }

    body.theme-light {
      --bg-app: #e9e9e9;
      --bg-toolbar: #f3f3f3;
      --bg-footer: #eaeaea;
      --border-color: #cccccc;
      --text-main: #333333;
      --text-title: #111111;
      --text-muted: #666666;
      --badge-bg: #e0e0e0;
      --badge-text: #055080;
      --btn-group-bg: #e0e0e0;
      --btn-toggle-color: #555555;
      --btn-toggle-hover: #d0d0d0;
      --btn-toggle-active-bg: #0078d4;
      --btn-toggle-active-color: #ffffff;
      --btn-sec-bg: #e2e2e2;
      --btn-sec-hover: #d4d4d4;
      --btn-sec-text: #222222;
      --btn-pri-bg: #107c41;
      --btn-pri-hover: #13914c;
      --btn-pri-text: #ffffff;
      --input-bg: #ffffff;
      --input-border: #b8b8b8;
      --input-text: #111111;
      --checker-1: #d2d2d2;
      --checker-2: transparent;
      --mask-color: rgba(255, 255, 255, 0.65);
      --crop-outline: #0078d4;
      --handle-corner-border: #005a9e;
      --handle-corner-shadow: #ffffff;
      --handle-bar-bg: #005a9e;
      --handle-bar-shadow: #ffffff;
      --modal-bg: #ffffff;
      --modal-overlay: rgba(0, 0, 0, 0.35);
      --modal-box-shadow: 0 12px 36px rgba(0, 0, 0, 0.25);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      user-select: none;
    }
    body {
      background-color: var(--bg-app);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      transition: background-color 0.2s, color 0.2s;
    }

    /* Toolbar (Streamlined 1-row Header) */
    .toolbar {
      background: var(--bg-toolbar);
      border-bottom: 1px solid var(--border-color);
      padding: 6px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      z-index: 100;
      box-shadow: 0 2px 6px rgba(0,0,0,0.1);
      flex-shrink: 0;
      white-space: nowrap;
      height: 42px;
      box-sizing: border-box;
    }
    .toolbar-left, .toolbar-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .toolbar-left {
      min-width: 0;
    }
    .file-title {
      font-weight: 600;
      font-size: 13px;
      color: var(--text-title);
      white-space: nowrap;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .badge {
      background: var(--badge-bg);
      color: var(--badge-text);
      padding: 3px 7px;
      border-radius: 4px;
      font-size: 11px;
      font-family: monospace;
      white-space: nowrap;
    }
    .badge-crop {
      color: #107c41;
      font-weight: 600;
    }
    body.theme-light .badge-crop {
      color: #0b6032;
    }

    .btn-group {
      display: inline-flex;
      align-items: center;
      background: var(--btn-group-bg);
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid var(--border-color);
    }
    .btn-toggle {
      background: transparent;
      border: none;
      color: var(--btn-toggle-color);
      padding: 3px 8px;
      font-size: 11px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: background 0.15s, color 0.15s;
    }
    .btn-toggle:hover {
      background: var(--btn-toggle-hover);
    }
    .btn-toggle.active {
      background: var(--btn-toggle-active-bg);
      color: var(--btn-toggle-active-color);
      font-weight: 600;
    }
    .btn-rotate {
      background: transparent;
      border: none;
      color: var(--btn-toggle-color);
      padding: 4px 7px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s;
    }
    .btn-rotate:hover {
      background: var(--btn-toggle-hover);
      color: var(--text-title);
    }
    .btn-rotate svg {
      width: 14px;
      height: 14px;
      display: block;
    }

    .crop-size-control {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      background: var(--btn-group-bg);
      padding: 2px 5px;
      border-radius: 4px;
      border: 1px solid var(--border-color);
      font-size: 11px;
    }
    .size-input-wrapper {
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }
    .size-input-wrapper label {
      color: var(--text-muted);
      font-size: 10px;
      font-weight: 600;
    }
    .size-input {
      width: 46px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--input-text);
      font-size: 11px;
      font-family: monospace;
      padding: 2px 3px;
      border-radius: 3px;
      text-align: right;
      outline: none;
      user-select: text;
    }
    .size-input:focus {
      border-color: #0078d4;
    }
    .lock-btn {
      background: var(--btn-sec-bg);
      border: 1px solid var(--border-color);
      cursor: pointer;
      color: var(--text-muted);
      font-size: 11px;
      padding: 3px 5px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: color 0.15s, background 0.15s, border-color 0.15s;
      flex-shrink: 0;
    }
    .lock-btn:hover {
      background: var(--btn-sec-hover);
      border-color: #0078d4;
    }
    .lock-btn.locked {
      background: rgba(0, 120, 212, 0.15);
      border-color: #0078d4;
      color: #0078d4;
    }

    .btn {
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      border: 1px solid transparent;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: background 0.15s, transform 0.05s, border-color 0.15s;
      white-space: nowrap;
    }
    .btn:active {
      transform: scale(0.98);
    }
    .btn-secondary {
      background: var(--btn-sec-bg);
      color: var(--btn-sec-text);
      border-color: var(--border-color);
    }
    .btn-secondary:hover {
      background: var(--btn-sec-hover);
    }
    .btn-primary {
      background: var(--btn-pri-bg);
      color: var(--btn-pri-text);
      font-weight: 600;
    }
    .btn-primary:hover {
      background: var(--btn-pri-hover);
    }
    .btn-theme {
      background: var(--btn-sec-bg);
      color: var(--btn-sec-text);
      border: 1px solid var(--border-color);
      padding: 4px 8px;
      font-size: 11px;
      border-radius: 4px;
      cursor: pointer;
    }
    .btn-theme:hover {
      background: var(--btn-sec-hover);
    }
    .btn-icon {
      background: var(--btn-sec-bg);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      padding: 4px 7px;
      font-size: 13px;
      border-radius: 4px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }
    .btn-icon:hover {
      background: var(--btn-sec-hover);
    }

    /* Main Layout (Workspace + Right Sidebar) */
    .main-layout {
      flex: 1;
      display: flex;
      overflow: hidden;
      position: relative;
      height: calc(100vh - 42px - 28px);
    }

    /* Workspace */
    .workspace {
      flex: 1;
      overflow: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      background: var(--bg-app);
      background-image:
        linear-gradient(45deg, var(--checker-1) 25%, var(--checker-2) 25%),
        linear-gradient(-45deg, var(--checker-1) 25%, var(--checker-2) 25%),
        linear-gradient(45deg, var(--checker-2) 75%, var(--checker-1) 75%),
        linear-gradient(-45deg, var(--checker-2) 75%, var(--checker-1) 75%);
      background-size: 20px 20px;
      background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
      padding: 40px;
      transition: background-color 0.2s;
    }

    /* Right Sidebar Panel */
    .sidebar-panel {
      width: 285px;
      min-width: 285px;
      background: var(--bg-toolbar);
      border-left: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 10px 12px;
      overflow-y: auto;
      overflow-x: hidden;
      user-select: none;
      z-index: 50;
      box-shadow: -2px 0 8px rgba(0, 0, 0, 0.05);
      box-sizing: border-box;
    }
    .sidebar-section {
      background: var(--bg-app);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 9px 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .section-title {
      font-size: 11.5px;
      font-weight: 700;
      color: var(--text-title);
      display: flex;
      align-items: center;
      gap: 5px;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 5px;
      margin-bottom: 1px;
    }
    .section-title-icon {
      font-size: 12px;
    }
    .sidebar-group {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .sidebar-label {
      font-size: 10.5px;
      font-weight: 600;
      color: var(--text-muted);
    }
    .label-with-value {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .sidebar-value-badge {
      font-size: 10px;
      font-family: monospace;
      font-weight: 600;
      color: #0078d4;
    }
    .sidebar-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .ratio-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px;
    }
    .btn-sidebar-toggle {
      background: var(--btn-group-bg);
      border: 1px solid var(--border-color);
      color: var(--btn-toggle-color);
      border-radius: 4px;
      padding: 5px 3px;
      font-size: 11px;
      cursor: pointer;
      text-align: center;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .btn-sidebar-toggle:hover {
      background: var(--btn-toggle-hover);
      border-color: var(--border-color);
    }
    .btn-sidebar-toggle.active {
      background: var(--btn-toggle-active-bg);
      color: var(--btn-toggle-active-color);
      border-color: var(--btn-toggle-active-bg);
      font-weight: 600;
    }
    .shapes-icon-grid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 5px;
    }
    .btn-shape-icon {
      height: 34px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--btn-group-bg);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      border-radius: 6px;
      padding: 0;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 0.05s;
    }
    .btn-shape-icon:hover {
      background: var(--btn-toggle-hover);
      border-color: #0078d4;
    }
    .btn-shape-icon:active {
      transform: scale(0.95);
    }
    .btn-shape-icon svg {
      width: 17px;
      height: 17px;
      display: block;
    }
    .btn-text-icon .text-icon {
      font-weight: 700;
      font-size: 15px;
      color: #0078d4;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    /* Width pills in Sidebar */
    .width-btn-group {
      display: flex;
      gap: 4px;
    }
    .btn-width-pill {
      flex: 1;
      background: var(--btn-group-bg);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      border-radius: 4px;
      padding: 4px 0;
      font-size: 11px;
      font-family: monospace;
      font-weight: 600;
      cursor: pointer;
      text-align: center;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .btn-width-pill:hover {
      background: var(--btn-toggle-hover);
    }
    .btn-width-pill.active {
      background: var(--btn-toggle-active-bg);
      color: var(--btn-toggle-active-color);
      border-color: var(--btn-toggle-active-bg);
    }

    /* Color Control Row in Sidebar */
    .color-control-row {
      display: flex;
      gap: 6px;
    }
    .btn-color-select {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      background: var(--btn-group-bg);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      border-radius: 5px;
      padding: 5px 6px;
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s, border-color 0.15s;
    }
    .btn-color-select:hover {
      background: var(--btn-toggle-hover);
      border-color: #0078d4;
    }
    .color-swatch-ring {
      width: 14px;
      height: 14px;
      border-radius: 3px;
      border: 2px solid #ff3b30;
      box-sizing: border-box;
      background: transparent;
    }
    .fill-ring {
      border: 1px solid rgba(128, 128, 128, 0.4);
      background: transparent;
      overflow: hidden;
      position: relative;
    }
    .color-swatch-inner {
      width: 100%;
      height: 100%;
      display: block;
      background: transparent;
    }
    .btn-eyedropper-tool {
      flex: 1.2;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      background: var(--btn-group-bg);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      border-radius: 5px;
      padding: 5px 6px;
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s, border-color 0.15s;
    }
    .btn-eyedropper-tool:hover {
      background: var(--btn-toggle-hover);
      border-color: #0078d4;
    }

    /* Actions grid in Sidebar */
    .sidebar-actions-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .btn-action-sm {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      background: var(--btn-sec-bg);
      border: 1px solid var(--border-color);
      color: var(--btn-sec-text);
      border-radius: 5px;
      padding: 6px 4px;
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s, border-color 0.15s;
    }
    .btn-action-sm:hover:not(:disabled) {
      background: var(--btn-sec-hover);
    }
    .btn-action-sm:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .btn-action-sm.btn-delete:hover:not(:disabled) {
      background: rgba(255, 59, 48, 0.15);
      border-color: #ff3b30;
      color: #ff3b30;
    }

    .sidebar-input-item {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--btn-group-bg);
      border: 1px solid var(--border-color);
      padding: 5px 8px;
      border-radius: 6px;
      font-size: 11px;
    }
    .sidebar-size-box {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 3px;
      background: var(--btn-group-bg);
      border: 1px solid var(--border-color);
      padding: 4px 6px;
      border-radius: 6px;
      font-size: 11px;
      box-sizing: border-box;
    }
    .size-field {
      display: flex;
      align-items: center;
      gap: 3px;
    }
    .size-field span {
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 700;
    }

    /* Stepper Number Input */
    .stepper-container {
      display: inline-flex;
      align-items: center;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      overflow: hidden;
      height: 24px;
      box-sizing: border-box;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .stepper-container:focus-within {
      border-color: #0078d4;
      box-shadow: 0 0 0 1px #0078d4;
    }
    .btn-step {
      width: 16px;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--btn-sec-bg);
      border: none;
      color: var(--text-main);
      cursor: pointer;
      font-size: 12px;
      font-weight: bold;
      line-height: 1;
      user-select: none;
      padding: 0;
      transition: background 0.15s, color 0.15s;
    }
    .btn-step:hover {
      background: var(--btn-sec-hover);
      color: #0078d4;
    }
    .btn-step:active {
      background: var(--btn-toggle-active-bg);
      color: #ffffff;
    }
    .stepper-input {
      width: 38px;
      height: 100%;
      background: var(--input-bg);
      border: none;
      color: var(--input-text);
      font-size: 11px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", monospace;
      font-weight: 600;
      text-align: center;
      outline: none;
      padding: 0 1px;
      box-sizing: border-box;
      -moz-appearance: textfield;
    }
    .stepper-input::-webkit-outer-spin-button,
    .stepper-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .typography-item {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
    }
    .form-select-sm {
      flex: 1;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--input-text);
      padding: 3px 6px;
      border-radius: 4px;
      font-size: 11px;
      outline: none;
    }

    /* Stage Container */
    .stage {
      position: relative;
      display: inline-block;
      transition: transform 0.05s ease-out;
    }

    /* Base Image */
    #sourceImg {
      display: block;
      max-width: 80vw;
      max-height: calc(80vh - 70px);
      width: auto;
      height: auto;
      pointer-events: none;
      image-rendering: auto;
      box-shadow: 0 8px 30px rgba(0,0,0,0.5);
      outline: 1px dashed rgba(128, 128, 128, 0.5);
    }

    /* Crop Mask */
    .mask {
      display: none;
    }

    /* Crop Box */
    .crop-box {
      position: absolute;
      box-sizing: border-box;
      outline: 1.5px dashed var(--crop-outline);
      box-shadow: 0 0 0 9999px var(--mask-color);
      cursor: move;
      z-index: 10;
      opacity: 0;
      transition: border-radius 0.15s ease, opacity 0.15s ease;
    }

    /* Excel-style Handles */
    .handle {
      position: absolute;
      z-index: 20;
    }

    /* Corner L-Handles */
    .handle-corner {
      width: 20px;
      height: 20px;
      box-sizing: border-box;
    }
    .handle-corner::after {
      content: '';
      position: absolute;
      width: 32px;
      height: 32px;
    }

    .handle-tl {
      top: -3px;
      left: -3px;
      border-top: 5px solid var(--handle-corner-border);
      border-left: 5px solid var(--handle-corner-border);
      filter: drop-shadow(0 0 1px var(--handle-corner-shadow));
      cursor: nwse-resize;
    }
    .handle-tl::after { top: -8px; left: -8px; }

    .handle-tr {
      top: -3px;
      right: -3px;
      border-top: 5px solid var(--handle-corner-border);
      border-right: 5px solid var(--handle-corner-border);
      filter: drop-shadow(0 0 1px var(--handle-corner-shadow));
      cursor: nesw-resize;
    }
    .handle-tr::after { top: -8px; right: -8px; }

    .handle-bl {
      bottom: -3px;
      left: -3px;
      border-bottom: 5px solid var(--handle-corner-border);
      border-left: 5px solid var(--handle-corner-border);
      filter: drop-shadow(0 0 1px var(--handle-corner-shadow));
      cursor: nesw-resize;
    }
    .handle-bl::after { bottom: -8px; left: -8px; }

    .handle-br {
      bottom: -3px;
      right: -3px;
      border-bottom: 5px solid var(--handle-corner-border);
      border-right: 5px solid var(--handle-corner-border);
      filter: drop-shadow(0 0 1px var(--handle-corner-shadow));
      cursor: nwse-resize;
    }
    .handle-br::after { bottom: -8px; right: -8px; }

    /* Edge Bar Handles */
    .handle-bar-h {
      width: 26px;
      height: 5px;
      background: var(--handle-bar-bg);
      box-shadow: 0 0 1px 1px var(--handle-bar-shadow);
      cursor: ns-resize;
    }
    .handle-bar-h::after {
      content: '';
      position: absolute;
      top: -12px;
      left: -6px;
      width: 38px;
      height: 26px;
    }

    .handle-t {
      top: -3px;
      left: 50%;
      transform: translateX(-50%);
    }
    .handle-b {
      bottom: -3px;
      left: 50%;
      transform: translateX(-50%);
    }

    .handle-bar-v {
      width: 5px;
      height: 26px;
      background: var(--handle-bar-bg);
      box-shadow: 0 0 1px 1px var(--handle-bar-shadow);
      cursor: ew-resize;
    }
    .handle-bar-v::after {
      content: '';
      position: absolute;
      top: -6px;
      left: -12px;
      width: 26px;
      height: 38px;
    }

    .handle-l {
      left: -3px;
      top: 50%;
      transform: translateY(-50%);
    }
    .handle-r {
      right: -3px;
      top: 50%;
      transform: translateY(-50%);
    }

    /* Modal (Resize & Settings) */
    .modal-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--modal-overlay);
      z-index: 200;
      align-items: center;
      justify-content: center;
    }
    .modal-overlay.open {
      display: flex;
    }
    .modal-content {
      background: var(--modal-bg);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 18px 22px;
      width: 340px;
      box-shadow: var(--modal-box-shadow);
      color: var(--text-main);
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 8px;
    }
    .modal-header h3 {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-title);
    }
    .modal-close-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 16px;
      cursor: pointer;
      line-height: 1;
    }
    .modal-close-btn:hover {
      color: var(--text-title);
    }
    .modal-body {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .form-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 12px;
    }
    .form-row label {
      color: var(--text-main);
      font-weight: 500;
    }
    .form-row input[type="number"] {
      width: 90px;
      padding: 4px 6px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--input-text);
      border-radius: 4px;
      font-family: monospace;
      text-align: right;
      outline: none;
    }
    .form-row input[type="number"]:focus {
      border-color: #0078d4;
    }
    .form-select {
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--input-text);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      outline: none;
      cursor: pointer;
      min-width: 140px;
    }
    .form-select:focus {
      border-color: #0078d4;
    }
    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-muted);
      cursor: pointer;
      user-select: none;
    }
    .preset-scale-group {
      display: flex;
      gap: 4px;
      margin-top: 4px;
    }
    .btn-preset {
      flex: 1;
      padding: 4px 0;
      font-size: 10px;
      background: var(--btn-sec-bg);
      border: 1px solid var(--border-color);
      color: var(--btn-sec-text);
      border-radius: 4px;
      cursor: pointer;
      text-align: center;
    }
    .btn-preset:hover {
      background: var(--btn-sec-hover);
    }
    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 18px;
      border-top: 1px solid var(--border-color);
      padding-top: 12px;
    }

    /* Footer Hint */
    .footer-hint {
      position: relative;
      z-index: 100;
      background: var(--bg-footer);
      border-top: 1px solid var(--border-color);
      padding: 4px 14px;
      font-size: 11px;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: nowrap;
      white-space: nowrap;
      overflow-x: auto;
      transition: background-color 0.2s;
    }
    .footer-left, .footer-center, .footer-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .footer-left {
      flex-shrink: 0;
    }
    .footer-center {
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: visible;
    }
    .footer-right {
      flex-shrink: 0;
    }
    .zoom-controls {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      background: var(--btn-group-bg);
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid var(--border-color);
    }
    .btn-zoom {
      background: transparent;
      border: none;
      color: var(--text-main);
      font-size: 10px;
      cursor: pointer;
      padding: 1px 4px;
      border-radius: 3px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }
    .btn-zoom:hover {
      background: var(--btn-toggle-hover);
    }
    .zoom-level {
      font-family: monospace;
      font-size: 11px;
      min-width: 38px;
      text-align: center;
      color: var(--text-title);
      cursor: pointer;
      user-select: none;
      padding: 1px 3px;
      border-radius: 3px;
    }
    .zoom-level:hover {
      background: var(--btn-toggle-hover);
    }
    .btn-zoom-fit {
      background: var(--btn-sec-bg);
      border: 1px solid var(--border-color);
      color: var(--btn-sec-text);
      font-size: 10px;
      cursor: pointer;
      padding: 1px 5px;
      border-radius: 3px;
      margin-left: 2px;
      transition: background 0.15s;
    }
    .btn-zoom-fit:hover {
      background: var(--btn-sec-hover);
    }
    .shortcut-tag {
      background: var(--badge-bg);
      color: var(--text-main);
      padding: 1px 5px;
      border-radius: 3px;
      margin: 0 2px;
      font-size: 10px;
    }

    /* Custom Context Menu */
    .context-menu {
      display: none;
      position: fixed;
      background: var(--modal-bg);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      box-shadow: var(--modal-box-shadow);
      padding: 4px;
      z-index: 500;
      min-width: 140px;
      user-select: none;
    }
    .context-menu.open {
      display: block;
    }
    .context-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 12px;
      color: var(--text-main);
      cursor: pointer;
      transition: background 0.1s;
    }
    .context-menu-item:hover {
      background: var(--btn-toggle-active-bg);
      color: var(--btn-toggle-active-color);
    }
    .context-menu-item:hover .context-menu-shortcut {
      color: rgba(255, 255, 255, 0.85);
    }
    .context-menu-shortcut {
      margin-left: auto;
      font-size: 11px;
      color: var(--text-muted);
      font-family: monospace;
    }

    /* Toast Notification */
    .toast {
      position: fixed;
      bottom: 42px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: rgba(16, 124, 65, 0.92);
      color: #ffffff;
      padding: 8px 18px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease, transform 0.2s ease;
      z-index: 1000;
      box-shadow: 0 4px 16px rgba(0,0,0,0.35);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }

    /* Toolbar Dividers */
    .toolbar-divider {
      width: 1px;
      height: 20px;
      background: var(--border-color);
      margin: 0 4px;
      flex-shrink: 0;
    }

    /* Markup Tool Buttons */
    .btn-tool {
      background: transparent;
      border: 1px solid transparent;
      color: var(--btn-toggle-color);
      padding: 3px 6px;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
      position: relative;
    }
    .btn-tool:hover {
      background: var(--btn-toggle-hover);
      color: var(--text-title);
    }
    .btn-tool.active {
      background: var(--btn-toggle-active-bg);
      color: var(--btn-toggle-active-color);
      font-weight: 600;
    }
    .tool-svg {
      width: 15px;
      height: 15px;
      display: block;
    }
    .text-tool-icon {
      font-size: 13px;
      font-weight: 700;
      line-height: 1;
      font-family: -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
    }
    .dropdown-arrow {
      font-size: 8px;
      opacity: 0.7;
      margin-left: 1px;
      line-height: 1;
    }

    /* Color Preview Boxes in Toolbar */
    .color-preview-box {
      width: 16px;
      height: 16px;
      border-radius: 3px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--input-bg);
      border: 1px solid var(--border-color);
      position: relative;
      overflow: hidden;
    }
    .stroke-box {
      border: 2.5px solid #ff3b30;
      background: transparent;
    }
    .fill-box {
      background: transparent;
    }
    .fill-box .color-preview-inner {
      width: 100%;
      height: 100%;
    }

    /* Popover Containers */
    .popover-anchor {
      position: relative;
      display: inline-flex;
    }
    .markup-popover {
      position: absolute;
      top: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      background: var(--modal-bg);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      box-shadow: var(--modal-box-shadow);
      padding: 6px;
      z-index: 300;
      display: none;
      flex-direction: column;
      gap: 3px;
      min-width: 130px;
    }
    .markup-popover.open {
      display: flex;
    }
    .menu-item {
      background: transparent;
      border: none;
      color: var(--text-main);
      padding: 5px 8px;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 7px;
      text-align: left;
      white-space: nowrap;
      transition: background 0.1s, color 0.1s;
    }
    .menu-item:hover {
      background: var(--btn-toggle-active-bg);
      color: var(--btn-toggle-active-color);
    }
    .menu-svg {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }

    /* Stroke Width Popover */
    .width-popover {
      min-width: 110px;
      padding: 8px;
    }
    .width-option {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 5px 8px;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.1s;
    }
    .width-option:hover {
      background: var(--btn-toggle-active-bg);
      color: #fff;
    }
    .width-option.selected {
      background: rgba(14, 99, 156, 0.25);
    }
    .width-line {
      flex: 1;
      background: currentColor;
      border-radius: 2px;
      min-width: 40px;
    }
    .width-label {
      font-size: 11px;
      font-family: monospace;
      width: 32px;
      text-align: right;
    }

    /* Text Style Popover */
    .text-style-popover {
      min-width: 140px;
      padding: 8px;
      gap: 8px;
    }
    .style-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 11px;
    }
    .style-select {
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--input-text);
      padding: 2px 4px;
      border-radius: 3px;
      font-size: 11px;
      outline: none;
    }

    /* macOS-Style Color Palette Popover */
    .mac-color-popover {
      position: fixed;
      background: #f6f6f6;
      border: 1px solid rgba(0, 0, 0, 0.18);
      border-radius: 14px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.3);
      padding: 12px;
      z-index: 400;
      display: none;
      flex-direction: column;
      gap: 6px;
      width: 254px;
      box-sizing: border-box;
      user-select: none;
    }
    body.theme-dark .mac-color-popover {
      background: #2a2a2a;
      border-color: rgba(255, 255, 255, 0.18);
    }
    .mac-color-popover.open {
      display: flex;
    }
    .popover-notch {
      position: absolute;
      top: -7px;
      left: 50%;
      transform: translateX(-50%) rotate(45deg);
      width: 12px;
      height: 12px;
      background: #f6f6f6;
      border-top: 1px solid rgba(0, 0, 0, 0.18);
      border-left: 1px solid rgba(0, 0, 0, 0.18);
    }
    body.theme-dark .popover-notch {
      background: #2a2a2a;
      border-top-color: rgba(255, 255, 255, 0.18);
      border-left-color: rgba(255, 255, 255, 0.18);
    }
    .color-palette-top {
      display: grid;
      grid-template-columns: repeat(12, 16px);
      gap: 3px;
      margin-bottom: 4px;
    }
    .color-palette-grid {
      display: grid;
      grid-template-columns: repeat(12, 16px);
      gap: 3px;
    }
    .color-swatch {
      width: 16px;
      height: 16px;
      border-radius: 2px;
      cursor: pointer;
      box-sizing: border-box;
      border: 1px solid rgba(0, 0, 0, 0.15);
      position: relative;
      transition: transform 0.1s, box-shadow 0.1s;
    }
    body.theme-dark .color-swatch {
      border-color: rgba(255, 255, 255, 0.15);
    }
    .color-swatch:hover {
      transform: scale(1.25);
      z-index: 10;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    }
    .color-swatch.selected {
      outline: 2px solid #0078d4;
      outline-offset: 1px;
      z-index: 5;
    }
    .swatch-transparent {
      background: #ffffff;
      position: relative;
      overflow: hidden;
    }
    .swatch-transparent::after {
      content: '';
      position: absolute;
      top: 50%;
      left: -20%;
      width: 140%;
      height: 2px;
      background: #ff3b30;
      transform: rotate(45deg);
      transform-origin: center;
    }
    .popover-footer-actions {
      display: flex;
      flex-direction: column;
      gap: 5px;
      margin-top: 8px;
    }
    .btn-eyedropper {
      background: rgba(0, 0, 0, 0.06);
      border: none;
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 11.5px;
      font-weight: 500;
      color: #111111;
      cursor: pointer;
      transition: background 0.15s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      width: 100%;
      white-space: nowrap;
      box-sizing: border-box;
    }
    body.theme-dark .btn-eyedropper {
      background: rgba(255, 255, 255, 0.1);
      color: #e0e0e0;
    }
    .btn-eyedropper:hover {
      background: rgba(0, 0, 0, 0.12);
    }
    body.theme-dark .btn-eyedropper:hover {
      background: rgba(255, 255, 255, 0.18);
    }
    .btn-show-color-panel {
      margin-top: 0;
      background: rgba(0, 0, 0, 0.06);
      border: none;
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 11.5px;
      font-weight: 500;
      color: #111111;
      cursor: pointer;
      transition: background 0.15s;
      text-align: center;
      width: 100%;
      white-space: nowrap;
      box-sizing: border-box;
    }
    body.theme-dark .btn-show-color-panel {
      background: rgba(255, 255, 255, 0.1);
      color: #e0e0e0;
    }
    .btn-show-color-panel:hover {
      background: rgba(0, 0, 0, 0.12);
    }
    body.theme-dark .btn-show-color-panel:hover {
      background: rgba(255, 255, 255, 0.18);
    }

    /* Eyedropper Fallback Mode Cursor */
    body.eyedropper-mode,
    body.eyedropper-mode #stage,
    body.eyedropper-mode #sourceImg,
    body.eyedropper-mode .crop-box,
    body.eyedropper-mode .annotations-svg {
      cursor: crosshair !important;
    }

    /* Annotations SVG Layer */
    .annotations-svg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 15;
      overflow: visible;
    }
    .annotation-item {
      pointer-events: auto;
      cursor: move;
    }
    .annotation-selection-box {
      fill: none;
      stroke: #0078d4;
      stroke-width: 1.5;
      stroke-dasharray: 4 3;
      pointer-events: none;
    }
    .annotation-handle {
      pointer-events: auto;
      fill: #ffffff;
      stroke: #0078d4;
      stroke-width: 1.5;
      cursor: pointer;
      transition: transform 0.05s;
    }
    .annotation-handle:hover {
      fill: #0078d4;
      stroke: #ffffff;
    }

    /* Inline Text Editor Overlay */
    .inline-text-editor {
      position: absolute;
      z-index: 60;
      background: rgba(255, 255, 255, 0.85);
      border: 1.5px dashed #0078d4;
      outline: none;
      color: #111111;
      padding: 2px 4px;
      margin: 0;
      resize: none;
      overflow: hidden;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.25;
      box-sizing: border-box;
      border-radius: 2px;
      display: none;
    }
    body.theme-dark .inline-text-editor {
      background: rgba(30, 30, 30, 0.9);
      color: #ffffff;
    }

    /* Read-Only / Git Diff Mode */
    body.mode-readonly .toolbar-center,
    body.mode-readonly #saveBtn,
    body.mode-readonly .crop-box,
    body.mode-readonly .mask,
    body.mode-readonly .annotations-svg,
    body.mode-readonly .inline-text-editor,
    body.mode-readonly .sidebar-panel {
      display: none !important;
    }
    .readonly-badge {
      display: none;
      background: #0078d4;
      color: #ffffff;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      margin-left: 6px;
    }
    body.mode-readonly .readonly-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
  </style>
</head>
<body class="${initialTheme === 'light' ? 'theme-light' : 'theme-dark'} ${isReadOnly ? 'mode-readonly' : ''}">

  <!-- Toolbar (Streamlined 1-Row Header) -->
  <div class="toolbar">
    <div class="toolbar-left">
      <button class="btn-icon" id="settingsBtn" onclick="openSettingsModal()" title="Settings">⚙️</button>
      <span class="file-title" id="fileTitle" title="${fileName}">${fileName}</span>
      <span class="readonly-badge" id="readonlyBadge">📄 修正前 (HEAD) - 閲覧モード</span>
    </div>

    <div class="toolbar-right">
      <button class="btn-theme" id="themeToggleBtn" onclick="toggleTheme()" title="Toggle Light/Dark Theme">
        ${initialTheme === 'light' ? '🌙 Dark' : '☀️ Light'}
      </button>
      <button class="btn btn-secondary" id="btnClose" onclick="cancel()">Close</button>
      <button class="btn btn-primary" id="saveBtn" onclick="saveAndOverwrite()">
        💾 Save & Overwrite (Cmd+S)
      </button>
    </div>
  </div>

  <!-- Main Layout: Canvas Workspace + Right Sidebar Panel -->
  <div class="main-layout">
    <!-- Workspace -->
    <div class="workspace" id="workspace">
      <div class="stage" id="stage">
        <img id="sourceImg" src="${imageSrc}" alt="${fileName}">

        <!-- Annotations (Shapes & Text) SVG Layer -->
        <svg id="annotationsSvg" class="annotations-svg">
          <g id="annotationsGroup"></g>
          <g id="selectionGroup"></g>
        </svg>

        <!-- Inline Text Editor -->
        <textarea id="inlineTextEditor" class="inline-text-editor" spellcheck="false"></textarea>

        <!-- Dark Outer Masks -->
        <div class="mask" id="maskTop"></div>
        <div class="mask" id="maskBottom"></div>
        <div class="mask" id="maskLeft"></div>
        <div class="mask" id="maskRight"></div>

        <!-- Crop Box & Handles -->
        <div class="crop-box" id="cropBox">
          <!-- Corner L-Handles -->
          <div class="handle handle-corner handle-tl" data-handle="tl"></div>
          <div class="handle handle-corner handle-tr" data-handle="tr"></div>
          <div class="handle handle-corner handle-bl" data-handle="bl"></div>
          <div class="handle handle-corner handle-br" data-handle="br"></div>

          <!-- Edge Bar Handles -->
          <div class="handle handle-bar-h handle-t" data-handle="t"></div>
          <div class="handle handle-bar-h handle-b" data-handle="b"></div>
          <div class="handle handle-bar-v handle-l" data-handle="l"></div>
          <div class="handle handle-bar-v handle-r" data-handle="r"></div>
        </div>
      </div>
    </div>

    <!-- Right Sidebar Panel -->
    <aside class="sidebar-panel" id="sidebarPanel">
      <!-- Section 1: Crop & Transform -->
      <div class="sidebar-section">
        <div class="section-title">
          <span class="section-title-icon">✂️</span>
          <span id="titleCropSection">トリミング</span>
        </div>
        
        <div class="sidebar-group">
          <label class="sidebar-label" id="labelAspect">縦横比:</label>
          <div class="ratio-grid">
            <button class="btn-sidebar-toggle active" id="ratioFree" onclick="setRatio('free')" title="自由な比率で切り抜き">自由</button>
            <button class="btn-sidebar-toggle" id="ratioSquare" onclick="setRatio('1:1')" title="1:1 正方形切り抜き">1:1</button>
            <button class="btn-sidebar-toggle" id="ratioPadSquare" onclick="padToSquare()" title="画像を削らず透明余白で正方形化">⛶ 余白</button>
            <button class="btn-sidebar-toggle" id="ratio16_9" onclick="setRatio('16:9')" title="16:9 ワイド切り抜き">16:9</button>
            <button class="btn-sidebar-toggle" id="ratio4_3" onclick="setRatio('4:3')" title="4:3 スタンダード切り抜き">4:3</button>
            <button class="btn-sidebar-toggle" id="btnShapeCircle" onclick="toggleShapeCircle()" title="丸型切り抜き (外側透明)">⚪ 円形</button>
          </div>
        </div>

        <div class="sidebar-row">
          <div class="sidebar-size-box" id="cropSizeControl" title="トリミングサイズ (W × H px)" style="width: 100%;">
            <div class="size-field">
              <span>W:</span>
              <div class="stepper-container">
                <button class="btn-step" type="button" onclick="stepDimension('w', -1, event)" title="-1 (Shift: -10)">−</button>
                <input type="number" id="cropInputW" class="stepper-input" min="1" step="1" onchange="onCropInputChange()">
                <button class="btn-step" type="button" onclick="stepDimension('w', 1, event)" title="+1 (Shift: +10)">+</button>
              </div>
            </div>
            <span style="color: var(--text-muted); font-size: 11px; font-weight: bold;">×</span>
            <div class="size-field">
              <span>H:</span>
              <div class="stepper-container">
                <button class="btn-step" type="button" onclick="stepDimension('h', -1, event)" title="-1 (Shift: -10)">−</button>
                <input type="number" id="cropInputH" class="stepper-input" min="1" step="1" onchange="onCropInputChange()">
                <button class="btn-step" type="button" onclick="stepDimension('h', 1, event)" title="+1 (Shift: +10)">+</button>
              </div>
            </div>
            <button id="ratioLockBtn" class="lock-btn" onclick="toggleRatioLock()" title="縦横比を固定 / 解除">🔓</button>
          </div>
        </div>

        <div class="sidebar-row">
          <div class="sidebar-input-item" id="cropRadiusWrapper" title="角丸の半径 (px)" style="flex: 1; justify-content: space-between;">
            <label for="cropRadiusInput" id="labelCropRadius">角丸 R:</label>
            <div style="display: flex; align-items: center; gap: 4px;">
              <div class="stepper-container">
                <button class="btn-step" type="button" onclick="stepRadius(-2, event)" title="-2 (Shift: -10)">−</button>
                <input type="number" id="cropRadiusInput" class="stepper-input" min="0" max="1000" step="2" value="0" onchange="onRadiusInputChange()">
                <button class="btn-step" type="button" onclick="stepRadius(2, event)" title="+2 (Shift: +10)">+</button>
              </div>
              <span style="font-size: 10px; color: var(--text-muted);">px</span>
            </div>
          </div>
        </div>

        <div class="sidebar-row">
          <div class="btn-group" style="width: 100%;">
            <button class="btn-rotate" id="btnRotateLeft" onclick="rotateImage(-90)" title="左に90°回転 ( [ )" style="flex: 1;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
            </button>
            <button class="btn-rotate" id="btnRotateRight" onclick="rotateImage(90)" title="右に90°回転 ( ] )" style="flex: 1;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                <path d="M21 3v5h-5"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Section 2: Shapes & Annotations -->
      <div class="sidebar-section">
        <div class="section-title">
          <span class="section-title-icon">🔷</span>
          <span id="titleShapesSection">図形・テキスト追加</span>
        </div>
        <div class="shapes-icon-grid">
          <button class="btn-shape-icon" onclick="addShape('rect')" id="btnShapeRect" title="四角形を追加">
            <svg viewBox="0 0 20 20"><rect x="2" y="4" width="16" height="12" rx="1" stroke="currentColor" fill="none" stroke-width="2"/></svg>
          </button>
          <button class="btn-shape-icon" onclick="addShape('rounded-rect')" id="btnShapeRoundRect" title="角丸四角形を追加">
            <svg viewBox="0 0 20 20"><rect x="2" y="4" width="16" height="12" rx="4" stroke="currentColor" fill="none" stroke-width="2"/></svg>
          </button>
          <button class="btn-shape-icon" onclick="addShape('ellipse')" id="btnShapeEllipse" title="円・楕円を追加">
            <svg viewBox="0 0 20 20"><ellipse cx="10" cy="10" rx="8" ry="6" stroke="currentColor" fill="none" stroke-width="2"/></svg>
          </button>
          <button class="btn-shape-icon" onclick="addShape('arrow')" id="btnShapeArrow" title="矢印を追加">
            <svg viewBox="0 0 20 20"><path d="M4 15 L14 5 M14 5 L8 5 M14 5 L14 11" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="btn-shape-icon" onclick="addShape('line')" id="btnShapeLine" title="直線を追加">
            <svg viewBox="0 0 20 20"><line x1="3" y1="16" x2="17" y2="4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
          <button class="btn-shape-icon btn-text-icon" onclick="addText()" id="btnAddText" title="テキストを追加">
            <span class="text-icon" id="textToolIcon">あ</span>
          </button>
        </div>
      </div>

      <!-- Section 3: Style & Appearance -->
      <div class="sidebar-section">
        <div class="section-title">
          <span class="section-title-icon">🎨</span>
          <span id="titleStyleSection">スタイル設定</span>
        </div>

        <!-- Stroke Width -->
        <div class="sidebar-group">
          <div class="label-with-value">
            <label class="sidebar-label" id="labelStrokeWidth">線の太さ:</label>
            <span class="sidebar-value-badge" id="strokeWidthValue">4px</span>
          </div>
          <div class="width-btn-group">
            <button class="btn-width-pill" data-width="2" onclick="setStrokeWidth(2)" title="線の太さ: 2px">2</button>
            <button class="btn-width-pill active" data-width="4" onclick="setStrokeWidth(4)" title="線の太さ: 4px">4</button>
            <button class="btn-width-pill" data-width="6" onclick="setStrokeWidth(6)" title="線の太さ: 6px">6</button>
            <button class="btn-width-pill" data-width="10" onclick="setStrokeWidth(10)" title="線の太さ: 10px">10</button>
            <button class="btn-width-pill" data-width="16" onclick="setStrokeWidth(16)" title="線の太さ: 16px">16</button>
          </div>
        </div>

        <!-- Color Pickers: Border & Fill & Eyedropper -->
        <div class="sidebar-group">
          <label class="sidebar-label" id="labelColors">カラー設定:</label>
          <div class="color-control-row">
            <button class="btn-color-select" id="btnSelectStrokeColor" onclick="openColorPopover('stroke', this)" title="枠線の色を選択">
              <span class="color-swatch-ring" id="strokeColorPreview"></span>
              <span id="i18nBorderColorLabel">枠線</span>
            </button>
            <button class="btn-color-select" id="btnSelectFillColor" onclick="openColorPopover('fill', this)" title="塗りつぶしの色を選択">
              <span class="color-swatch-ring fill-ring" id="fillColorPreview">
                <span class="color-swatch-inner" id="fillColorInner"></span>
              </span>
              <span id="i18nFillColorLabel">塗り</span>
            </button>
            <button class="btn-eyedropper-tool" id="btnQuickEyedropper" onclick="startQuickEyedropper()" title="スポイト (画像内の色を抽出)">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M20.71 5.63l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-3.12 3.12-1.93-1.91-1.41 1.41 1.42 1.42L3 16.25V21h4.75l8.92-8.92 1.42 1.42 1.41-1.41-1.92-1.92 3.12-3.12c.4-.4.4-1.03.01-1.42zM6.92 19L5 17.08l8.06-8.06 1.92 1.92L6.92 19z"/>
              </svg>
              <span id="i18nEyedropperBtn">スポイト</span>
            </button>
          </div>
        </div>

        <!-- Text Typography Settings -->
        <div class="sidebar-group">
          <label class="sidebar-label" id="labelTypography">テキスト設定:</label>
          <div class="sidebar-row">
            <div class="typography-item">
              <label id="i18nFontSize">サイズ:</label>
              <select class="form-select-sm" id="fontSizeSelect" onchange="setFontSize(this.value)">
                <option value="14">14px</option>
                <option value="18" selected>18px</option>
                <option value="24">24px</option>
                <option value="32">32px</option>
                <option value="44">44px</option>
                <option value="60">60px</option>
                <option value="84">84px</option>
              </select>
            </div>
            <button class="btn-toggle active" id="btnFontBold" onclick="toggleFontBold()" title="太字 (Bold)" style="padding: 3px 8px; font-weight: bold;">B</button>
          </div>
        </div>
      </div>

      <!-- Section 4: History & Edit Actions -->
      <div class="sidebar-section">
        <div class="section-title">
          <span class="section-title-icon">⚡</span>
          <span id="titleActionsSection">操作・履歴</span>
        </div>
        <div class="sidebar-actions-grid">
          <button class="btn-action-sm" id="btnUndo" onclick="undo()" title="元に戻す (Cmd+Z)">
            <span>↶</span>
            <span id="i18nUndo">元に戻す</span>
          </button>
          <button class="btn-action-sm" id="btnRedo" onclick="redo()" title="やり直す (Cmd+Shift+Z)">
            <span>↷</span>
            <span id="i18nRedo">やり直す</span>
          </button>
          <button class="btn-action-sm btn-delete" id="btnDeleteSelected" onclick="deleteSelected()" title="選択した図形を削除 (Del)" disabled>
            <span>🗑️</span>
            <span id="i18nDelete">削除</span>
          </button>
          <button class="btn-action-sm" id="btnOpenResize" onclick="openResizeModal()" title="画像サイズ変更 (リサイズ)">
            <span>📐</span>
            <span id="i18nResize">リサイズ</span>
          </button>
        </div>
      </div>
    </aside>
  </div>

  <!-- macOS-Style Color Palette Popover (Faithful to preview.app markup toolbar) -->
  <div class="mac-color-popover" id="colorPopover">
    <div class="popover-notch"></div>
    <!-- Top 12 Colors -->
    <div class="color-palette-top" id="paletteTop"></div>
    <!-- Color Grid (Transparent + Grayscale + Gradient colors) -->
    <div class="color-palette-grid" id="paletteGrid"></div>
    <!-- Popover Footer Actions: Eyedropper & Color Panel -->
    <div class="popover-footer-actions">
      <button class="btn-eyedropper" id="btnEyedropper" onclick="startEyedropper()" title="Eyedropper (Pick color from image)">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
          <path d="M20.71 5.63l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-3.12 3.12-1.93-1.91-1.41 1.41 1.42 1.42L3 16.25V21h4.75l8.92-8.92 1.42 1.42 1.41-1.41-1.92-1.92 3.12-3.12c.4-.4.4-1.03.01-1.42zM6.92 19L5 17.08l8.06-8.06 1.92 1.92L6.92 19z"/>
        </svg>
        <span id="i18nEyedropper">スポイト</span>
      </button>
      <button class="btn-show-color-panel" onclick="triggerNativeColorPicker()">
        <span id="i18nShowColors">カラーパネルを表示...</span>
      </button>
    </div>
    <input type="color" id="nativeColorPicker" style="position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0;" onchange="onNativeColorPicked(this.value)">
  </div>

  <!-- Resize Image Modal -->
  <div class="modal-overlay" id="resizeModal" onclick="onModalOverlayClick(event)">
    <div class="modal-content" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3 id="resizeModalTitle">📐 Resize Image</h3>
        <button class="modal-close-btn" onclick="closeResizeModal()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <label id="labelCurrentSize">Current Size:</label>
          <span id="modalCurrentSize" style="font-family: monospace; font-size: 11px;">-- x --</span>
        </div>
        <div class="form-row">
          <label for="resizeWidth" id="labelNewWidth">New Width (px):</label>
          <input type="number" id="resizeWidth" min="1" max="10000" oninput="onResizeWidthInput()">
        </div>
        <div class="form-row">
          <label for="resizeHeight" id="labelNewHeight">New Height (px):</label>
          <input type="number" id="resizeHeight" min="1" max="10000" oninput="onResizeHeightInput()">
        </div>
        <label class="checkbox-row">
          <input type="checkbox" id="resizeKeepRatio" checked onchange="onKeepRatioChange()">
          <span id="labelKeepRatio">Maintain aspect ratio</span>
        </label>
        <div>
          <span style="font-size: 11px; color: var(--text-muted);" id="labelQuickScale">Quick Scale:</span>
          <div class="preset-scale-group">
            <button class="btn-preset" onclick="applyPresetScale(0.25)">25%</button>
            <button class="btn-preset" onclick="applyPresetScale(0.5)">50%</button>
            <button class="btn-preset" onclick="applyPresetScale(0.75)">75%</button>
            <button class="btn-preset" onclick="applyPresetScale(1.0)">100%</button>
            <button class="btn-preset" onclick="applyPresetScale(1.5)">150%</button>
            <button class="btn-preset" onclick="applyPresetScale(2.0)">200%</button>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="btnResizeCancel" onclick="closeResizeModal()">Cancel</button>
        <button class="btn btn-primary" id="btnResizeSave" onclick="executeResizeAndSave()">💾 Resize & Save</button>
      </div>
    </div>
  </div>

  <!-- Settings Modal -->
  <div class="modal-overlay" id="settingsModal" onclick="onSettingsModalOverlayClick(event)">
    <div class="modal-content" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3 id="settingsModalTitle">⚙️ Settings</h3>
        <button class="modal-close-btn" onclick="closeSettingsModal()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <label for="settingsThemeSelect" id="labelTheme">Theme:</label>
          <select id="settingsThemeSelect" class="form-select" onchange="onThemeSelectChange()">
            <option value="light">☀️ Light</option>
            <option value="dark">🌙 Dark</option>
          </select>
        </div>
        <div class="form-row">
          <label for="settingsLangSelect" id="labelLanguage">Language:</label>
          <select id="settingsLangSelect" class="form-select" onchange="onLangSelectChange()">
            <option value="en">English</option>
            <option value="ja">日本語 (Japanese)</option>
            <option value="zh">简体中文 (Chinese)</option>
            <option value="ko">한국어 (Korean)</option>
            <option value="es">Español (Spanish)</option>
            <option value="de">Deutsch (German)</option>
            <option value="fr">Français (French)</option>
            <option value="vi">Tiếng Việt (Vietnamese)</option>
            <option value="hi">हिन्दी (Hindi)</option>
            <option value="it">Italiano (Italian)</option>
            <option value="pt">Português (Portuguese)</option>
            <option value="ru">Русский (Russian)</option>
          </select>
        </div>
      </div>
    </div>
  </div>

  <!-- Footer Hint & Info -->
  <div class="footer-hint">
    <div class="footer-left">
      <span class="badge" id="originalSizeBadge">Original: -- x --</span>
      <span class="badge badge-crop" id="cropSizeBadge">Crop: -- x --</span>
    </div>
    <div class="footer-center">
      <div class="zoom-controls">
        <button class="btn-zoom" onclick="zoomChange(-0.1)" title="Zoom Out (Ctrl+Minus)">➖</button>
        <span class="zoom-level" id="zoomLevelText" onclick="resetZoom()" title="Click to Reset Zoom (100%)">100%</span>
        <button class="btn-zoom" onclick="zoomChange(0.1)" title="Zoom In (Ctrl+Plus)">➕</button>
        <button class="btn-zoom-fit" onclick="resetZoom()" title="Reset to 100%">100%</button>
      </div>
    </div>
    <div class="footer-right">
      <span id="footerShortcutsText">Shortcuts: <span class="shortcut-tag">Cmd + S</span> Save / <span class="shortcut-tag">Cmd + C</span> Copy / <span class="shortcut-tag">1</span> 1:1 / <span class="shortcut-tag">F</span> Free / <span class="shortcut-tag">R</span> Reset</span>
    </div>
  </div>

  <!-- Custom Context Menu -->
  <div id="customContextMenu" class="context-menu">
    <div class="context-menu-item" onclick="copyCroppedImage()">
      <span class="context-menu-icon">📋</span>
      <span class="context-menu-label" id="contextMenuCopyLabel">Copy</span>
      <span class="context-menu-shortcut" id="contextMenuShortcutLabel">Cmd+C</span>
    </div>
  </div>

  <!-- Toast Notification -->
  <div id="toast" class="toast">📋 Copied to clipboard!</div>

  <script>
    const vscode = acquireVsCodeApi();
    const img = document.getElementById('sourceImg');
    const stage = document.getElementById('stage');
    const cropBox = document.getElementById('cropBox');
    const maskTop = document.getElementById('maskTop');
    const maskBottom = document.getElementById('maskBottom');
    const maskLeft = document.getElementById('maskLeft');
    const maskRight = document.getElementById('maskRight');
    const originalSizeBadge = document.getElementById('originalSizeBadge');
    const cropSizeBadge = document.getElementById('cropSizeBadge');
    const saveBtn = document.getElementById('saveBtn');
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const cropInputW = document.getElementById('cropInputW');
    const cropInputH = document.getElementById('cropInputH');
    const ratioLockBtn = document.getElementById('ratioLockBtn');

    // Resize Modal elements
    const resizeModal = document.getElementById('resizeModal');
    const modalCurrentSize = document.getElementById('modalCurrentSize');
    const resizeWidth = document.getElementById('resizeWidth');
    const resizeHeight = document.getElementById('resizeHeight');
    const resizeKeepRatio = document.getElementById('resizeKeepRatio');

    // Markup & Annotation elements
    const annotationsSvg = document.getElementById('annotationsSvg');
    const annotationsGroup = document.getElementById('annotationsGroup');
    const selectionGroup = document.getElementById('selectionGroup');
    const inlineTextEditor = document.getElementById('inlineTextEditor');
    const colorPopover = document.getElementById('colorPopover');
    const paletteTop = document.getElementById('paletteTop');
    const paletteGrid = document.getElementById('paletteGrid');
    const strokeColorPreview = document.getElementById('strokeColorPreview');
    const fillColorPreview = document.getElementById('fillColorPreview');
    const fillColorInner = document.getElementById('fillColorInner');
    const btnDeleteSelected = document.getElementById('btnDeleteSelected');
    const btnUndo = document.getElementById('btnUndo');
    const btnRedo = document.getElementById('btnRedo');
    const fontSizeSelect = document.getElementById('fontSizeSelect');
    const btnFontBold = document.getElementById('btnFontBold');
    const nativeColorPicker = document.getElementById('nativeColorPicker');

    // Settings Modal elements
    const settingsModal = document.getElementById('settingsModal');
    const settingsThemeSelect = document.getElementById('settingsThemeSelect');
    const settingsLangSelect = document.getElementById('settingsLangSelect');

    // i18n Dictionary
    const I18N = {
      en: {
        ratioFree: 'Free',
        ratioSquare: '1:1',
        ratioPadSquare: '⛶ Pad 1:1',
        ratio16_9: '16:9',
        ratio4_3: '4:3',
        resizeBtn: '📐 Resize',
        resetBtn: '↺ Reset',
        closeBtn: 'Close',
        saveBtn: '💾 Save & Overwrite (Cmd+S)',
        savingBtn: 'Saving...',
        resizingBtn: 'Resizing & Saving...',
        originalBadge: 'Original: ',
        cropBadge: 'Crop: ',
        settingsTitle: '⚙️ Settings',
        themeLabel: 'Theme:',
        langLabel: 'Language:',
        okBtn: 'OK',
        resizeTitle: '📐 Resize Image',
        currentSize: 'Current Size:',
        newWidth: 'New Width (px):',
        newHeight: 'New Height (px):',
        keepRatio: 'Maintain aspect ratio',
        quickScale: 'Quick Scale:',
        cancelBtn: 'Cancel',
        resizeSaveBtn: '💾 Resize & Save',
        shortcuts: 'Shortcuts: <span class="shortcut-tag">Cmd + S</span> Save / <span class="shortcut-tag">Cmd + C</span> Copy / <span class="shortcut-tag">[ ]</span> Rotate / <span class="shortcut-tag">1</span> 1:1 / <span class="shortcut-tag">F</span> Free / <span class="shortcut-tag">R</span> Reset',
        themeLight: '☀️ Light',
        copyMenu: 'Copy',
        copiedToast: '📋 Copied to clipboard!',
        themeDark: '🌙 Dark',
        shapeCircle: '⚪ Circle',
        rotateLeft: '⟲ -90°',
        rotateRight: '⟳ +90°',
        settingsTooltip: 'Settings',
        ratioPadSquareTitle: 'Expand to square with transparent padding',
        shapeCircleTitle: 'Circle crop (1:1 with transparent corners)',
        cropRadiusTitle: 'Corner Radius in pixels (e.g. 20)',
        rotateLeftTitle: 'Rotate Left 90° ( [ )',
        rotateRightTitle: 'Rotate Right 90° ( ] )',
        cropSizeTitle: 'Crop size in pixels (W x H)',
        ratioLockTitle: 'Lock Aspect Ratio',
        shapesBtn: 'Shapes',
        shapeRect: 'Rectangle',
        shapeRoundRect: 'Rounded Rectangle',
        shapeEllipse: 'Circle / Ellipse',
        shapeArrow: 'Arrow',
        shapeLine: 'Line',
        addTextBtn: 'Text',
        strokeWidthBtn: 'Stroke Width',
        strokeColorBtn: 'Border Color',
        fillColorBtn: 'Fill Color',
        textStyleBtn: 'Text Style',
        showColorsBtn: 'Show Colors...',
        defaultText: 'Text',
        deleteSelectedBtn: 'Delete',
        undoBtn: 'Undo (Cmd+Z)',
        redoBtn: 'Redo (Cmd+Shift+Z)',
        fontSizeLabel: 'Size:',
        boldLabel: 'Bold:',
        readonlyBadge: '📄 Previous (HEAD) - Read Only',
        savedUndoToast: '💾 Saved! (Press Cmd+Z to undo save)',
        undoToast: '↺ Undone',
        redoToast: '↷ Redone',
        saveUndoneToast: '↺ Restored file to state before save',
        eyedropperBtn: 'Eyedropper',
        eyedropperTitle: 'Eyedropper (Pick color from image)',
        eyedropperHint: '🔍 Eyedropper: Click anywhere on the image to sample color (Esc to cancel)',
        colorPickedToast: '🎨 Color picked: ',
        titleCropSection: 'Crop & Rotate',
        titleShapesSection: 'Add Shapes & Text',
        titleStyleSection: 'Style & Colors',
        titleActionsSection: 'Actions & History',
        labelAspect: 'Aspect Ratio:',
        labelCropRadius: 'Radius R:',
        labelStrokeWidth: 'Stroke Width:',
        labelColors: 'Colors:',
        labelTypography: 'Text:',
        btnBorderColorLabel: 'Border',
        btnFillColorLabel: 'Fill',
        btnEyedropperLabel: 'Eyedropper',
        undoAction: 'Undo',
        redoAction: 'Redo',
        deleteAction: 'Delete',
        resizeAction: 'Resize',
        shapeRectTitle: 'Add Rectangle',
        shapeRoundRectTitle: 'Add Rounded Rectangle',
        shapeEllipseTitle: 'Add Circle / Ellipse',
        shapeArrowTitle: 'Add Arrow',
        shapeLineTitle: 'Add Line',
        addTextTitle: 'Add Text Annotation',
        undoTitle: 'Undo Annotation (Cmd+Z)',
        redoTitle: 'Redo Annotation (Cmd+Shift+Z)',
        deleteTitle: 'Delete Selected (Del)',
        resizeTitleBtn: 'Resize Image Canvas'
      },
      ja: {
        ratioFree: '自由',
        ratioSquare: '1:1',
        ratioPadSquare: '⛶ 正方形余白',
        ratio16_9: '16:9',
        ratio4_3: '4:3',
        resizeBtn: '📐 リサイズ',
        resetBtn: '↺ リセット',
        closeBtn: '閉じる',
        saveBtn: '💾 上書き保存 (Cmd+S)',
        savingBtn: '保存中...',
        resizingBtn: 'リサイズ＆保存中...',
        originalBadge: '元画像: ',
        cropBadge: 'トリミング: ',
        settingsTitle: '⚙️ 設定',
        themeLabel: 'テーマ:',
        langLabel: '言語:',
        okBtn: 'OK',
        resizeTitle: '📐 画像サイズ変更',
        currentSize: '現在のサイズ:',
        newWidth: '新しい幅 (px):',
        newHeight: '新しい高さ (px):',
        keepRatio: '縦横比を維持',
        quickScale: 'クイック倍率:',
        cancelBtn: 'キャンセル',
        resizeSaveBtn: '💾 リサイズして保存',
        shortcuts: 'ショートカット: <span class="shortcut-tag">Cmd + S</span> 保存 / <span class="shortcut-tag">Cmd + C</span> コピー / <span class="shortcut-tag">[ ]</span> 回転 / <span class="shortcut-tag">1</span> 1:1 / <span class="shortcut-tag">F</span> 自由 / <span class="shortcut-tag">R</span> リセット',
        themeLight: '☀️ ライト',
        copyMenu: 'コピー',
        copiedToast: '📋 クリップボードにコピーしました',
        themeDark: '🌙 ダーク',
        shapeCircle: '⚪ 円形',
        rotateLeft: '⟲ 左90°',
        rotateRight: '⟳ 右90°',
        settingsTooltip: '設定',
        ratioPadSquareTitle: '画像を削らずに透明余白で正方形化',
        shapeCircleTitle: '丸型切り抜き (1:1 正方形・外側は透明)',
        cropRadiusTitle: '角丸の半径 (px)',
        rotateLeftTitle: '左に90°回転 ( [ )',
        rotateRightTitle: '右に90°回転 ( ] )',
        cropSizeTitle: 'トリミングサイズ (幅 × 高さ px)',
        ratioLockTitle: '縦横比を固定 / 解除',
        shapesBtn: '図形',
        shapeRect: '四角形',
        shapeRoundRect: '角丸四角形',
        shapeEllipse: '円・楕円',
        shapeArrow: '矢印',
        shapeLine: '直線',
        addTextBtn: 'テキスト',
        strokeWidthBtn: '線の太さ',
        strokeColorBtn: '枠線の色',
        fillColorBtn: '塗りつぶしの色',
        textStyleBtn: 'テキスト設定',
        showColorsBtn: 'カラーパネルを表示...',
        defaultText: 'テキスト',
        deleteSelectedBtn: '削除',
        undoBtn: '元に戻す (Cmd+Z)',
        redoBtn: 'やり直す (Cmd+Shift+Z)',
        fontSizeLabel: 'サイズ:',
        boldLabel: '太字:',
        readonlyBadge: '📄 変更前 (HEAD) - 閲覧モード',
        savedUndoToast: '💾 上書き保存しました (Cmd+Z で保存前に戻せます)',
        undoToast: '↺ 元に戻しました',
        redoToast: '↷ やり直しました',
        saveUndoneToast: '↺ 保存前の画像に復元しました',
        eyedropperBtn: 'スポイト',
        eyedropperTitle: 'スポイト (画像から色を取得)',
        eyedropperHint: '🔍 スポイト: 画像のクリックした場所の色を取得します (Escでキャンセル)',
        colorPickedToast: '🎨 色を取得しました: ',
        titleCropSection: 'トリミング',
        titleShapesSection: '図形・テキスト追加',
        titleStyleSection: 'スタイル設定',
        titleActionsSection: '操作・履歴',
        labelAspect: '縦横比:',
        labelCropRadius: '角丸 R:',
        labelStrokeWidth: '線の太さ:',
        labelColors: 'カラー設定:',
        labelTypography: 'テキスト設定:',
        btnBorderColorLabel: '枠線',
        btnFillColorLabel: '塗り',
        btnEyedropperLabel: 'スポイト',
        undoAction: '元に戻す',
        redoAction: 'やり直す',
        deleteAction: '削除',
        resizeAction: 'リサイズ',
        shapeRectTitle: '四角形を追加',
        shapeRoundRectTitle: '角丸四角形を追加',
        shapeEllipseTitle: '円・楕円を追加',
        shapeArrowTitle: '矢印を追加',
        shapeLineTitle: '直線を追加',
        addTextTitle: 'テキスト注釈を追加',
        undoTitle: '元に戻す (Cmd+Z)',
        redoTitle: 'やり直す (Cmd+Shift+Z)',
        deleteTitle: '選択した図形を削除 (Del)',
        resizeTitleBtn: '画像サイズ変更 (リサイズ)'
      },
      zh: {
        ratioFree: '自由',
        ratioSquare: '1:1',
        ratioPadSquare: '⛶ 正方形留白',
        ratio16_9: '16:9',
        ratio4_3: '4:3',
        resizeBtn: '📐 调整尺寸',
        resetBtn: '↺ 重置',
        closeBtn: '关闭',
        saveBtn: '💾 覆盖保存 (Cmd+S)',
        savingBtn: '保存中...',
        resizingBtn: '调整并保存中...',
        originalBadge: '原图: ',
        cropBadge: '裁剪: ',
        settingsTitle: '⚙️ 设置',
        themeLabel: '主题:',
        langLabel: '语言:',
        okBtn: '确定',
        resizeTitle: '📐 调整图像尺寸',
        currentSize: '当前尺寸:',
        newWidth: '新宽度 (px):',
        newHeight: '新高度 (px):',
        keepRatio: '保持宽高比',
        quickScale: '快速缩放:',
        cancelBtn: '取消',
        resizeSaveBtn: '💾 调整并保存',
        shortcuts: '快捷键: <span class="shortcut-tag">Cmd + S</span> 保存 / <span class="shortcut-tag">Cmd + C</span> 复制 / <span class="shortcut-tag">[ ]</span> 旋转 / <span class="shortcut-tag">1</span> 1:1 / <span class="shortcut-tag">F</span> 自由 / <span class="shortcut-tag">R</span> 重置',
        themeLight: '☀️ 浅色',
        copyMenu: '复制',
        copiedToast: '📋 已复制到剪贴板',
        themeDark: '🌙 深色',
        shapeCircle: '⚪ 圆形',
        rotateLeft: '⟲ 左90°',
        rotateRight: '⟳ 右90°',
        settingsTooltip: '设置',
        ratioPadSquareTitle: '通过透明留白扩展为正方形',
        shapeCircleTitle: '圆形裁剪 (1:1 比例・外侧透明)',
        cropRadiusTitle: '圆角半径 (px)',
        rotateLeftTitle: '向左旋转 90° ( [ )',
        rotateRightTitle: '向右旋转 90° ( ] )',
        cropSizeTitle: '裁剪尺寸 (宽 × 高 px)',
        ratioLockTitle: '锁定 / 解锁宽高比',
        shapesBtn: '图形',
        shapeRect: '四方形',
        shapeRoundRect: '圆角矩形',
        shapeEllipse: '圆形 / 椭圆',
        shapeArrow: '箭头',
        shapeLine: '直线',
        addTextBtn: '文本',
        strokeWidthBtn: '线条粗细',
        strokeColorBtn: '边框颜色',
        fillColorBtn: '填充颜色',
        textStyleBtn: '文本样式',
        showColorsBtn: '显示调色板...',
        defaultText: '文本',
        deleteSelectedBtn: '删除',
        undoBtn: '撤销 (Cmd+Z)',
        redoBtn: '重做 (Cmd+Shift+Z)',
        fontSizeLabel: '字号:',
        boldLabel: '粗体:',
        readonlyBadge: '📄 历史版本 (HEAD) - 只读',
        savedUndoToast: '💾 已保存！(按 Cmd+Z 可撤销保存)',
        undoToast: '↺ 已撤销',
        redoToast: '↷ 已重做',
        saveUndoneToast: '↺ 已恢复至保存前状态',
        eyedropperBtn: '吸管',
        eyedropperTitle: '吸管 (从图像中取色)',
        eyedropperHint: '🔍 吸管：点击图像任意位置取色 (按 Esc 取消)',
        colorPickedToast: '🎨 已提取颜色: ',
        titleCropSection: '裁剪与旋转',
        titleShapesSection: '添加图形与文本',
        titleStyleSection: '样式与颜色',
        titleActionsSection: '操作与历史',
        labelAspect: '宽高比:',
        labelCropRadius: '圆角 R:',
        labelStrokeWidth: '线条粗细:',
        labelColors: '颜色设置:',
        labelTypography: '文本设置:',
        btnBorderColorLabel: '边框',
        btnFillColorLabel: '填充',
        btnEyedropperLabel: '吸管',
        undoAction: '撤销',
        redoAction: '重做',
        deleteAction: '删除',
        resizeAction: '调整尺寸',
        shapeRectTitle: '添加矩形',
        shapeRoundRectTitle: '添加圆角矩形',
        shapeEllipseTitle: '添加圆形 / 椭圆',
        shapeArrowTitle: '添加箭头',
        shapeLineTitle: '添加直线',
        addTextTitle: '添加文本注释',
        undoTitle: '撤销 (Cmd+Z)',
        redoTitle: '重做 (Cmd+Shift+Z)',
        deleteTitle: '删除选中项 (Del)',
        resizeTitleBtn: '调整图像画布尺寸'
      },
      ko: {
        ratioFree: '자유',
        ratioSquare: '1:1',
        ratioPadSquare: '⛶ 정사각형 여백',
        ratio16_9: '16:9',
        ratio4_3: '4:3',
        resizeBtn: '📐 크기 변경',
        resetBtn: '↺ 초기화',
        closeBtn: '닫기',
        saveBtn: '💾 덮어쓰기 저장 (Cmd+S)',
        savingBtn: '저장 중...',
        resizingBtn: '변경 및 저장 중...',
        originalBadge: '원본: ',
        cropBadge: '크롭: ',
        settingsTitle: '⚙️ 설정',
        themeLabel: '테마:',
        langLabel: '언어:',
        okBtn: '확인',
        resizeTitle: '📐 이미지 크기 변경',
        currentSize: '현재 크기:',
        newWidth: '새 너비 (px):',
        newHeight: '새 높이 (px):',
        keepRatio: '가로세로 비율 유지',
        quickScale: '빠른 배율:',
        cancelBtn: '취소',
        resizeSaveBtn: '💾 크기 변경 및 저장',
        shortcuts: '단축키: <span class="shortcut-tag">Cmd + S</span> 저장 / <span class="shortcut-tag">Cmd + C</span> 복사 / <span class="shortcut-tag">[ ]</span> 회전 / <span class="shortcut-tag">1</span> 1:1 / <span class="shortcut-tag">F</span> 자유 / <span class="shortcut-tag">R</span> 초기화',
        themeLight: '☀️ 라이트',
        copyMenu: '복사',
        copiedToast: '📋 클립보드에 복사되었습니다',
        themeDark: '🌙 다크',
        shapeCircle: '⚪ 원형',
        rotateLeft: '⟲ 왼쪽 90°',
        rotateRight: '⟳ 오른쪽 90°',
        settingsTooltip: '설정',
        ratioPadSquareTitle: '투명 여백으로 정사각형 확장',
        shapeCircleTitle: '원형 크롭 (1:1 비율・외곽 투명)',
        cropRadiusTitle: '모서리 둥글기 반경 (px)',
        rotateLeftTitle: '왼쪽으로 90° 회전 ( [ )',
        rotateRightTitle: '오른쪽으로 90° 회전 ( ] )',
        cropSizeTitle: '크롭 크기 (가로 × 세로 px)',
        ratioLockTitle: '가로세로 비율 고정 / 해제',
        shapesBtn: '도형',
        shapeRect: '직사각형',
        shapeRoundRect: '둥근 직사각형',
        shapeEllipse: '원 / 타원',
        shapeArrow: '화살표',
        shapeLine: '직선',
        addTextBtn: '텍스트',
        strokeWidthBtn: '선 두께',
        strokeColorBtn: '테두리 색상',
        fillColorBtn: '채우기 색상',
        textStyleBtn: '텍스트 스타일',
        showColorsBtn: '색상 패널 표시...',
        defaultText: '텍스트',
        deleteSelectedBtn: '삭제',
        undoBtn: '실행 취소 (Cmd+Z)',
        redoBtn: '다시 실행 (Cmd+Shift+Z)',
        fontSizeLabel: '크기:',
        boldLabel: '굵게:',
        readonlyBadge: '📄 이전 버전 (HEAD) - 읽기 전용',
        savedUndoToast: '💾 저장 완료! (Cmd+Z로 저장 취소 가능)',
        undoToast: '↺ 실행 취소됨',
        redoToast: '↷ 다시 실행됨',
        saveUndoneToast: '↺ 저장 전 상태로 복원되었습니다',
        eyedropperBtn: '스포이트',
        eyedropperTitle: '스포이트 (이미지에서 색상 추출)',
        eyedropperHint: '🔍 스포이트: 이미지 아무 곳이나 클릭하여 색상 선택 (Esc로 취소)',
        colorPickedToast: '🎨 색상 추출됨: ',
        titleCropSection: '자르기 및 회전',
        titleShapesSection: '도형 및 텍스트 추가',
        titleStyleSection: '스타일 및 색상',
        titleActionsSection: '작업 및 기록',
        labelAspect: '가로세로 비율:',
        labelCropRadius: '모서리 R:',
        labelStrokeWidth: '선 두께:',
        labelColors: '색상 설정:',
        labelTypography: '텍스트 설정:',
        btnBorderColorLabel: '테두리',
        btnFillColorLabel: '채우기',
        btnEyedropperLabel: '스포이트',
        undoAction: '실행 취소',
        redoAction: '다시 실행',
        deleteAction: '삭제',
        resizeAction: '크기 변경',
        shapeRectTitle: '직사각형 추가',
        shapeRoundRectTitle: '둥근 직사각형 추가',
        shapeEllipseTitle: '원 / 타원 추가',
        shapeArrowTitle: '화살표 추가',
        shapeLineTitle: '직선 추가',
        addTextTitle: '텍스트 주석 추가',
        undoTitle: '실행 취소 (Cmd+Z)',
        redoTitle: '다시 실행 (Cmd+Shift+Z)',
        deleteTitle: '선택 항목 삭제 (Del)',
        resizeTitleBtn: '이미지 캔버스 크기 변경'
      },
      es: {
        ratioFree: 'Libre',
        ratioSquare: '1:1',
        ratioPadSquare: '⛶ Cuadrado+',
        ratio16_9: '16:9',
        ratio4_3: '4:3',
        resizeBtn: '📐 Redimensionar',
        resetBtn: '↺ Restablecer',
        closeBtn: 'Cerrar',
        saveBtn: '💾 Guardar y sobrescribir (Cmd+S)',
        savingBtn: 'Guardando...',
        resizingBtn: 'Redimensionando y guardando...',
        originalBadge: 'Original: ',
        cropBadge: 'Recorte: ',
        settingsTitle: '⚙️ Configuración',
        themeLabel: 'Tema:',
        langLabel: 'Idioma:',
        okBtn: 'Aceptar',
        resizeTitle: '📐 Redimensionar imagen',
        currentSize: 'Tamaño actual:',
        newWidth: 'Nuevo ancho (px):',
        newHeight: 'Nueva altura (px):',
        keepRatio: 'Mantener relación de aspecto',
        quickScale: 'Escala rápida:',
        cancelBtn: 'Cancelar',
        resizeSaveBtn: '💾 Redimensionar y guardar',
        shortcuts: 'Atajos: <span class="shortcut-tag">Cmd + S</span> Guardar / <span class="shortcut-tag">Cmd + C</span> Copiar / <span class="shortcut-tag">[ ]</span> Rotar / <span class="shortcut-tag">1</span> 1:1 / <span class="shortcut-tag">F</span> Libre / <span class="shortcut-tag">R</span> Reset',
        themeLight: '☀️ Claro',
        copyMenu: 'Copiar',
        copiedToast: '📋 ¡Copiado al portapapeles!',
        themeDark: '🌙 Oscuro',
        shapeCircle: '⚪ Círculo',
        rotateLeft: '⟲ -90°',
        rotateRight: '⟳ +90°',
        settingsTooltip: 'Configuración',
        ratioPadSquareTitle: 'Expandir a cuadrado con relleno transparente',
        shapeCircleTitle: 'Recorte circular (1:1 con esquinas transparentes)',
        cropRadiusTitle: 'Radio de esquina en píxeles (px)',
        rotateLeftTitle: 'Girar 90° a la izquierda ( [ )',
        rotateRightTitle: 'Girar 90° a la derecha ( ] )',
        cropSizeTitle: 'Tamaño de recorte (Ancho x Alto px)',
        ratioLockTitle: 'Bloquear / desbloquear relación de aspecto',
        shapesBtn: 'Formas',
        shapeRect: 'Rectángulo',
        shapeRoundRect: 'Rectángulo redondeado',
        shapeEllipse: 'Círculo / Elipse',
        shapeArrow: 'Flecha',
        shapeLine: 'Línea',
        addTextBtn: 'Texto',
        strokeWidthBtn: 'Grosor de trazo',
        strokeColorBtn: 'Color de borde',
        fillColorBtn: 'Color de relleno',
        textStyleBtn: 'Estilo de texto',
        showColorsBtn: 'Mostrar colores...',
        defaultText: 'Texto',
        deleteSelectedBtn: 'Eliminar',
        undoBtn: 'Deshacer (Cmd+Z)',
        redoBtn: 'Rehacer (Cmd+Shift+Z)',
        fontSizeLabel: 'Tamaño:',
        boldLabel: 'Negrita:',
        readonlyBadge: '📄 Versión anterior (HEAD) - Solo lectura',
        savedUndoToast: '💾 ¡Guardado! (Presiona Cmd+Z para deshacer guardado)',
        undoToast: '↺ Deshecho',
        redoToast: '↷ Rehecho',
        saveUndoneToast: '↺ Archivo restaurado al estado anterior',
        eyedropperBtn: 'Cuentagotas',
        eyedropperTitle: 'Cuentagotas (Tomar color de la imagen)',
        eyedropperHint: '🔍 Cuentagotas: Haz clic en la imagen para tomar una muestra (Esc para cancelar)',
        colorPickedToast: '🎨 Color tomado: ',
        titleCropSection: 'Recortar y rotar',
        titleShapesSection: 'Añadir formas y texto',
        titleStyleSection: 'Estilo y colores',
        titleActionsSection: 'Acciones e historial',
        labelAspect: 'Relación de aspecto:',
        labelCropRadius: 'Radio R:',
        labelStrokeWidth: 'Grosor de trazo:',
        labelColors: 'Colores:',
        labelTypography: 'Texto:',
        btnBorderColorLabel: 'Borde',
        btnFillColorLabel: 'Relleno',
        btnEyedropperLabel: 'Cuentagotas',
        undoAction: 'Deshacer',
        redoAction: 'Rehacer',
        deleteAction: 'Eliminar',
        resizeAction: 'Redimensionar',
        shapeRectTitle: 'Añadir rectángulo',
        shapeRoundRectTitle: 'Añadir rectángulo redondeado',
        shapeEllipseTitle: 'Añadir círculo / elipse',
        shapeArrowTitle: 'Añadir flecha',
        shapeLineTitle: 'Añadir línea',
        addTextTitle: 'Añadir anotación de texto',
        undoTitle: 'Deshacer (Cmd+Z)',
        redoTitle: 'Rehacer (Cmd+Shift+Z)',
        deleteTitle: 'Eliminar seleccionado (Del)',
        resizeTitleBtn: 'Redimensionar lienzo de imagen'
      },
      de: {
        ratioFree: 'Frei',
        ratioSquare: '1:1',
        ratioPadSquare: '⛶ Quadrat+',
        ratio16_9: '16:9',
        ratio4_3: '4:3',
        resizeBtn: '📐 Skalieren',
        resetBtn: '↺ Zurücksetzen',
        saveBtn: '💾 Speichern & Überschreiben (Cmd+S)',
        savingBtn: 'Wird gespeichert...',
        resizingBtn: 'Skalieren & Speichern...',
        originalBadge: 'Original: ',
        cropBadge: 'Zuschnitt: ',
        settingsTitle: '⚙️ Einstellungen',
        themeLabel: 'Design:',
        langLabel: 'Sprache:',
        okBtn: 'OK',
        resizeTitle: '📐 Bildgröße ändern',
        currentSize: 'Aktuelle Größe:',
        newWidth: 'Neue Breite (px):',
        newHeight: 'Neue Höhe (px):',
        keepRatio: 'Seitenverhältnis beibehalten',
        quickScale: 'Schnellskalierung:',
        cancelBtn: 'Abbrechen',
        resizeSaveBtn: '💾 Skalieren & Speichern',
        shortcuts: 'Kürzel: <span class="shortcut-tag">Cmd + S</span> Speichern / <span class="shortcut-tag">Cmd + C</span> Kopieren / <span class="shortcut-tag">[ ]</span> Drehen / <span class="shortcut-tag">1</span> 1:1 / <span class="shortcut-tag">F</span> Frei / <span class="shortcut-tag">R</span> Reset',
        themeLight: '☀️ Hell',
        copyMenu: 'Kopieren',
        copiedToast: '📋 In die Zwischenablage kopiert!',
        themeDark: '🌙 Dunkel',
        shapeCircle: '⚪ Kreis',
        rotateLeft: '⟲ -90°',
        rotateRight: '⟳ +90°',
        settingsTooltip: 'Einstellungen',
        ratioPadSquareTitle: 'Mit transparentem Rand zum Quadrat erweitern',
        shapeCircleTitle: 'Kreiszuschnitt (1:1 mit transparenten Ecken)',
        cropRadiusTitle: 'Eckenradius in Pixeln (px)',
        rotateLeftTitle: '90° nach links drehen ( [ )',
        rotateRightTitle: '90° nach rechts drehen ( ] )',
        cropSizeTitle: 'Zuschnittgröße (B × H px)',
        ratioLockTitle: 'Seitenverhältnis sperren / entsperren',
        shapesBtn: 'Formen',
        shapeRect: 'Rechteck',
        shapeRoundRect: 'Abgerundetes Rechteck',
        shapeEllipse: 'Kreis / Ellipse',
        shapeArrow: 'Pfeil',
        shapeLine: 'Linie',
        addTextBtn: 'Text',
        strokeWidthBtn: 'Strichbreite',
        strokeColorBtn: 'Rahmenfarbe',
        fillColorBtn: 'Füllfarbe',
        textStyleBtn: 'Textstil',
        showColorsBtn: 'Farben anzeigen...',
        defaultText: 'Text',
        deleteSelectedBtn: 'Löschen',
        undoBtn: 'Rückgängig (Cmd+Z)',
        redoBtn: 'Wiederholen (Cmd+Shift+Z)',
        fontSizeLabel: 'Größe:',
        boldLabel: 'Fett:',
        readonlyBadge: '📄 Vorherige Version (HEAD) - Schreibgeschützt',
        savedUndoToast: '💾 Gespeichert! (Cmd+Z drücken zum Rückgängigmachen)',
        undoToast: '↺ Rückgängig gemacht',
        redoToast: '↷ Wiederholt',
        saveUndoneToast: '↺ Datei vor dem Speichern wiederhergestellt',
        eyedropperBtn: 'Pipette',
        eyedropperTitle: 'Pipette (Farbe aus Bild aufnehmen)',
        eyedropperHint: '🔍 Pipette: Klicke auf das Bild zur Farbauswahl (Esc zum Abbrechen)',
        colorPickedToast: '🎨 Farbe aufgenommen: ',
        titleCropSection: 'Zuschneiden & Drehen',
        titleShapesSection: 'Formen & Text hinzufügen',
        titleStyleSection: 'Stil & Farben',
        titleActionsSection: 'Aktionen & Verlauf',
        labelAspect: 'Seitenverhältnis:',
        labelCropRadius: 'Radius R:',
        labelStrokeWidth: 'Strichbreite:',
        labelColors: 'Farben:',
        labelTypography: 'Text:',
        btnBorderColorLabel: 'Rahmen',
        btnFillColorLabel: 'Füllung',
        btnEyedropperLabel: 'Pipette',
        undoAction: 'Rückgängig',
        redoAction: 'Wiederholen',
        deleteAction: 'Löschen',
        resizeAction: 'Größe ändern',
        shapeRectTitle: 'Rechteck hinzufügen',
        shapeRoundRectTitle: 'Abgerundetes Rechteck hinzufügen',
        shapeEllipseTitle: 'Kreis / Ellipse hinzufügen',
        shapeArrowTitle: 'Pfeil hinzufügen',
        shapeLineTitle: 'Linie hinzufügen',
        addTextTitle: 'Text hinzufügen',
        undoTitle: 'Rückgängig (Cmd+Z)',
        redoTitle: 'Wiederholen (Cmd+Shift+Z)',
        deleteTitle: 'Auswahl löschen (Entf)',
        resizeTitleBtn: 'Bildgröße ändern'
      },
      fr: {
        ratioFree: 'Libre',
        ratioSquare: '1:1',
        ratioPadSquare: '⛶ Carré+',
        ratio16_9: '16:9',
        ratio4_3: '4:3',
        resizeBtn: '📐 Redimensionner',
        resetBtn: '↺ Réinitialiser',
        closeBtn: 'Fermer',
        saveBtn: '💾 Enregistrer et écraser (Cmd+S)',
        savingBtn: 'Enregistrement...',
        resizingBtn: 'Redimensionnement et enregistrement...',
        originalBadge: 'Original : ',
        cropBadge: 'Recadrage : ',
        settingsTitle: '⚙️ Paramètres',
        themeLabel: 'Thème :',
        langLabel: 'Langue :',
        okBtn: 'OK',
        resizeTitle: "📐 Redimensionner l'image",
        currentSize: 'Taille actuelle :',
        newWidth: 'Nouvelle largeur (px) :',
        newHeight: 'Nouvelle hauteur (px) :',
        keepRatio: 'Conserver les proportions',
        quickScale: 'Échelle rapide :',
        cancelBtn: 'Annuler',
        resizeSaveBtn: '💾 Redimensionner et enregistrer',
        shortcuts: 'Raccourcis : <span class="shortcut-tag">Cmd + S</span> Enregistrer / <span class="shortcut-tag">Cmd + C</span> Copier / <span class="shortcut-tag">[ ]</span> Faire pivoter / <span class="shortcut-tag">1</span> 1:1 / <span class="shortcut-tag">F</span> Libre / <span class="shortcut-tag">R</span> Reset',
        themeLight: '☀️ Clair',
        copyMenu: 'Copier',
        copiedToast: '📋 Copié dans le presse-papiers !',
        themeDark: '🌙 Sombre',
        shapeCircle: '⚪ Cercle',
        rotateLeft: '⟲ -90°',
        rotateRight: '⟳ +90°',
        settingsTooltip: 'Paramètres',
        ratioPadSquareTitle: 'Étendre en carré avec une marge transparente',
        shapeCircleTitle: 'Recadrage circulaire (1:1 avec coins transparents)',
        cropRadiusTitle: 'Rayon des coins en pixels (px)',
        rotateLeftTitle: 'Pivoter de 90° vers la gauche ( [ )',
        rotateRightTitle: 'Pivoter de 90° vers la droite ( ] )',
        cropSizeTitle: 'Taille du recadrage (L x H px)',
        ratioLockTitle: 'Verrouiller / déverrouiller le format',
        shapesBtn: 'Formes',
        shapeRect: 'Rectangle',
        shapeRoundRect: 'Rectangle arrondi',
        shapeEllipse: 'Cercle / Ellipse',
        shapeArrow: 'Flèche',
        shapeLine: 'Ligne',
        addTextBtn: 'Texte',
        strokeWidthBtn: 'Épaisseur',
        strokeColorBtn: 'Couleur de bordure',
        fillColorBtn: 'Couleur de remplissage',
        textStyleBtn: 'Style de texte',
        showColorsBtn: 'Afficher les couleurs...',
        defaultText: 'Texte',
        deleteSelectedBtn: 'Supprimer',
        undoBtn: 'Annuler (Cmd+Z)',
        redoBtn: 'Rétablir (Cmd+Shift+Z)',
        fontSizeLabel: 'Taille :',
        boldLabel: 'Gras :',
        readonlyBadge: '📄 Version précédente (HEAD) - Lecture seule',
        savedUndoToast: '💾 Enregistré ! (Appuyez sur Cmd+Z pour annuler)',
        undoToast: '↺ Annulé',
        redoToast: '↷ Rétabli',
        saveUndoneToast: '↺ Fichier restauré avant enregistrement',
        eyedropperBtn: 'Pipette',
        eyedropperTitle: "Pipette (Prélever une couleur sur l'image)",
        eyedropperHint: "🔍 Pipette : Cliquez n'importe où pour prélever (Échap pour annuler)",
        colorPickedToast: '🎨 Couleur prélevée : ',
        titleCropSection: 'Recadrer et pivoter',
        titleShapesSection: 'Ajouter formes et texte',
        titleStyleSection: 'Style et couleurs',
        titleActionsSection: 'Actions et historique',
        labelAspect: 'Format :',
        labelCropRadius: 'Rayon R :',
        labelStrokeWidth: 'Épaisseur :',
        labelColors: 'Couleurs :',
        labelTypography: 'Texte :',
        btnBorderColorLabel: 'Bordure',
        btnFillColorLabel: 'Remplir',
        btnEyedropperLabel: 'Pipette',
        undoAction: 'Annuler',
        redoAction: 'Rétablir',
        deleteAction: 'Supprimer',
        resizeAction: 'Redimensionner',
        shapeRectTitle: 'Ajouter un rectangle',
        shapeRoundRectTitle: 'Ajouter un rectangle arrondi',
        shapeEllipseTitle: 'Ajouter un cercle / une ellipse',
        shapeArrowTitle: 'Ajouter une flèche',
        shapeLineTitle: 'Ajouter une ligne',
        addTextTitle: 'Ajouter un texte',
        undoTitle: 'Annuler (Cmd+Z)',
        redoTitle: 'Rétablir (Cmd+Shift+Z)',
        deleteTitle: 'Supprimer la sélection (Suppr)',
        resizeTitleBtn: "Redimensionner la zone de l'image"
      },
      vi: {
        ratioFree: 'Tự do',
        ratioSquare: '1:1',
        ratioPadSquare: '⛶ Vuông+',
        ratio16_9: '16:9',
        ratio4_3: '4:3',
        resizeBtn: '📐 Đổi cỡ',
        resetBtn: '↺ Đặt lại',
        closeBtn: 'Đóng',
        saveBtn: '💾 Lưu ghi đè (Cmd+S)',
        savingBtn: 'Đang lưu...',
        resizingBtn: 'Đang đổi cỡ và lưu...',
        originalBadge: 'Ảnh gốc: ',
        cropBadge: 'Cắt: ',
        settingsTitle: '⚙️ Cài đặt',
        themeLabel: 'Giao diện:',
        langLabel: 'Ngôn ngữ:',
        okBtn: 'OK',
        resizeTitle: '📐 Đổi kích thước ảnh',
        currentSize: 'Kích thước hiện tại:',
        newWidth: 'Chiều rộng mới (px):',
        newHeight: 'Chiều cao mới (px):',
        keepRatio: 'Giữ nguyên tỷ lệ',
        quickScale: 'Tỷ lệ nhanh:',
        cancelBtn: 'Hủy',
        resizeSaveBtn: '💾 Đổi cỡ và lưu',
        shortcuts: 'Phím tắt: <span class="shortcut-tag">Cmd + S</span> Lưu / <span class="shortcut-tag">Cmd + C</span> Sao chép / <span class="shortcut-tag">[ ]</span> Xoay / <span class="shortcut-tag">1</span> 1:1 / <span class="shortcut-tag">F</span> Tự do / <span class="shortcut-tag">R</span> Đặt lại',
        themeLight: '☀️ Sáng',
        copyMenu: 'Sao chép',
        copiedToast: '📋 Đã sao chép vào khay nhớ tạm!',
        themeDark: '🌙 Tối',
        shapeCircle: '⚪ Hình tròn',
        rotateLeft: '⟲ -90°',
        rotateRight: '⟳ +90°',
        settingsTooltip: 'Cài đặt',
        ratioPadSquareTitle: 'Mở rộng thành hình vuông với viền trong suốt',
        shapeCircleTitle: 'Cắt hình tròn (1:1 với các góc trong suốt)',
        cropRadiusTitle: 'Bán kính bo góc theo pixel (px)',
        rotateLeftTitle: 'Xoay trái 90° ( [ )',
        rotateRightTitle: 'Xoay phải 90° ( ] )',
        cropSizeTitle: 'Kích thước cắt (Rộng x Cao px)',
        ratioLockTitle: 'Khóa / mở khóa tỷ lệ khung hình',
        shapesBtn: 'Hình dạng',
        shapeRect: 'Hình chữ nhật',
        shapeRoundRect: 'Hình bo góc',
        shapeEllipse: 'Hình tròn / elip',
        shapeArrow: 'Mũi tên',
        shapeLine: 'Đường thẳng',
        addTextBtn: 'Văn bản',
        strokeWidthBtn: 'Độ dày viền',
        strokeColorBtn: 'Màu viền',
        fillColorBtn: 'Màu tô',
        textStyleBtn: 'Kiểu chữ',
        showColorsBtn: 'Bảng màu...',
        defaultText: 'Văn bản',
        deleteSelectedBtn: 'Xóa',
        undoBtn: 'Hoàn tác (Cmd+Z)',
        redoBtn: 'Làm lại (Cmd+Shift+Z)',
        fontSizeLabel: 'Cỡ chữ:',
        boldLabel: 'Đậm:',
        readonlyBadge: '📄 Bản sửa trước (HEAD) - Chỉ xem',
        savedUndoToast: '💾 Đã lưu! (Nhấn Cmd+Z để hủy lưu)',
        undoToast: '↺ Đã hoàn tác',
        redoToast: '↷ Đã làm lại',
        saveUndoneToast: '↺ Đã khôi phục tập tin về trước khi lưu',
        eyedropperBtn: 'Hút màu',
        eyedropperTitle: 'Hút màu (Chọn màu từ ảnh)',
        eyedropperHint: '🔍 Hút màu: Nhấp vào bất kỳ đâu trên ảnh để lấy mẫu (Esc để hủy)',
        colorPickedToast: '🎨 Đã chọn màu: ',
        titleCropSection: 'Cắt & Xoay',
        titleShapesSection: 'Thêm hình & Chữ',
        titleStyleSection: 'Kiểu dáng & Màu sắc',
        titleActionsSection: 'Thao tác & Lịch sử',
        labelAspect: 'Tỷ lệ khung hình:',
        labelCropRadius: 'Bo góc R:',
        labelStrokeWidth: 'Độ dày viền:',
        labelColors: 'Màu sắc:',
        labelTypography: 'Văn bản:',
        btnBorderColorLabel: 'Viền',
        btnFillColorLabel: 'Tô màu',
        btnEyedropperLabel: 'Hút màu',
        undoAction: 'Hoàn tác',
        redoAction: 'Làm lại',
        deleteAction: 'Xóa',
        resizeAction: 'Đổi cỡ',
        shapeRectTitle: 'Thêm hình chữ nhật',
        shapeRoundRectTitle: 'Thêm hình chữ nhật bo góc',
        shapeEllipseTitle: 'Thêm hình tròn / elip',
        shapeArrowTitle: 'Thêm mũi tên',
        shapeLineTitle: 'Thêm đường thẳng',
        addTextTitle: 'Thêm văn bản chú thích',
        undoTitle: 'Hoàn tác (Cmd+Z)',
        redoTitle: 'Làm lại (Cmd+Shift+Z)',
        deleteTitle: 'Xóa mục đã chọn (Del)',
        resizeTitleBtn: 'Đổi kích thước ảnh'
      },
      hi: {
        ratioFree: 'मुक्त',
        ratioSquare: '1:1',
        ratioPadSquare: '⛶ चौकोर+',
        ratio16_9: '16:9',
        ratio4_3: '4:3',
        resizeBtn: '📐 आकार बदलें',
        resetBtn: '↺ रीसेट',
        closeBtn: 'बंद करें',
        saveBtn: '💾 ओवरराइट सेव करें (Cmd+S)',
        savingBtn: 'सहेजा जा रहा है...',
        resizingBtn: 'आकार बदलकर सहेजा जा रहा है...',
        originalBadge: 'मूल: ',
        cropBadge: 'क्रॉप: ',
        settingsTitle: '⚙️ सेटिंग्स',
        themeLabel: 'थीम:',
        langLabel: 'भाषा:',
        resizeTitle: '📐 छवि का आकार बदलें',
        currentSize: 'वर्तमान आकार:',
        newWidth: 'नई चौड़ाई (px):',
        newHeight: 'नई ऊंचाई (px):',
        keepRatio: 'पहलू अनुपात बनाए रखें',
        quickScale: 'त्वरित पैमाना:',
        cancelBtn: 'रद्द करें',
        resizeSaveBtn: '💾 आकार बदलें और सहेजें',
        shortcuts: 'शॉर्टकट: <span class="shortcut-tag">Cmd + S</span> सेव / <span class="shortcut-tag">Cmd + C</span> कॉपी / <span class="shortcut-tag">[ ]</span> घुमाएँ / <span class="shortcut-tag">1</span> 1:1 / <span class="shortcut-tag">F</span> मुक्त / <span class="shortcut-tag">R</span> रीसेट',
        themeLight: '☀️ लाइट',
        copyMenu: 'कॉपी करें',
        copiedToast: '📋 क्लिपबोर्ड पर कॉपी किया गया!',
        themeDark: '🌙 डार्क',
        shapeCircle: '⚪ वृत्त',
        rotateLeft: '⟲ -90°',
        rotateRight: '⟳ +90°',
        settingsTooltip: 'सेटिंग्स',
        ratioPadSquareTitle: 'पारदर्शी पैडिंग के साथ चौकोर आकार में विस्तार करें',
        shapeCircleTitle: 'गोलाकार क्रॉप (1:1 पारदर्शी कोनों के साथ)',
        cropRadiusTitle: 'पिक्सेल में कोने का दायरा (px)',
        rotateLeftTitle: 'बाएं 90° घुमाएँ ( [ )',
        rotateRightTitle: 'दाएं 90° घुमाएँ ( ] )',
        cropSizeTitle: 'क्रॉप आकार (चौड़ाई × ऊंचाई px)',
        ratioLockTitle: 'पहलू अनुपात लॉक / अनलॉक करें',
        shapesBtn: 'आकृतियाँ',
        shapeRect: 'आयत',
        shapeRoundRect: 'गोल आयत',
        shapeEllipse: 'वृत्त / दीर्घवृत्त',
        shapeArrow: 'तीर',
        shapeLine: 'रेखा',
        addTextBtn: 'पाठ',
        strokeWidthBtn: 'रेखा मोटाई',
        strokeColorBtn: 'किनारे का रंग',
        fillColorBtn: 'भरने का रंग',
        textStyleBtn: 'पाठ शैली',
        showColorsBtn: 'रंग दिखाएं...',
        defaultText: 'पाठ',
        deleteSelectedBtn: 'हटाएं',
        undoBtn: 'पूर्ववत करें (Cmd+Z)',
        redoBtn: 'फिर से करें (Cmd+Shift+Z)',
        fontSizeLabel: 'आकार:',
        boldLabel: 'मोटा:',
        readonlyBadge: '📄 पिछला संस्करण (HEAD) - केवल पढ़ने के लिए',
        savedUndoToast: '💾 सहेजा गया! (पूर्ववत करने के लिए Cmd+Z दबाएं)',
        undoToast: '↺ पूर्ववत किया गया',
        redoToast: '↷ फिर से किया गया',
        saveUndoneToast: '↺ फ़ाइल को सहेजने से पहले की स्थिति में पुनर्स्थापित किया गया',
        eyedropperBtn: 'आईड्रॉपर',
        eyedropperTitle: 'आईड्रॉपर (छवि से रंग चुनें)',
        eyedropperHint: '🔍 आईड्रॉपर: रंग चुनने के लिए छवि पर कहीं भी क्लिक करें (रद्द करने के लिए Esc)',
        colorPickedToast: '🎨 चुना गया रंग: ',
        titleCropSection: 'काटें और घुमाएँ',
        titleShapesSection: 'आकृतियाँ और पाठ जोड़ें',
        titleStyleSection: 'शैली और रंग',
        titleActionsSection: 'क्रियाएँ और इतिहास',
        labelAspect: 'पहलू अनुपात:',
        labelCropRadius: 'त्रिज्या R:',
        labelStrokeWidth: 'रेखा की मोटाई:',
        labelColors: 'रंग:',
        labelTypography: 'पाठ:',
        btnBorderColorLabel: 'किनारा',
        btnFillColorLabel: 'भरें',
        btnEyedropperLabel: 'आईड्रॉपर',
        undoAction: 'पूर्ववत करें',
        redoAction: 'फिर से करें',
        deleteAction: 'हटाएं',
        resizeAction: 'आकार बदलें',
        shapeRectTitle: 'आयत जोड़ें',
        shapeRoundRectTitle: 'गोल आयत जोड़ें',
        shapeEllipseTitle: 'वृत्त / दीर्घवृत्त जोड़ें',
        shapeArrowTitle: 'तीर जोड़ें',
        shapeLineTitle: 'रेखा जोड़ें',
        addTextTitle: 'पाठ जोड़ें',
        undoTitle: 'पूर्ववत करें (Cmd+Z)',
        redoTitle: 'फिर से करें (Cmd+Shift+Z)',
        deleteTitle: 'चयनित हटाएं (Del)',
        resizeTitleBtn: 'छवि कैनवास का आकार बदलें'
      },
      it: {
        ratioFree: 'Libero',
        ratioSquare: '1:1',
        ratioPadSquare: '⛶ Quadrato+',
        ratio16_9: '16:9',
        ratio4_3: '4:3',
        resizeBtn: '📐 Ridimensiona',
        resetBtn: '↺ Ripristina',
        closeBtn: 'Chiudi',
        saveBtn: '💾 Salva e sovrascrivi (Cmd+S)',
        savingBtn: 'Salvataggio...',
        resizingBtn: 'Ridimensionamento e salvataggio...',
        originalBadge: 'Originale: ',
        cropBadge: 'Ritaglio: ',
        settingsTitle: '⚙️ Impostazioni',
        themeLabel: 'Tema:',
        langLabel: 'Lingua:',
        resizeTitle: "📐 Ridimensiona immagine",
        currentSize: 'Dimensioni attuali:',
        newWidth: 'Nuova larghezza (px):',
        newHeight: 'Nuova altezza (px):',
        keepRatio: 'Mantieni proporzioni',
        quickScale: 'Scala rapida:',
        cancelBtn: 'Annulla',
        resizeSaveBtn: '💾 Ridimensiona e salva',
        shortcuts: 'Scorciatoie: <span class="shortcut-tag">Cmd + S</span> Salva / <span class="shortcut-tag">Cmd + C</span> Copia / <span class="shortcut-tag">[ ]</span> Ruota / <span class="shortcut-tag">1</span> 1:1 / <span class="shortcut-tag">F</span> Libero / <span class="shortcut-tag">R</span> Reset',
        themeLight: '☀️ Chiaro',
        copyMenu: 'Copia',
        copiedToast: '📋 Copiato negli appunti!',
        themeDark: '🌙 Scuro',
        shapeCircle: '⚪ Cerchio',
        rotateLeft: '⟲ -90°',
        rotateRight: '⟳ +90°',
        settingsTooltip: 'Impostazioni',
        ratioPadSquareTitle: 'Espandi a quadrato con spaziatura trasparente',
        shapeCircleTitle: 'Ritaglio circolare (1:1 con angoli trasparenti)',
        cropRadiusTitle: 'Raggio angolo in pixel (px)',
        rotateLeftTitle: 'Ruota a sinistra di 90° ( [ )',
        rotateRightTitle: 'Ruota a destra di 90° ( ] )',
        cropSizeTitle: 'Dimensioni ritaglio (L x A px)',
        ratioLockTitle: 'Blocca / sblocca proporzioni',
        shapesBtn: 'Forme',
        shapeRect: 'Rettangolo',
        shapeRoundRect: 'Rettangolo arrotondato',
        shapeEllipse: 'Cerchio / Ellisse',
        shapeArrow: 'Freccia',
        shapeLine: 'Linea',
        addTextBtn: 'Testo',
        strokeWidthBtn: 'Spessore tratto',
        strokeColorBtn: 'Colore bordo',
        fillColorBtn: 'Colore riempimento',
        textStyleBtn: 'Stile testo',
        showColorsBtn: 'Mostra colori...',
        defaultText: 'Testo',
        deleteSelectedBtn: 'Elimina',
        undoBtn: 'Annulla (Cmd+Z)',
        redoBtn: 'Ripeti (Cmd+Shift+Z)',
        fontSizeLabel: 'Dimensione:',
        boldLabel: 'Grassetto:',
        readonlyBadge: '📄 Versione precedente (HEAD) - Sola lettura',
        savedUndoToast: '💾 Salvato! (Premi Cmd+Z per annullare salvataggio)',
        undoToast: '↺ Annullato',
        redoToast: '↷ Ripetuto',
        saveUndoneToast: '↺ File ripristinato allo stato precedente',
        eyedropperBtn: 'Contagocce',
        eyedropperTitle: "Contagocce (Campiona colore dall'immagine)",
        eyedropperHint: "🔍 Contagocce: Clicca sull'immagine per campionare (Esc per annullare)",
        colorPickedToast: '🎨 Colore campionato: ',
        titleCropSection: 'Ritaglia e ruota',
        titleShapesSection: 'Aggiungi forme e testo',
        titleStyleSection: 'Stile e colori',
        titleActionsSection: 'Azioni e cronologia',
        labelAspect: 'Proporzioni:',
        labelCropRadius: 'Raggio R:',
        labelStrokeWidth: 'Spessore tratto:',
        labelColors: 'Colori:',
        labelTypography: 'Testo:',
        btnBorderColorLabel: 'Bordo',
        btnFillColorLabel: 'Riempi',
        btnEyedropperLabel: 'Contagocce',
        undoAction: 'Annulla',
        redoAction: 'Ripeti',
        deleteAction: 'Elimina',
        resizeAction: 'Ridimensiona',
        shapeRectTitle: 'Aggiungi rettangolo',
        shapeRoundRectTitle: 'Aggiungi rettangolo arrotondato',
        shapeEllipseTitle: 'Aggiungi cerchio / ellisse',
        shapeArrowTitle: 'Aggiungi freccia',
        shapeLineTitle: 'Aggiungi linea',
        addTextTitle: 'Aggiungi annotazione testo',
        undoTitle: 'Annulla (Cmd+Z)',
        redoTitle: 'Ripeti (Cmd+Shift+Z)',
        deleteTitle: 'Elimina selezionato (Canc)',
        resizeTitleBtn: 'Ridimensiona tela immagine'
      },
      pt: {
        ratioFree: 'Livre',
        ratioSquare: '1:1',
        ratioPadSquare: '⛶ Quadrado+',
        ratio16_9: '16:9',
        ratio4_3: '4:3',
        resizeBtn: '📐 Redimensionar',
        resetBtn: '↺ Redefinir',
        closeBtn: 'Fechar',
        saveBtn: '💾 Salvar e sobrescrever (Cmd+S)',
        savingBtn: 'Salvando...',
        resizingBtn: 'Redimensionando e salvando...',
        originalBadge: 'Original: ',
        cropBadge: 'Corte: ',
        settingsTitle: '⚙️ Configurações',
        themeLabel: 'Tema:',
        langLabel: 'Idioma:',
        resizeTitle: '📐 Redimensionar Imagem',
        currentSize: 'Tamanho atual:',
        newWidth: 'Nova largura (px):',
        newHeight: 'Nova altura (px):',
        keepRatio: 'Manter proporção',
        quickScale: 'Escala rápida:',
        cancelBtn: 'Cancelar',
        resizeSaveBtn: '💾 Redimensionar e salvar',
        shortcuts: 'Atalhos: <span class="shortcut-tag">Cmd + S</span> Salvar / <span class="shortcut-tag">Cmd + C</span> Copiar / <span class="shortcut-tag">[ ]</span> Girar / <span class="shortcut-tag">1</span> 1:1 / <span class="shortcut-tag">F</span> Livre / <span class="shortcut-tag">R</span> Reset',
        themeLight: '☀️ Claro',
        copyMenu: 'Copiar',
        copiedToast: '📋 Copiado para a área de transferência!',
        themeDark: '🌙 Escuro',
        shapeCircle: '⚪ Círculo',
        rotateLeft: '⟲ -90°',
        rotateRight: '⟳ +90°',
        settingsTooltip: 'Configurações',
        ratioPadSquareTitle: 'Expandir para quadrado com preenchimento transparente',
        shapeCircleTitle: 'Corte circular (1:1 com cantos transparentes)',
        cropRadiusTitle: 'Raio do canto em pixels (px)',
        rotateLeftTitle: 'Girar 90° para a esquerda ( [ )',
        rotateRightTitle: 'Girar 90° para a direita ( ] )',
        cropSizeTitle: 'Tamanho do corte (L × A px)',
        ratioLockTitle: 'Bloquear / desbloquear proporção',
        shapesBtn: 'Formas',
        shapeRect: 'Retângulo',
        shapeRoundRect: 'Retângulo arredondado',
        shapeEllipse: 'Círculo / Elipse',
        shapeArrow: 'Seta',
        shapeLine: 'Linha',
        addTextBtn: 'Texto',
        strokeWidthBtn: 'Espessura',
        strokeColorBtn: 'Cor da borda',
        fillColorBtn: 'Cor de preenchimento',
        textStyleBtn: 'Estilo do texto',
        showColorsBtn: 'Mostrar cores...',
        defaultText: 'Texto',
        deleteSelectedBtn: 'Excluir',
        undoBtn: 'Desfazer (Cmd+Z)',
        redoBtn: 'Refazer (Cmd+Shift+Z)',
        fontSizeLabel: 'Tamanho:',
        boldLabel: 'Negrito:',
        readonlyBadge: '📄 Versão anterior (HEAD) - Somente leitura',
        savedUndoToast: '💾 Salvo! (Pressione Cmd+Z para desfazer salvamento)',
        undoToast: '↺ Desfeito',
        redoToast: '↷ Refeito',
        saveUndoneToast: '↺ Arquivo restaurado ao estado anterior',
        eyedropperBtn: 'Conta-gotas',
        eyedropperTitle: 'Conta-gotas (Capturar cor da imagem)',
        eyedropperHint: '🔍 Conta-gotas: Clique em qualquer lugar na imagem (Esc para cancelar)',
        colorPickedToast: '🎨 Cor capturada: ',
        titleCropSection: 'Cortar e girar',
        titleShapesSection: 'Adicionar formas e texto',
        titleStyleSection: 'Estilo e cores',
        titleActionsSection: 'Ações e histórico',
        labelAspect: 'Proporção:',
        labelCropRadius: 'Raio R:',
        labelStrokeWidth: 'Espessura:',
        labelColors: 'Cores:',
        labelTypography: 'Texto:',
        btnBorderColorLabel: 'Borda',
        btnFillColorLabel: 'Preencher',
        btnEyedropperLabel: 'Conta-gotas',
        undoAction: 'Desfazer',
        redoAction: 'Refazer',
        deleteAction: 'Excluir',
        resizeAction: 'Redimensionar',
        shapeRectTitle: 'Adicionar retângulo',
        shapeRoundRectTitle: 'Adicionar retângulo arredondado',
        shapeEllipseTitle: 'Adicionar círculo / elipse',
        shapeArrowTitle: 'Adicionar seta',
        shapeLineTitle: 'Adicionar linha',
        addTextTitle: 'Adicionar anotação de texto',
        undoTitle: 'Desfazer (Cmd+Z)',
        redoTitle: 'Refazer (Cmd+Shift+Z)',
        deleteTitle: 'Excluir selecionado (Del)',
        resizeTitleBtn: 'Redimensionar tela da imagem'
      },
      ru: {
        ratioFree: 'Свободно',
        ratioSquare: '1:1',
        ratioPadSquare: '⛶ Квадрат+',
        ratio16_9: '16:9',
        ratio4_3: '4:3',
        resizeBtn: '📐 Изменить размер',
        resetBtn: '↺ Сброс',
        closeBtn: 'Закрыть',
        saveBtn: '💾 Сохранить и перезаписать (Cmd+S)',
        savingBtn: 'Сохранение...',
        resizingBtn: 'Изменение размера и сохранение...',
        originalBadge: 'Оригинал: ',
        cropBadge: 'Обрезка: ',
        settingsTitle: '⚙️ Настройки',
        themeLabel: 'Тема:',
        langLabel: 'Язык:',
        resizeTitle: '📐 Изменение размера изображения',
        currentSize: 'Текущий размер:',
        newWidth: 'Новая ширина (px):',
        newHeight: 'Новая высота (px):',
        keepRatio: 'Сохранять пропорции',
        quickScale: 'Быстрый масштаб:',
        cancelBtn: 'Отмена',
        resizeSaveBtn: '💾 Изменить размер и сохранить',
        shortcuts: 'Горячие клавиши: <span class="shortcut-tag">Cmd + S</span> Сохранить / <span class="shortcut-tag">Cmd + C</span> Копировать / <span class="shortcut-tag">[ ]</span> Повернуть / <span class="shortcut-tag">1</span> 1:1 / <span class="shortcut-tag">F</span> Свободно / <span class="shortcut-tag">R</span> Сброс',
        themeLight: '☀️ Светлая',
        copyMenu: 'Копировать',
        copiedToast: '📋 Скопировано в буфер обмена!',
        themeDark: '🌙 Темная',
        shapeCircle: '⚪ Круг',
        rotateLeft: '⟲ -90°',
        rotateRight: '⟳ +90°',
        settingsTooltip: 'Настройки',
        ratioPadSquareTitle: 'Расширить до квадрата с прозрачными полями',
        shapeCircleTitle: 'Круглая обрезка (1:1 с прозрачными углами)',
        cropRadiusTitle: 'Радиус скругления углов (px)',
        rotateLeftTitle: 'Повернуть влево на 90° ( [ )',
        rotateRightTitle: 'Повернуть вправо на 90° ( ] )',
        cropSizeTitle: 'Размер обрезки (Ш × В px)',
        ratioLockTitle: 'Заблокировать / разблокировать пропорции',
        shapesBtn: 'Фигуры',
        shapeRect: 'Прямоугольник',
        shapeRoundRect: 'Скруглённый прямоугольник',
        shapeEllipse: 'Круг / Эллипс',
        shapeArrow: 'Стрелка',
        shapeLine: 'Линия',
        addTextBtn: 'Текст',
        strokeWidthBtn: 'Толщина линии',
        strokeColorBtn: 'Цвет рамки',
        fillColorBtn: 'Цвет заливки',
        textStyleBtn: 'Стиль текста',
        showColorsBtn: 'Показать цвета...',
        defaultText: 'Текст',
        deleteSelectedBtn: 'Удалить',
        undoBtn: 'Отменить (Cmd+Z)',
        redoBtn: 'Повторить (Cmd+Shift+Z)',
        fontSizeLabel: 'Размер:',
        boldLabel: 'Жирный:',
        readonlyBadge: '📄 Предыдущая версия (HEAD) - Только для чтения',
        savedUndoToast: '💾 Сохранено! (Нажмите Cmd+Z для отмены сохранения)',
        undoToast: '↺ Отменено',
        redoToast: '↷ Повторено',
        saveUndoneToast: '↺ Файл восстановлен до сохранения',
        eyedropperBtn: 'Пипетка',
        eyedropperTitle: 'Пипетка (Взять цвет с изображения)',
        eyedropperHint: '🔍 Пипетка: Нажмите на изображение для выбора цвета (Esc для отмены)',
        colorPickedToast: '🎨 Цвет выбран: ',
        titleCropSection: 'Обрезка и поворот',
        titleShapesSection: 'Фигуры и текст',
        titleStyleSection: 'Стиль и цвета',
        titleActionsSection: 'Действия и история',
        labelAspect: 'Соотношение сторон:',
        labelCropRadius: 'Радиус R:',
        labelStrokeWidth: 'Толщина линии:',
        labelColors: 'Цвета:',
        labelTypography: 'Текст:',
        btnBorderColorLabel: 'Контур',
        btnFillColorLabel: 'Заливка',
        btnEyedropperLabel: 'Пипетка',
        undoAction: 'Отменить',
        redoAction: 'Повторить',
        deleteAction: 'Удалить',
        resizeAction: 'Изменить',
        shapeRectTitle: 'Добавить прямоугольник',
        shapeRoundRectTitle: 'Добавить скруглённый прямоугольник',
        shapeEllipseTitle: 'Добавить круг / эллипс',
        shapeArrowTitle: 'Добавить стрелку',
        shapeLineTitle: 'Добавить линию',
        addTextTitle: 'Добавить текстовую надпись',
        undoTitle: 'Отменить (Cmd+Z)',
        redoTitle: 'Повторить (Cmd+Shift+Z)',
        deleteTitle: 'Удалить выбранное (Del)',
        resizeTitleBtn: 'Изменить размер холста изображения'
      }
    };

    // State
    let isImageInitialized = false;
    let currentTheme = '${initialTheme}';
    let currentLanguage = '${initialLanguage}';
    let currentRatio = 'free'; // 'free', '1:1', '16:9', '4:3'
    let isRatioLocked = false;
    let lockedRatioValue = 1; // W / H
    let currentZoom = 1.0;
    const zoomLevelText = document.getElementById('zoomLevelText');

    let crop = { left: 0, top: 0, width: 100, height: 100 };
    let isDragging = false;
    let dragMode = null;
    let startX = 0, startY = 0;
    let startCrop = { ...crop };
    let cropShape = 'rect'; // 'rect' | 'circle'
    let cornerRadius = 0; // in natural pixels
    const btnShapeCircle = document.getElementById('btnShapeCircle');
    const cropRadiusInput = document.getElementById('cropRadiusInput');

    // Markup & Annotations State
    let annotations = [];
    let selectedAnnotationId = null;
    let undoStack = [];
    let redoStack = [];
    let canUndoSave = false;
    let canRedoSave = false;
    let activeColorTarget = 'stroke'; // 'stroke' | 'fill'
    let currentStyle = Object.assign({
      strokeColor: '#ff3b30',
      strokeWidth: 4,
      fillColor: 'transparent',
      fontSize: 18,
      fontWeight: 'bold'
    }, ${JSON.stringify(initialStyle)});
    if (!currentStyle.fontSize || currentStyle.fontSize === 32) {
      currentStyle.fontSize = 18;
    }

    // Annotation Dragging / Transforming State
    let isAnnoDragging = false;
    let annoDragMode = null; // 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e' | 'p1' | 'p2'
    let annoStartX = 0, annoStartY = 0;
    let annoStartObj = null;
    let currentOpenPopover = null;

    // Apply initial theme, language & style
    applyTheme(currentTheme, false);
    applyLanguage(currentLanguage, false);
    applyInitialStyle();

    function applyInitialStyle() {
      updateStrokeWidthUI();
      updateColorPreviews();
      if (fontSizeSelect) {
        fontSizeSelect.value = String(currentStyle.fontSize || 18);
      }
      if (btnFontBold) {
        btnFontBold.classList.toggle('active', currentStyle.fontWeight === 'bold');
      }
    }

    function persistCurrentStyle() {
      try {
        vscode.postMessage({
          command: 'saveSettings',
          settings: {
            style: {
              strokeColor: currentStyle.strokeColor,
              strokeWidth: currentStyle.strokeWidth,
              fillColor: currentStyle.fillColor,
              fontSize: currentStyle.fontSize,
              fontWeight: currentStyle.fontWeight
            }
          }
        });
      } catch (err) {
        console.error('Failed to persist style:', err);
      }
    }

    function getT() {
      return I18N[currentLanguage] || I18N.en;
    }

    function applyTheme(theme, notifyHost = true) {
      currentTheme = theme;
      const t = getT();
      if (theme === 'light') {
        document.body.classList.add('theme-light');
        document.body.classList.remove('theme-dark');
        themeToggleBtn.innerText = t.themeDark;
      } else {
        document.body.classList.add('theme-dark');
        document.body.classList.remove('theme-light');
        themeToggleBtn.innerText = t.themeLight;
      }
      if (settingsThemeSelect) {
        settingsThemeSelect.value = currentTheme;
      }
      if (notifyHost) {
        vscode.postMessage({
          command: 'saveSettings',
          settings: { theme: currentTheme, language: currentLanguage }
        });
      }
    }

    function toggleTheme() {
      applyTheme(currentTheme === 'dark' ? 'light' : 'dark', true);
    }

    function applyLanguage(lang, notifyHost = true) {
      currentLanguage = I18N[lang] ? lang : 'en';
      const t = getT();

      if (settingsLangSelect) {
        settingsLangSelect.value = currentLanguage;
      }

      document.getElementById('ratioFree').innerText = t.ratioFree;
      document.getElementById('ratioSquare').innerText = t.ratioSquare;
      const padSquareBtn = document.getElementById('ratioPadSquare');
      if (padSquareBtn) {
        padSquareBtn.innerText = t.ratioPadSquare || '⛶ Pad 1:1';
        padSquareBtn.title = t.ratioPadSquareTitle || 'Pad 1:1';
      }
      document.getElementById('ratio16_9').innerText = t.ratio16_9;
      document.getElementById('ratio4_3').innerText = t.ratio4_3;

      // Tooltips & labels for controls
      const settingsBtn = document.getElementById('settingsBtn');
      if (settingsBtn) {
        settingsBtn.title = t.settingsTooltip || 'Settings';
      }
      if (btnShapeCircle) {
        btnShapeCircle.innerText = t.shapeCircle || '⚪ Circle';
        btnShapeCircle.title = t.shapeCircleTitle || 'Circle crop';
      }
      const cropRadiusWrapper = document.getElementById('cropRadiusWrapper');
      if (cropRadiusWrapper) {
        cropRadiusWrapper.title = t.cropRadiusTitle || 'Corner Radius (px)';
      }
      if (cropRadiusInput) {
        cropRadiusInput.title = t.cropRadiusTitle || 'Corner Radius (px)';
      }
      const btnRotateLeft = document.getElementById('btnRotateLeft');
      if (btnRotateLeft) {
        btnRotateLeft.title = t.rotateLeftTitle || 'Rotate Left 90° ( [ )';
      }
      const btnRotateRight = document.getElementById('btnRotateRight');
      if (btnRotateRight) {
        btnRotateRight.title = t.rotateRightTitle || 'Rotate Right 90° ( ] )';
      }
      const cropSizeControl = document.getElementById('cropSizeControl');
      if (cropSizeControl) {
        cropSizeControl.title = t.cropSizeTitle || 'Crop size in pixels (W x H)';
      }
      const ratioLockBtnEl = document.getElementById('ratioLockBtn');
      if (ratioLockBtnEl) {
        ratioLockBtnEl.title = t.ratioLockTitle || 'Lock Aspect Ratio';
      }

      const roBadge = document.getElementById('readonlyBadge');
      if (roBadge) roBadge.innerText = t.readonlyBadge || '📄 Previous (HEAD)';

      // Helper to safely set text and title
      const setInnerText = (id, val) => { const el = document.getElementById(id); if (el && val) el.innerText = val; };
      const setTitle = (id, val) => { const el = document.getElementById(id); if (el && val) el.title = val; };

      // Sidebar Section Titles & Group Labels
      setInnerText('titleCropSection', t.titleCropSection || 'Crop & Rotate');
      setInnerText('titleShapesSection', t.titleShapesSection || 'Add Shapes & Text');
      setInnerText('titleStyleSection', t.titleStyleSection || 'Style & Colors');
      setInnerText('titleActionsSection', t.titleActionsSection || 'Actions & History');
      setInnerText('labelAspect', t.labelAspect || 'Aspect Ratio:');
      setInnerText('labelCropRadius', t.labelCropRadius || 'Radius R:');
      setInnerText('labelStrokeWidth', t.labelStrokeWidth || 'Stroke Width:');
      setInnerText('labelColors', t.labelColors || 'Colors:');
      setInnerText('labelTypography', t.labelTypography || 'Text:');
      setInnerText('i18nBorderColorLabel', t.btnBorderColorLabel || 'Border');
      setInnerText('i18nFillColorLabel', t.btnFillColorLabel || 'Fill');
      setInnerText('i18nEyedropperBtn', t.btnEyedropperLabel || 'Eyedropper');
      setInnerText('i18nUndo', t.undoAction || 'Undo');
      setInnerText('i18nRedo', t.redoAction || 'Redo');
      setInnerText('i18nDelete', t.deleteAction || 'Delete');
      setInnerText('i18nResize', t.resizeAction || 'Resize');
      setInnerText('i18nAddText', t.addTextBtn || 'Text');

      // Shapes labels & tooltips
      setInnerText('i18nShapeRect', t.shapeRect || 'Rectangle');
      setInnerText('i18nShapeRoundRect', t.shapeRoundRect || 'Rounded Rectangle');
      setInnerText('i18nShapeEllipse', t.shapeEllipse || 'Circle / Ellipse');
      setInnerText('i18nShapeArrow', t.shapeArrow || 'Arrow');
      setInnerText('i18nShapeLine', t.shapeLine || 'Line');

      setTitle('btnShapeRect', t.shapeRectTitle || 'Add Rectangle');
      setTitle('btnShapeRoundRect', t.shapeRoundRectTitle || 'Add Rounded Rectangle');
      setTitle('btnShapeEllipse', t.shapeEllipseTitle || 'Add Circle / Ellipse');
      setTitle('btnShapeArrow', t.shapeArrowTitle || 'Add Arrow');
      setTitle('btnShapeLine', t.shapeLineTitle || 'Add Line');
      setTitle('btnAddText', t.addTextTitle || 'Add Text Annotation');
      setTitle('btnSelectStrokeColor', t.strokeColorBtn || 'Border Color');
      setTitle('btnSelectFillColor', t.fillColorBtn || 'Fill Color');
      setTitle('btnQuickEyedropper', t.eyedropperTitle || 'Eyedropper (Pick color from image)');
      setTitle('btnUndo', t.undoBtn || 'Undo (Cmd+Z)');
      setTitle('btnRedo', t.redoBtn || 'Redo (Cmd+Shift+Z)');
      setTitle('btnDeleteSelected', t.deleteTitle || 'Delete Selected (Del)');
      setTitle('btnOpenResize', t.resizeTitleBtn || 'Resize Image');

      const txtIcon = document.getElementById('textToolIcon');
      if (txtIcon) txtIcon.innerText = currentLanguage === 'ja' ? 'あ' : 'A';

      const elShowColors = document.getElementById('i18nShowColors');
      if (elShowColors) elShowColors.innerText = t.showColorsBtn || 'Show Colors...';
      const elEyedropper = document.getElementById('i18nEyedropper');
      if (elEyedropper) elEyedropper.innerText = t.eyedropperBtn || 'Eyedropper';
      const btnEyedropper = document.getElementById('btnEyedropper');
      if (btnEyedropper) btnEyedropper.title = t.eyedropperTitle || 'Eyedropper (Pick color from image)';
      const elFontSize = document.getElementById('i18nFontSize');
      if (elFontSize) elFontSize.innerText = t.fontSizeLabel || 'Size:';
      const elBold = document.getElementById('i18nBold');
      if (elBold) elBold.innerText = t.boldLabel || 'Bold:';

      const btnResetEl = document.getElementById('btnReset');
      if (btnResetEl) {
        btnResetEl.innerText = t.resetBtn;
        btnResetEl.title = t.resetBtnTitle || 'Reset Crop (R)';
      }
      document.getElementById('btnClose').innerText = t.closeBtn;
      document.getElementById('saveBtn').innerText = t.saveBtn;

      themeToggleBtn.innerText = currentTheme === 'light' ? t.themeDark : t.themeLight;

      // Settings Modal
      setInnerText('settingsModalTitle', t.settingsTitle || '⚙️ Settings');
      setInnerText('labelTheme', t.themeLabel || 'Theme:');
      setInnerText('labelLanguage', t.langLabel || 'Language:');

      // Resize Modal
      document.getElementById('resizeModalTitle').innerText = t.resizeTitle;
      document.getElementById('labelCurrentSize').innerText = t.currentSize;
      document.getElementById('labelNewWidth').innerText = t.newWidth;
      document.getElementById('labelNewHeight').innerText = t.newHeight;
      document.getElementById('labelKeepRatio').innerText = t.keepRatio;
      document.getElementById('labelQuickScale').innerText = t.quickScale;
      document.getElementById('btnResizeCancel').innerText = t.cancelBtn;
      document.getElementById('btnResizeSave').innerText = t.resizeSaveBtn;

      // Footer
      document.getElementById('footerShortcutsText').innerHTML = t.shortcuts;

      // Context Menu
      const copyLabel = document.getElementById('contextMenuCopyLabel');
      if (copyLabel && t.copyMenu) {
        copyLabel.innerText = t.copyMenu;
      }
      const shortcutLabel = document.getElementById('contextMenuShortcutLabel');
      if (shortcutLabel) {
        const isMac = (typeof navigator !== 'undefined' && navigator.userAgent) ? /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent) : false;
        shortcutLabel.innerText = isMac ? 'Cmd+C' : 'Ctrl+C';
      }

      if (isImageInitialized) {
        updateUI();
      }

      if (notifyHost) {
        vscode.postMessage({
          command: 'saveSettings',
          settings: { theme: currentTheme, language: currentLanguage }
        });
      }
    }

    function setZoom(zoom) {
      currentZoom = Math.max(0.25, Math.min(4.0, Math.round(zoom * 100) / 100));
      stage.style.transform = 'scale(' + currentZoom + ')';
      stage.style.transformOrigin = 'center center';
      if (zoomLevelText) {
        zoomLevelText.innerText = Math.round(currentZoom * 100) + '%';
      }
    }

    function zoomChange(delta) {
      setZoom(currentZoom + delta);
    }

    function resetZoom() {
      setZoom(1.0);
    }

    // --- Markup & Annotations Core Logic ---

    const PALETTE_TOP = [
      '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff',
      '#5856d6', '#af52de', '#a2845e', '#ffffff', '#8e8e93', '#000000'
    ];

    const PALETTE_GRID = [
      // Row 1: transparent + 11-step grayscale
      'transparent', '#ffffff', '#e5e5ea', '#d1d1d6', '#c7c7cc', '#aeaeb2', '#8e8e93', '#636366', '#48484a', '#3a3a3c', '#2c2c2e', '#1c1c1e',
      // Row 2: deep/dark tones
      '#001f3f', '#003366', '#1b1464', '#2e0854', '#4a0e4e', '#4a0000', '#592700', '#4d3800', '#2b3d00', '#003d1a', '#004040', '#002b40',
      // Row 3: dark hues
      '#003f7f', '#0059b3', '#392396', '#52006a', '#7a003c', '#800000', '#993d00', '#805d00', '#486600', '#006622', '#006666', '#004466',
      // Row 4: saturated hues
      '#0055ff', '#007aff', '#5856d6', '#8e24aa', '#b71c1c', '#c62828', '#d84315', '#ef6c00', '#f9a825', '#2e7d32', '#00897b', '#00838f',
      // Row 5: bright hues
      '#2979ff', '#2196f3', '#7c4dff', '#ba68c8', '#e91e63', '#f44336', '#ff5722', '#ff9800', '#ffc107', '#4caf50', '#00bfa5', '#00acc1',
      // Row 6: light hues
      '#64b5f6', '#03a9f4', '#b388ff', '#ce93d8', '#f06292', '#e57373', '#ff8a65', '#ffb74d', '#ffd54f', '#81c784', '#64ffda', '#4dd0e1',
      // Row 7: soft hues
      '#90caf9', '#4fc3f7', '#d1c4e9', '#e1bee7', '#f8bbd0', '#ffcdd2', '#ffccbc', '#ffe0b2', '#fff59d', '#a5d6a7', '#a7ffeb', '#80deea',
      // Row 8: pastel hues
      '#bbdefb', '#b3e5fc', '#ede7f6', '#f3e5f5', '#fce4ec', '#ffebee', '#fbe9e7', '#fff3e0', '#fffde7', '#c8e6c9', '#e0f2f1', '#e0f7fa',
      // Row 9: very pale hues
      '#e3f2fd', '#e1f5fe', '#f6f4fa', '#fbf5fa', '#fef4f7', '#fff8f8', '#fdf6f4', '#fff9f2', '#fffef5', '#e8f5e9', '#f2faf9', '#f2fafc'
    ];

    function buildColorPalette() {
      if (!paletteTop || !paletteGrid) return;
      paletteTop.innerHTML = '';
      paletteGrid.innerHTML = '';

      // Top 12 colors
      for (const color of PALETTE_TOP) {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = color;
        swatch.dataset.color = color;
        swatch.onclick = () => selectPaletteColor(color);
        paletteTop.appendChild(swatch);
      }

      // Grid colors (transparent + grayscale + gradients)
      for (const color of PALETTE_GRID) {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        if (color === 'transparent') {
          swatch.classList.add('swatch-transparent');
          swatch.title = 'Transparent';
        } else {
          swatch.style.backgroundColor = color;
        }
        swatch.dataset.color = color;
        swatch.onclick = () => selectPaletteColor(color);
        paletteGrid.appendChild(swatch);
      }

      updateColorPreviews();
    }

    function highlightSelectedColorSwatch() {
      const activeColor = activeColorTarget === 'stroke' ? currentStyle.strokeColor : currentStyle.fillColor;
      document.querySelectorAll('#colorPopover .color-swatch').forEach(sw => {
        if (sw.dataset.color && sw.dataset.color.toLowerCase() === activeColor.toLowerCase()) {
          sw.classList.add('selected');
        } else {
          sw.classList.remove('selected');
        }
      });
    }

    function togglePopover(id) {
      const popover = document.getElementById(id);
      if (!popover) return;
      const isOpen = popover.classList.contains('open');
      closeAllPopovers();
      if (!isOpen) {
        popover.classList.add('open');
        currentOpenPopover = popover;
      }
    }

    function openColorPopover(mode, btnEl) {
      activeColorTarget = mode;
      const isOpen = colorPopover.classList.contains('open') && currentOpenPopover === colorPopover;
      closeAllPopovers();
      if (isOpen) return;

      const rect = btnEl.getBoundingClientRect();
      let left = rect.left - 264;
      if (left < 10) left = 10;
      let top = rect.top - 20;
      if (top + 340 > window.innerHeight) top = window.innerHeight - 350;
      if (top < 10) top = 10;
      colorPopover.style.top = top + 'px';
      colorPopover.style.left = left + 'px';

      const notch = colorPopover.querySelector('.popover-notch');
      if (notch) {
        notch.style.display = 'none';
      }

      colorPopover.classList.add('open');
      currentOpenPopover = colorPopover;
      highlightSelectedColorSwatch();
    }

    function closeAllPopovers() {
      document.querySelectorAll('.markup-popover, .mac-color-popover').forEach(p => p.classList.remove('open'));
      currentOpenPopover = null;
    }

    function selectPaletteColor(color) {
      setColor(color);
      closeAllPopovers();
    }

    function setColor(color) {
      const selectedObj = annotations.find(a => a.id === selectedAnnotationId);
      if (activeColorTarget === 'stroke') {
        currentStyle.strokeColor = color;
        if (selectedObj) {
          selectedObj.strokeColor = color;
          if (selectedObj.type === 'text') selectedObj.color = color;
          pushHistory();
        }
      } else {
        currentStyle.fillColor = color;
        if (selectedObj) {
          selectedObj.fillColor = color;
          pushHistory();
        }
      }
      updateColorPreviews();
      renderAnnotations();
      persistCurrentStyle();
    }

    function updateColorPreviews() {
      if (strokeColorPreview) {
        if (currentStyle.strokeColor === 'transparent') {
          strokeColorPreview.style.borderColor = 'transparent';
          strokeColorPreview.classList.add('swatch-transparent');
        } else {
          strokeColorPreview.style.borderColor = currentStyle.strokeColor;
          strokeColorPreview.classList.remove('swatch-transparent');
        }
      }
      if (fillColorInner) {
        if (currentStyle.fillColor === 'transparent') {
          fillColorInner.style.backgroundColor = '';
          fillColorInner.classList.add('swatch-transparent');
        } else {
          fillColorInner.style.backgroundColor = currentStyle.fillColor;
          fillColorInner.classList.remove('swatch-transparent');
        }
      }
    }

    function triggerNativeColorPicker() {
      if (!nativeColorPicker) return;
      const initial = activeColorTarget === 'stroke' ? currentStyle.strokeColor : currentStyle.fillColor;
      nativeColorPicker.value = (initial && initial.startsWith('#') && initial.length === 7) ? initial : '#ff3b30';
      nativeColorPicker.click();
    }

    function onNativeColorPicked(color) {
      setColor(color);
      closeAllPopovers();
    }

    // Eyedropper State & Functions
    let isEyedropperActive = false;
    let eyedropperTarget = 'stroke';

    async function startEyedropper(target) {
      if (target) eyedropperTarget = target;
      else eyedropperTarget = activeColorTarget || 'stroke';
      closeAllPopovers();

      // 1. Try Native EyeDropper API (Chromium / VS Code Webview)
      if (window.EyeDropper) {
        try {
          const eyeDropper = new EyeDropper();
          const result = await eyeDropper.open();
          if (result && result.sRGBHex) {
            applyPickedColor(result.sRGBHex);
          }
          return;
        } catch (e) {
          if (e && (e.name === 'AbortError' || (e.message && e.message.indexOf('canceled') >= 0))) {
            return; // User canceled (e.g. Esc)
          }
          console.warn('Native EyeDropper API failed, fallback to canvas sampling', e);
        }
      }

      // 2. Fallback: Stage / Image Canvas Sampling Mode
      activateCanvasEyedropperFallback();
    }

    function startQuickEyedropper() {
      const target = selectedAnnotationId ? 'stroke' : (activeColorTarget || 'stroke');
      startEyedropper(target);
    }

    function activateCanvasEyedropperFallback() {
      isEyedropperActive = true;
      document.body.classList.add('eyedropper-mode');
      const t = getT();
      showToast(t.eyedropperHint || '🔍 スポイト: 画像上のクリックした場所の色を取得します (Escでキャンセル)');
    }

    function cancelEyedropperFallback() {
      if (!isEyedropperActive) return;
      isEyedropperActive = false;
      document.body.classList.remove('eyedropper-mode');
    }

    function sampleColorFromImage(clientX, clientY) {
      const rect = img.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        return null;
      }
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;
      const scale = img.naturalWidth / rect.width;
      const naturalX = Math.floor(relX * scale);
      const naturalY = Math.floor(relY * scale);

      if (naturalX < 0 || naturalX >= img.naturalWidth || naturalY < 0 || naturalY >= img.naturalHeight) {
        return null;
      }

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      try {
        const pixel = ctx.getImageData(naturalX, naturalY, 1, 1).data;
        const r = pixel[0].toString(16).padStart(2, '0');
        const g = pixel[1].toString(16).padStart(2, '0');
        const b = pixel[2].toString(16).padStart(2, '0');
        return '#' + r + g + b;
      } catch (err) {
        console.error('Failed to sample color from canvas:', err);
        return null;
      }
    }

    function applyPickedColor(hexColor) {
      activeColorTarget = eyedropperTarget || 'stroke';
      setColor(hexColor);
      const t = getT();
      showToast((t.colorPickedToast || '🎨 色を取得しました: ') + hexColor.toUpperCase());
    }

    function setStrokeWidth(w) {
      currentStyle.strokeWidth = w;
      const selectedObj = annotations.find(a => a.id === selectedAnnotationId);
      if (selectedObj) {
        selectedObj.strokeWidth = w;
        pushHistory();
        renderAnnotations();
      }
      updateStrokeWidthUI();
      closeAllPopovers();
      persistCurrentStyle();
    }

    function updateStrokeWidthUI() {
      document.querySelectorAll('.btn-width-pill').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.width, 10) === currentStyle.strokeWidth);
      });
      const valEl = document.getElementById('strokeWidthValue');
      if (valEl) valEl.innerText = currentStyle.strokeWidth + 'px';
    }

    function setFontSize(size) {
      const sz = parseInt(size, 10) || 18;
      currentStyle.fontSize = sz;
      const selectedObj = annotations.find(a => a.id === selectedAnnotationId);
      if (selectedObj && selectedObj.type === 'text') {
        selectedObj.fontSize = sz;
        pushHistory();
        renderAnnotations();
      }
      persistCurrentStyle();
    }

    function toggleFontBold() {
      currentStyle.fontWeight = currentStyle.fontWeight === 'bold' ? 'normal' : 'bold';
      if (btnFontBold) {
        btnFontBold.classList.toggle('active', currentStyle.fontWeight === 'bold');
      }
      const selectedObj = annotations.find(a => a.id === selectedAnnotationId);
      if (selectedObj && selectedObj.type === 'text') {
        selectedObj.fontWeight = currentStyle.fontWeight;
        pushHistory();
        renderAnnotations();
      }
      persistCurrentStyle();
    }

    // --- Comprehensive History Management (Crop, Rotate, Shapes, and Save Undo) ---
    function createSnapshot() {
      return {
        crop: { ...crop },
        currentRatio: currentRatio,
        cropShape: cropShape,
        cornerRadius: cornerRadius,
        imageSrc: img.src,
        annotations: JSON.parse(JSON.stringify(annotations))
      };
    }

    function pushHistory() {
      const snap = JSON.stringify(createSnapshot());
      if (undoStack.length > 0 && undoStack[undoStack.length - 1] === snap) {
        return;
      }
      undoStack.push(snap);
      if (undoStack.length > 50) undoStack.shift();
      redoStack = [];
      updateUndoRedoButtons();
    }

    function applySnapshot(snapStr) {
      try {
        const snap = JSON.parse(snapStr);
        crop = { ...snap.crop };
        currentRatio = snap.currentRatio || 'free';
        cropShape = snap.cropShape || 'rect';
        cornerRadius = snap.cornerRadius || 0;
        annotations = snap.annotations || [];
        if (img.src !== snap.imageSrc) {
          img.src = snap.imageSrc;
        }
        if (!annotations.find(a => a.id === selectedAnnotationId)) {
          selectedAnnotationId = null;
        }
        updateRatioButtons();
        if (cropRadiusInput) cropRadiusInput.value = cornerRadius;
        if (btnShapeCircle) btnShapeCircle.classList.toggle('active', cropShape === 'circle');
        updateUI();
        renderAnnotations();
      } catch (err) {
        console.error('Failed to apply history snapshot:', err);
      }
    }

    function undo() {
      if (undoStack.length > 1) {
        redoStack.push(undoStack.pop());
        const prev = undoStack[undoStack.length - 1];
        applySnapshot(prev);
        updateUndoRedoButtons();
        showToast(getT().undoToast || '↺ 元に戻しました');
      } else if (canUndoSave) {
        // All local unsaved changes are at initial state, so undo the last overwrite save!
        vscode.postMessage({ command: 'undoSave' });
      } else if (undoStack.length === 1) {
        applySnapshot(undoStack[0]);
        updateUndoRedoButtons();
        showToast(getT().undoToast || '↺ 元に戻しました');
      }
    }

    function redo() {
      if (redoStack.length > 0) {
        const next = redoStack.pop();
        undoStack.push(next);
        applySnapshot(next);
        updateUndoRedoButtons();
        showToast(getT().redoToast || '↷ やり直しました');
      } else if (canRedoSave) {
        vscode.postMessage({ command: 'redoSave' });
      }
    }

    function updateUndoRedoButtons() {
      const hasUndo = undoStack.length > 1 || canUndoSave;
      const hasRedo = redoStack.length > 0 || canRedoSave;
      if (btnUndo) btnUndo.disabled = !hasUndo;
      if (btnRedo) btnRedo.disabled = !hasRedo;
    }

    // --- Annotation Creation & Manipulation ---
    function getCenterNaturalCoord(defW = 200, defH = 140) {
      const stageW = img.clientWidth || 1;
      const scale = img.naturalWidth / stageW;
      let cx = (crop.left + crop.width / 2) * scale;
      let cy = (crop.top + crop.height / 2) * scale;
      if (isNaN(cx) || isNaN(cy) || cx <= 0 || cy <= 0) {
        cx = img.naturalWidth / 2;
        cy = img.naturalHeight / 2;
      }
      return {
        x: Math.round(Math.max(10, Math.min(img.naturalWidth - defW - 10, cx - defW / 2))),
        y: Math.round(Math.max(10, Math.min(img.naturalHeight - defH - 10, cy - defH / 2))),
        cx: Math.round(cx),
        cy: Math.round(cy)
      };
    }

    function addShape(type) {
      pushHistory();
      const stageW = img.clientWidth || 1;
      const scale = img.naturalWidth / stageW;
      const w = Math.round(Math.min(img.naturalWidth * 0.35, 260 * Math.max(1, scale)));
      const h = Math.round(Math.min(img.naturalHeight * 0.25, 180 * Math.max(1, scale)));
      const pos = getCenterNaturalCoord(w, h);
      const id = 'anno_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

      let item;
      if (type === 'rect' || type === 'rounded-rect' || type === 'ellipse') {
        item = {
          id,
          type,
          x: pos.x,
          y: pos.y,
          width: w,
          height: h,
          strokeColor: currentStyle.strokeColor,
          strokeWidth: currentStyle.strokeWidth,
          fillColor: currentStyle.fillColor,
          radius: type === 'rounded-rect' ? Math.round(Math.min(w, h) * 0.15) : 0
        };
      } else if (type === 'arrow' || type === 'line') {
        const len = Math.round(Math.min(img.naturalWidth * 0.25, 200 * Math.max(1, scale)));
        item = {
          id,
          type,
          x1: Math.round(pos.cx - len / 2),
          y1: Math.round(pos.cy + len / 3),
          x2: Math.round(pos.cx + len / 2),
          y2: Math.round(pos.cy - len / 3),
          strokeColor: currentStyle.strokeColor,
          strokeWidth: currentStyle.strokeWidth,
          fillColor: 'transparent'
        };
      }

      annotations.push(item);
      selectAnnotation(id);
      renderAnnotations();
      closeAllPopovers();
    }

    function addText() {
      pushHistory();
      const currentFontSize = (currentStyle && currentStyle.fontSize && currentStyle.fontSize !== 32) ? currentStyle.fontSize : 18;
      currentStyle.fontSize = currentFontSize;
      if (fontSizeSelect) fontSizeSelect.value = String(currentFontSize);
      const pos = getCenterNaturalCoord(80, 24);
      const id = 'anno_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      const t = getT();
      const item = {
        id,
        type: 'text',
        text: t.defaultText || 'Text',
        x: pos.x,
        y: pos.y,
        fontSize: currentFontSize,
        fontWeight: currentStyle.fontWeight || 'bold',
        color: currentStyle.strokeColor || '#ff3b30',
        strokeColor: currentStyle.strokeColor || '#ff3b30',
        fillColor: 'transparent'
      };
      annotations.push(item);
      selectAnnotation(id);
      renderAnnotations();
      closeAllPopovers();
      startInlineTextEdit(item);
    }

    function deleteSelected() {
      if (!selectedAnnotationId) return;
      pushHistory();
      annotations = annotations.filter(a => a.id !== selectedAnnotationId);
      selectedAnnotationId = null;
      renderAnnotations();
    }

    function selectAnnotation(id) {
      selectedAnnotationId = id;
      const item = annotations.find(a => a.id === id);
      if (item) {
        if (item.strokeColor) {
          currentStyle.strokeColor = item.strokeColor;
        }
        if (item.strokeWidth) {
          currentStyle.strokeWidth = item.strokeWidth;
        }
        if (item.fillColor !== undefined) {
          currentStyle.fillColor = item.fillColor;
        }
        if (item.fontSize) {
          currentStyle.fontSize = item.fontSize;
          if (fontSizeSelect) fontSizeSelect.value = item.fontSize;
        }
        if (item.fontWeight) {
          currentStyle.fontWeight = item.fontWeight;
          if (btnFontBold) btnFontBold.classList.toggle('active', item.fontWeight === 'bold');
        }
        updateColorPreviews();
        updateStrokeWidthUI();
        persistCurrentStyle();
      }
      renderAnnotations();
    }

    function escapeXml(unsafe) {
      return (unsafe || '').replace(/[<>&'"]/g, c => {
        if (c === '<') return '&lt;';
        if (c === '>') return '&gt;';
        if (c === '&') return '&amp;';
        if (c === '"') return '&quot;';
        return '&apos;';
      });
    }

    function getArrowHeadPolygon(x1, y1, x2, y2, strokeWidth) {
      const headLen = Math.max(16, strokeWidth * 3.8);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const p1x = x2 - headLen * Math.cos(angle - Math.PI / 6);
      const p1y = y2 - headLen * Math.sin(angle - Math.PI / 6);
      const p2x = x2 - headLen * Math.cos(angle + Math.PI / 6);
      const p2y = y2 - headLen * Math.sin(angle + Math.PI / 6);
      return x2 + ',' + y2 + ' ' + p1x + ',' + p1y + ' ' + p2x + ',' + p2y;
    }

    function renderAnnotations() {
      if (!img.naturalWidth || !img.naturalHeight) return;
      annotationsSvg.setAttribute('viewBox', '0 0 ' + img.naturalWidth + ' ' + img.naturalHeight);

      // 1. Draw annotation shapes
      let shapesHtml = '';
      for (const item of annotations) {
        const stroke = item.strokeColor === 'transparent' ? 'none' : item.strokeColor;
        const fill = item.fillColor === 'transparent' ? 'none' : item.fillColor;
        const sw = item.strokeWidth;

        if (item.type === 'rect') {
          shapesHtml += '<rect class="annotation-item" x="' + item.x + '" y="' + item.y + '" width="' + item.width + '" height="' + item.height + '" stroke="' + stroke + '" stroke-width="' + sw + '" fill="' + fill + '" data-id="' + item.id + '" />';
        } else if (item.type === 'rounded-rect') {
          const r = item.radius || 16;
          shapesHtml += '<rect class="annotation-item" x="' + item.x + '" y="' + item.y + '" width="' + item.width + '" height="' + item.height + '" rx="' + r + '" ry="' + r + '" stroke="' + stroke + '" stroke-width="' + sw + '" fill="' + fill + '" data-id="' + item.id + '" />';
        } else if (item.type === 'ellipse') {
          const rx = Math.abs(item.width / 2);
          const ry = Math.abs(item.height / 2);
          const cx = item.x + rx;
          const cy = item.y + ry;
          shapesHtml += '<ellipse class="annotation-item" cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" stroke="' + stroke + '" stroke-width="' + sw + '" fill="' + fill + '" data-id="' + item.id + '" />';
        } else if (item.type === 'line') {
          shapesHtml += '<line class="annotation-item" x1="' + item.x1 + '" y1="' + item.y1 + '" x2="' + item.x2 + '" y2="' + item.y2 + '" stroke="' + stroke + '" stroke-width="' + sw + '" stroke-linecap="round" data-id="' + item.id + '" />';
        } else if (item.type === 'arrow') {
          const arrowHead = getArrowHeadPolygon(item.x1, item.y1, item.x2, item.y2, sw);
          shapesHtml += '<g class="annotation-item" data-id="' + item.id + '">' +
            '<line x1="' + item.x1 + '" y1="' + item.y1 + '" x2="' + item.x2 + '" y2="' + item.y2 + '" stroke="' + stroke + '" stroke-width="' + sw + '" stroke-linecap="round" />' +
            '<polygon points="' + arrowHead + '" fill="' + stroke + '" />' +
            '</g>';
        } else if (item.type === 'text') {
          if (editingTextItem && editingTextItem.id === item.id) {
            // While actively editing, do not render background SVG text to prevent duplicate text displays
            continue;
          }
          const lines = (item.text || '').split(String.fromCharCode(10));
          const lineHeight = item.fontSize * 1.25;
          let tspans = '';
          lines.forEach((line, idx) => {
            tspans += '<tspan x="' + item.x + '" dy="' + (idx === 0 ? 0 : lineHeight) + '">' + escapeXml(line || ' ') + '</tspan>';
          });
          shapesHtml += '<text id="' + item.id + '" class="annotation-item" x="' + item.x + '" y="' + (item.y + item.fontSize * 0.85) + '" fill="' + (item.color || stroke) + '" font-size="' + item.fontSize + '" font-weight="' + item.fontWeight + '" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" data-id="' + item.id + '">' + tspans + '</text>';
        }
      }
      annotationsGroup.innerHTML = shapesHtml;

      // 2. Draw selection bounding box and handles
      renderSelectionBox();
      if (btnDeleteSelected) btnDeleteSelected.disabled = !selectedAnnotationId;
    }

    function renderSelectionBox() {
      if (!selectedAnnotationId) {
        selectionGroup.innerHTML = '';
        return;
      }
      const item = annotations.find(a => a.id === selectedAnnotationId);
      if (!item) {
        selectionGroup.innerHTML = '';
        return;
      }

      const stageW = img.clientWidth || 1;
      const scale = img.naturalWidth / stageW;
      const handleR = Math.max(5, 5 * scale * 0.8);
      let html = '';

      if (item.type === 'rect' || item.type === 'rounded-rect' || item.type === 'ellipse') {
        const x = item.x, y = item.y, w = item.width, h = item.height;
        html += '<rect class="annotation-selection-box" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" />';
        const handles = [
          { type: 'nw', cx: x, cy: y, cursor: 'nwse-resize' },
          { type: 'n',  cx: x + w / 2, cy: y, cursor: 'ns-resize' },
          { type: 'ne', cx: x + w, cy: y, cursor: 'nesw-resize' },
          { type: 'e',  cx: x + w, cy: y + h / 2, cursor: 'ew-resize' },
          { type: 'se', cx: x + w, cy: y + h, cursor: 'nwse-resize' },
          { type: 's',  cx: x + w / 2, cy: y + h, cursor: 'ns-resize' },
          { type: 'sw', cx: x, cy: y + h, cursor: 'nesw-resize' },
          { type: 'w',  cx: x, cy: y + h / 2, cursor: 'ew-resize' }
        ];
        for (const hnd of handles) {
          html += '<circle class="annotation-handle" cx="' + hnd.cx + '" cy="' + hnd.cy + '" r="' + handleR + '" style="cursor: ' + hnd.cursor + ';" data-handle="' + hnd.type + '" />';
        }
      } else if (item.type === 'line' || item.type === 'arrow') {
        html += '<circle class="annotation-handle" cx="' + item.x1 + '" cy="' + item.y1 + '" r="' + handleR + '" style="cursor: crosshair;" data-handle="p1" />';
        html += '<circle class="annotation-handle" cx="' + item.x2 + '" cy="' + item.y2 + '" r="' + handleR + '" style="cursor: crosshair;" data-handle="p2" />';
      } else if (item.type === 'text') {
        if (editingTextItem && editingTextItem.id === item.id) {
          // While actively editing, inline editor already provides the focus frame
          selectionGroup.innerHTML = '';
          return;
        }
        const el = document.getElementById(item.id);
        let bbox = { x: item.x, y: item.y, width: 80, height: item.fontSize };
        if (el && el.getBBox) {
          try { bbox = el.getBBox(); } catch(e) {}
        }
        const pad = 4;
        const bx = bbox.x - pad, by = bbox.y - pad, bw = bbox.width + pad * 2, bh = bbox.height + pad * 2;
        html += '<rect class="annotation-selection-box" x="' + bx + '" y="' + by + '" width="' + bw + '" height="' + bh + '" />';
        html += '<circle class="annotation-handle" cx="' + (bx + bw) + '" cy="' + (by + bh) + '" r="' + handleR + '" style="cursor: nwse-resize;" data-handle="se" />';
      }
      selectionGroup.innerHTML = html;
    }

    // --- Inline Text Editor ---
    let editingTextItem = null;

    function startInlineTextEdit(item) {
      if (!inlineTextEditor) return;
      editingTextItem = item;
      renderAnnotations(); // Temporarily hide background SVG text
      const stageW = img.clientWidth || 1;
      const scale = stageW / img.naturalWidth;

      const leftPx = item.x * scale;
      const topPx = item.y * scale;
      const fontSizePx = Math.max(12, item.fontSize * scale);

      inlineTextEditor.style.left = leftPx + 'px';
      inlineTextEditor.style.top = topPx + 'px';
      inlineTextEditor.style.fontSize = fontSizePx + 'px';
      inlineTextEditor.style.fontWeight = item.fontWeight || 'bold';
      inlineTextEditor.style.color = item.color || item.strokeColor || '#ff3b30';
      inlineTextEditor.value = item.text || '';
      inlineTextEditor.style.display = 'block';

      const textLen = (item.text || '').length;
      const initialW = Math.max(48, Math.round((textLen + 1) * fontSizePx * 0.9));
      inlineTextEditor.style.width = initialW + 'px';
      inlineTextEditor.style.minWidth = '40px';
      inlineTextEditor.style.height = (fontSizePx * 1.35) + 'px';
      inlineTextEditor.style.minHeight = (fontSizePx * 1.35) + 'px';

      setTimeout(() => {
        inlineTextEditor.focus();
        inlineTextEditor.select();
      }, 20);
    }

    function endInlineTextEdit() {
      if (!editingTextItem || !inlineTextEditor) return;
      const newText = inlineTextEditor.value.trim();
      if (newText) {
        editingTextItem.text = newText;
        pushHistory();
      } else {
        // If empty, delete
        annotations = annotations.filter(a => a.id !== editingTextItem.id);
        selectedAnnotationId = null;
      }
      inlineTextEditor.style.display = 'none';
      editingTextItem = null;
      renderAnnotations();
    }

    if (inlineTextEditor) {
      inlineTextEditor.addEventListener('blur', () => endInlineTextEdit());
      inlineTextEditor.addEventListener('input', () => {
        inlineTextEditor.style.width = 'auto';
        inlineTextEditor.style.width = Math.max(48, inlineTextEditor.scrollWidth + 10) + 'px';
        inlineTextEditor.style.height = 'auto';
        inlineTextEditor.style.height = inlineTextEditor.scrollHeight + 'px';
      });
      inlineTextEditor.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          endInlineTextEdit();
        } else if (e.key === 'Escape') {
          inlineTextEditor.style.display = 'none';
          editingTextItem = null;
        }
      });
    }

    function initImageAndCrop() {
      if (!img.naturalWidth || !img.naturalHeight) {
        requestAnimationFrame(initImageAndCrop);
        return;
      }

      const t = getT();
      originalSizeBadge.innerText = t.originalBadge + img.naturalWidth + ' x ' + img.naturalHeight;

      if (document.body.classList.contains('mode-readonly')) {
        cropSizeBadge.innerText = '';
        buildColorPalette();
        resetZoom();
        isImageInitialized = true;
        return;
      }

      const stageW = img.clientWidth;
      const stageH = img.clientHeight;
      if (stageW === 0 || stageH === 0) {
        requestAnimationFrame(initImageAndCrop);
        return;
      }

      resetZoom();
      resetCrop();
      buildColorPalette();
      renderAnnotations();
      undoStack = [JSON.stringify(createSnapshot())];
      redoStack = [];
      updateUndoRedoButtons();
      cropBox.style.opacity = '1';
      isImageInitialized = true;
      window.focus();
    }

    img.addEventListener('load', () => {
      initImageAndCrop();
    });

    window.addEventListener('load', () => {
      initImageAndCrop();
    });

    if (img.complete && img.naturalWidth > 0) {
      requestAnimationFrame(initImageAndCrop);
    } else {
      requestAnimationFrame(initImageAndCrop);
    }

    try {
      const RO = window.ResizeObserver || (typeof ResizeObserver !== 'undefined' ? ResizeObserver : null);
      if (RO) {
        const ro = new RO(() => {
          if (img.naturalWidth > 0 && img.clientWidth > 0) {
            if (!isImageInitialized || crop.width === 0 || crop.height === 0 || cropBox.style.opacity === '0') {
              initImageAndCrop();
            } else {
              updateUI();
              renderAnnotations();
            }
          }
        });
        ro.observe(img);
      }
    } catch (e) {
      console.warn('ResizeObserver setup failed:', e);
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'saved' || msg.command === 'updated') {
        img.src = msg.imageSrc;
        saveBtn.disabled = false;
        saveBtn.innerText = getT().saveBtn;
        annotations = [];
        selectedAnnotationId = null;
        if (msg.canUndoSave !== undefined) {
          canUndoSave = Boolean(msg.canUndoSave);
        } else {
          canUndoSave = true;
        }
        canRedoSave = false;
        currentRatio = 'free';
        updateRatioButtons();
        resetZoom();
        requestAnimationFrame(() => {
          resetCrop();
          renderAnnotations();
          undoStack = [JSON.stringify(createSnapshot())];
          redoStack = [];
          updateUndoRedoButtons();
          window.focus();
        });
        showToast(getT().savedUndoToast || '💾 保存しました (Cmd+Z で保存前に戻せます)');
      } else if (msg.command === 'saveUndone') {
        img.src = msg.imageSrc;
        saveBtn.disabled = false;
        saveBtn.innerText = getT().saveBtn;
        annotations = [];
        selectedAnnotationId = null;
        canUndoSave = Boolean(msg.canUndoSave);
        canRedoSave = true;
        currentRatio = 'free';
        updateRatioButtons();
        resetZoom();
        requestAnimationFrame(() => {
          resetCrop();
          renderAnnotations();
          undoStack = [JSON.stringify(createSnapshot())];
          redoStack = [];
          updateUndoRedoButtons();
          window.focus();
        });
        showToast(getT().saveUndoneToast || '↺ 保存前の画像に復元しました');
      } else if (msg.command === 'saveRedone') {
        img.src = msg.imageSrc;
        saveBtn.disabled = false;
        saveBtn.innerText = getT().saveBtn;
        annotations = [];
        selectedAnnotationId = null;
        canUndoSave = true;
        canRedoSave = false;
        currentRatio = 'free';
        updateRatioButtons();
        resetZoom();
        requestAnimationFrame(() => {
          resetCrop();
          renderAnnotations();
          undoStack = [JSON.stringify(createSnapshot())];
          redoStack = [];
          updateUndoRedoButtons();
          window.focus();
        });
        showToast(getT().redoToast || '↷ やり直しました');
      }
    });

    function resetCrop() {
      const stageW = img.clientWidth;
      const stageH = img.clientHeight;
      if (stageW === 0 || stageH === 0) return;

      cropShape = 'rect';
      cornerRadius = 0;
      if (cropRadiusInput) cropRadiusInput.value = 0;
      if (btnShapeCircle) btnShapeCircle.classList.remove('active');

      if (currentRatio === 'free') {
        crop = {
          left: 0,
          top: 0,
          width: stageW,
          height: stageH
        };
      } else {
        let targetAspect = 1;
        if (currentRatio === '1:1') targetAspect = 1;
        else if (currentRatio === '16:9') targetAspect = 16 / 9;
        else if (currentRatio === '4:3') targetAspect = 4 / 3;

        let w = stageW;
        let h = w / targetAspect;
        if (h > stageH) {
          h = stageH;
          w = h * targetAspect;
        }
        crop = {
          left: (stageW - w) / 2,
          top: (stageH - h) / 2,
          width: w,
          height: h
        };
      }
      updateUI();
    }

    function updateRatioButtons() {
      document.getElementById('ratioFree').classList.toggle('active', currentRatio === 'free');
      document.getElementById('ratioSquare').classList.toggle('active', currentRatio === '1:1');
      document.getElementById('ratioPadSquare').classList.toggle('active', currentRatio === '1:1-pad');
      document.getElementById('ratio16_9').classList.toggle('active', currentRatio === '16:9');
      document.getElementById('ratio4_3').classList.toggle('active', currentRatio === '4:3');
    }

    function toggleShapeCircle() {
      pushHistory();
      if (cropShape === 'circle') {
        cropShape = 'rect';
        if (btnShapeCircle) btnShapeCircle.classList.remove('active');
      } else {
        cropShape = 'circle';
        cornerRadius = 0;
        if (cropRadiusInput) cropRadiusInput.value = 0;
        if (btnShapeCircle) btnShapeCircle.classList.add('active');
        setRatio('1:1');
      }
      updateUI();
    }

    function stepRadius(delta, e) {
      const mult = (e && e.shiftKey) ? 5 : 1;
      if (!cropRadiusInput) return;
      const currentVal = parseInt(cropRadiusInput.value, 10) || 0;
      const nextVal = Math.max(0, Math.min(1000, currentVal + delta * mult));
      cropRadiusInput.value = nextVal;
      onRadiusInputChange();
    }

    function onRadiusInputChange() {
      pushHistory();
      let r = parseInt(cropRadiusInput.value, 10);
      if (isNaN(r) || r < 0) r = 0;
      cropRadiusInput.value = r;
      cornerRadius = r;
      if (r > 0) {
        cropShape = 'rect';
        if (btnShapeCircle) btnShapeCircle.classList.remove('active');
      }
      updateUI();
    }

    function rotateImage(deg) {
      pushHistory();
      const canvas = document.createElement('canvas');
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return;

      // 90度または-90度回転時は幅と高さが入れ替わる
      canvas.width = h;
      canvas.height = w;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.drawImage(img, -w / 2, -h / 2);

      const rotatedDataUrl = canvas.toDataURL('image/png', 1.0);
      img.src = rotatedDataUrl;
    }

    function padToSquare() {
      pushHistory();
      const stageW = img.clientWidth;
      const stageH = img.clientHeight;
      if (stageW === 0 || stageH === 0) return;

      currentRatio = '1:1-pad';
      updateRatioButtons();

      const maxSide = Math.max(stageW, stageH);
      const left = (stageW - maxSide) / 2;
      const top = (stageH - maxSide) / 2;

      crop = {
        left: left,
        top: top,
        width: maxSide,
        height: maxSide
      };
      updateUI();
    }

    function setRatio(ratio) {
      pushHistory();
      currentRatio = ratio;
      updateRatioButtons();

      if (ratio !== '1:1' && ratio !== '1:1-pad') {
        if (cropShape === 'circle') {
          cropShape = 'rect';
          if (btnShapeCircle) btnShapeCircle.classList.remove('active');
        }
      }

      if (ratio !== 'free') {
        let targetAspect = 1;
        if (ratio === '1:1') targetAspect = 1;
        else if (ratio === '16:9') targetAspect = 16 / 9;
        else if (ratio === '4:3') targetAspect = 4 / 3;

        let w = crop.width;
        let h = crop.height;
        const currentAspect = w / h;

        if (currentAspect > targetAspect) {
          // 現在の枠が目標より横長: 高さを基準に幅を合わせる
          w = h * targetAspect;
        } else {
          // 現在の枠が目標より縦長: 幅を基準に高さを合わせる
          h = w / targetAspect;
        }

        let left = crop.left + (crop.width - w) / 2;
        let top = crop.top + (crop.height - h) / 2;

        crop = { left, top, width: w, height: h };
        updateUI();
      }
    }

    function toggleRatioLock() {
      isRatioLocked = !isRatioLocked;
      if (isRatioLocked) {
        lockedRatioValue = crop.width / crop.height;
        ratioLockBtn.innerText = '🔒';
        ratioLockBtn.classList.add('locked');
      } else {
        ratioLockBtn.innerText = '🔓';
        ratioLockBtn.classList.remove('locked');
      }
    }

    function stepDimension(dim, delta, e) {
      pushHistory();
      const mult = (e && e.shiftKey) ? 10 : 1;
      const input = dim === 'w' ? cropInputW : cropInputH;
      if (!input) return;
      const currentVal = parseInt(input.value, 10) || 1;
      const nextVal = Math.max(1, currentVal + delta * mult);
      input.value = nextVal;

      if (isRatioLocked && lockedRatioValue) {
        if (dim === 'w') {
          cropInputH.value = Math.max(1, Math.round(nextVal / lockedRatioValue));
        } else {
          cropInputW.value = Math.max(1, Math.round(nextVal * lockedRatioValue));
        }
      }
      onCropInputChange();
    }

    function onCropInputChange() {
      const stageW = img.clientWidth;
      const stageH = img.clientHeight;
      const scale = img.naturalWidth / stageW;

      let targetNaturalW = parseInt(cropInputW.value, 10);
      let targetNaturalH = parseInt(cropInputH.value, 10);

      if (isNaN(targetNaturalW) || targetNaturalW < 1) targetNaturalW = 1;
      if (isNaN(targetNaturalH) || targetNaturalH < 1) targetNaturalH = 1;

      // Allow expanding beyond natural dimensions up to 10000px
      targetNaturalW = Math.min(10000, targetNaturalW);
      targetNaturalH = Math.min(10000, targetNaturalH);

      let newW = targetNaturalW / scale;
      let newH = targetNaturalH / scale;

      // Keep center of current crop
      const centerX = crop.left + crop.width / 2;
      const centerY = crop.top + crop.height / 2;

      let newL = centerX - newW / 2;
      let newT = centerY - newH / 2;

      crop = { left: newL, top: newT, width: newW, height: newH };
      updateUI();
    }

    function updateUI() {
      const stageW = img.clientWidth;
      const stageH = img.clientHeight;
      if (stageW === 0 || stageH === 0) return;

      cropBox.style.opacity = '1';
      cropBox.style.left = crop.left + 'px';
      cropBox.style.top = crop.top + 'px';
      cropBox.style.width = crop.width + 'px';
      cropBox.style.height = crop.height + 'px';

      const scale = img.naturalWidth / stageW;
      const actualW = Math.round(crop.width * scale);
      const actualH = Math.round(crop.height * scale);
      const t = getT();
      cropSizeBadge.innerText = t.cropBadge + actualW + ' x ' + actualH;

      // Update borderRadius for circle or rounded corners
      if (cropShape === 'circle') {
        cropBox.style.borderRadius = '50%';
      } else if (cornerRadius > 0) {
        cropBox.style.borderRadius = (cornerRadius / scale) + 'px';
      } else {
        cropBox.style.borderRadius = '0';
      }

      // Update input fields without stealing focus
      if (cropRadiusInput && document.activeElement !== cropRadiusInput) {
        cropRadiusInput.value = cornerRadius;
      }
      if (document.activeElement !== cropInputW) {
        cropInputW.value = actualW;
      }
      if (document.activeElement !== cropInputH) {
        cropInputH.value = actualH;
      }
    }

    // Drag handlers
    window.addEventListener('mousedown', (e) => {
      // Eyedropper Fallback Mode Click
      if (isEyedropperActive) {
        e.preventDefault();
        e.stopPropagation();
        const hex = sampleColorFromImage(e.clientX, e.clientY);
        cancelEyedropperFallback();
        if (hex) {
          applyPickedColor(hex);
        }
        return;
      }

      if (e.target.closest('.modal-content') || e.target.closest('.mac-color-popover') || e.target.closest('.inline-text-editor')) return;

      // Close open popovers if clicked outside
      if (!e.target.closest('.btn-color-select') && !e.target.closest('.mac-color-popover')) {
        closeAllPopovers();
      }

      if (e.target.closest('.toolbar') || e.target.closest('.sidebar-panel') || e.target.closest('.footer-hint')) return;

      // 1. Check annotation handle drag
      const annoHandle = e.target.closest('.annotation-handle');
      if (annoHandle) {
        isAnnoDragging = true;
        annoDragMode = annoHandle.dataset.handle;
        annoStartX = e.clientX;
        annoStartY = e.clientY;
        const targetItem = annotations.find(a => a.id === selectedAnnotationId);
        if (targetItem) {
          annoStartObj = JSON.parse(JSON.stringify(targetItem));
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // 2. Check annotation item click / drag
      const annoItemEl = e.target.closest('.annotation-item');
      if (annoItemEl) {
        const id = annoItemEl.dataset.id;
        selectAnnotation(id);
        isAnnoDragging = true;
        annoDragMode = 'move';
        annoStartX = e.clientX;
        annoStartY = e.clientY;
        const targetItem = annotations.find(a => a.id === id);
        if (targetItem) {
          annoStartObj = JSON.parse(JSON.stringify(targetItem));
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // If clicked elsewhere, deselect annotation
      if (selectedAnnotationId && !e.target.closest('.annotation-handle')) {
        selectedAnnotationId = null;
        renderAnnotations();
      }

      // 3. Check crop handles or crop box
      const handle = e.target.closest('.handle');
      if (handle) {
        isDragging = true;
        dragMode = handle.dataset.handle;
      } else if (e.target.closest('.crop-box')) {
        isDragging = true;
        dragMode = 'box';
      } else {
        return;
      }

      // Ensure focus is on window and remove focus from any inputs
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      window.focus();

      startX = e.clientX;
      startY = e.clientY;
      startCrop = { ...crop };
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (isAnnoDragging && annoStartObj) {
        const stageW = img.clientWidth || 1;
        const scale = img.naturalWidth / stageW;
        const dx = Math.round((e.clientX - annoStartX) / currentZoom * scale);
        const dy = Math.round((e.clientY - annoStartY) / currentZoom * scale);
        const item = annotations.find(a => a.id === selectedAnnotationId);
        if (!item) return;

        if (annoDragMode === 'move') {
          if (item.type === 'line' || item.type === 'arrow') {
            item.x1 = annoStartObj.x1 + dx;
            item.y1 = annoStartObj.y1 + dy;
            item.x2 = annoStartObj.x2 + dx;
            item.y2 = annoStartObj.y2 + dy;
          } else {
            item.x = annoStartObj.x + dx;
            item.y = annoStartObj.y + dy;
          }
        } else if (annoDragMode === 'p1') {
          item.x1 = annoStartObj.x1 + dx;
          item.y1 = annoStartObj.y1 + dy;
        } else if (annoDragMode === 'p2') {
          item.x2 = annoStartObj.x2 + dx;
          item.y2 = annoStartObj.y2 + dy;
        } else if (item.type === 'text') {
          if (annoDragMode === 'se') {
            const fontScale = Math.max(0.4, 1 + dx / 150);
            item.fontSize = Math.round(Math.max(12, Math.min(200, annoStartObj.fontSize * fontScale)));
          }
        } else {
          // Bounding box resizing
          let { x, y, width, height } = annoStartObj;
          const minW = 10, minH = 10;
          if (annoDragMode.includes('w')) {
            const newW = width - dx;
            if (newW >= minW) {
              item.x = x + dx;
              item.width = newW;
            }
          }
          if (annoDragMode.includes('e')) {
            item.width = Math.max(minW, width + dx);
          }
          if (annoDragMode.includes('n')) {
            const newH = height - dy;
            if (newH >= minH) {
              item.y = y + dy;
              item.height = newH;
            }
          }
          if (annoDragMode.includes('s')) {
            item.height = Math.max(minH, height + dy);
          }
        }
        renderAnnotations();
        return;
      }

      if (!isDragging) return;

      const dx = (e.clientX - startX) / currentZoom;
      const dy = (e.clientY - startY) / currentZoom;
      const stageW = img.clientWidth;
      const stageH = img.clientHeight;
      const minSize = 20;

      const maxExpand = Math.max(stageW, stageH) * 3;
      const minCoordX = -maxExpand;
      const maxCoordX = stageW + maxExpand;
      const minCoordY = -maxExpand;
      const maxCoordY = stageH + maxExpand;

      let { left, top, width, height } = startCrop;

      if (dragMode === 'box') {
        left = Math.max(minCoordX, Math.min(maxCoordX - width, left + dx));
        top = Math.max(minCoordY, Math.min(maxCoordY - height, top + dy));
      } else {
        let activeAspect = null;
        if (currentRatio === '1:1' || currentRatio === '1:1-pad') activeAspect = 1;
        else if (currentRatio === '16:9') activeAspect = 16 / 9;
        else if (currentRatio === '4:3') activeAspect = 4 / 3;
        else if (isRatioLocked) activeAspect = lockedRatioValue;

        if (activeAspect === null) {
          // Free mode: allow freely expanding outside image or shrinking along any side
          let newL = left;
          let newR = left + width;
          let newT = top;
          let newB = top + height;

          if (dragMode.includes('l')) newL = Math.min(newR - minSize, Math.max(minCoordX, left + dx));
          if (dragMode.includes('r')) newR = Math.max(newL + minSize, Math.min(maxCoordX, left + width + dx));
          if (dragMode.includes('t')) newT = Math.min(newB - minSize, Math.max(minCoordY, top + dy));
          if (dragMode.includes('b')) newB = Math.max(newT + minSize, Math.min(maxCoordY, top + height + dy));

          left = newL;
          top = newT;
          width = newR - newL;
          height = newB - newT;
        } else {
          // Fixed aspect ratio mode: strictly maintain aspect ratio while smoothly expanding outside or shrinking
          let newL = left;
          let newR = left + width;
          let newT = top;
          let newB = top + height;

          if (dragMode === 't' || dragMode === 'b') {
            const midX = left + width / 2;
            const maxHalfW = Math.min(midX - minCoordX, maxCoordX - midX);
            const maxW = maxHalfW * 2;
            let h;
            if (dragMode === 't') {
              const anchorB = top + height;
              const maxH = anchorB - minCoordY;
              const maxAllowedH = Math.min(maxH, maxW / activeAspect);
              h = Math.max(minSize, Math.min(maxAllowedH, height - dy));
              newT = anchorB - h;
              newB = anchorB;
            } else {
              const anchorT = top;
              const maxH = maxCoordY - anchorT;
              const maxAllowedH = Math.min(maxH, maxW / activeAspect);
              h = Math.max(minSize, Math.min(maxAllowedH, height + dy));
              newT = anchorT;
              newB = anchorT + h;
            }
            const w = h * activeAspect;
            newL = midX - w / 2;
            newR = midX + w / 2;
          } else if (dragMode === 'l' || dragMode === 'r') {
            const midY = top + height / 2;
            const maxHalfH = Math.min(midY - minCoordY, maxCoordY - midY);
            const maxH = maxHalfH * 2;
            let w;
            if (dragMode === 'l') {
              const anchorR = left + width;
              const maxW = anchorR - minCoordX;
              const maxAllowedW = Math.min(maxW, maxH * activeAspect);
              w = Math.max(minSize, Math.min(maxAllowedW, width - dx));
              newL = anchorR - w;
              newR = anchorR;
            } else {
              const anchorL = left;
              const maxW = maxCoordX - anchorL;
              const maxAllowedW = Math.min(maxW, maxH * activeAspect);
              w = Math.max(minSize, Math.min(maxAllowedW, width + dx));
              newL = anchorL;
              newR = anchorL + w;
            }
            const h = w / activeAspect;
            newT = midY - h / 2;
            newB = midY + h / 2;
          } else {
            // Corner handles: tl, tr, bl, br
            let anchorX, anchorY, rawW, rawH, maxW, maxH;
            if (dragMode === 'br') {
              anchorX = left;
              anchorY = top;
              rawW = width + dx;
              rawH = height + dy;
              maxW = maxCoordX - anchorX;
              maxH = maxCoordY - anchorY;
            } else if (dragMode === 'bl') {
              anchorX = left + width;
              anchorY = top;
              rawW = width - dx;
              rawH = height + dy;
              maxW = anchorX - minCoordX;
              maxH = maxCoordY - anchorY;
            } else if (dragMode === 'tr') {
              anchorX = left;
              anchorY = top + height;
              rawW = width + dx;
              rawH = height - dy;
              maxW = maxCoordX - anchorX;
              maxH = anchorY - minCoordY;
            } else if (dragMode === 'tl') {
              anchorX = left + width;
              anchorY = top + height;
              rawW = width - dx;
              rawH = height - dy;
              maxW = anchorX - minCoordX;
              maxH = anchorY - minCoordY;
            }

            let chosenW;
            if (Math.abs(rawW - width) > Math.abs(rawH - height) * activeAspect) {
              chosenW = rawW;
            } else {
              chosenW = rawH * activeAspect;
            }

            const maxAllowedW = Math.min(maxW, maxH * activeAspect);
            const w = Math.max(minSize, Math.min(maxAllowedW, chosenW));
            const h = w / activeAspect;

            if (dragMode === 'br') {
              newL = anchorX;
              newR = anchorX + w;
              newT = anchorY;
              newB = anchorY + h;
            } else if (dragMode === 'bl') {
              newL = anchorX - w;
              newR = anchorX;
              newT = anchorY;
              newB = anchorY + h;
            } else if (dragMode === 'tr') {
              newL = anchorX;
              newR = anchorX + w;
              newT = anchorY - h;
              newB = anchorY;
            } else if (dragMode === 'tl') {
              newL = anchorX - w;
              newR = anchorX;
              newT = anchorY - h;
              newB = anchorY;
            }
          }

          left = newL;
          top = newT;
          width = newR - newL;
          height = newB - newT;
        }
      }

      crop = { left, top, width, height };
      updateUI();
    });

    window.addEventListener('mouseup', () => {
      if (isAnnoDragging) {
        isAnnoDragging = false;
        annoDragMode = null;
        annoStartObj = null;
        pushHistory();
      }
      if (isDragging) {
        window.focus();
        pushHistory();
      }
      isDragging = false;
      dragMode = null;
    });

    // Double click: edit text if text item, or maximize crop box to full
    window.addEventListener('dblclick', (e) => {
      if (e.target.closest('.modal-content') || e.target.closest('.toolbar') || e.target.closest('.footer-hint') || e.target.closest('.ctx-menu')) return;

      const annoEl = e.target.closest('.annotation-item');
      if (annoEl) {
        const id = annoEl.dataset.id;
        const item = annotations.find(a => a.id === id);
        if (item && item.type === 'text') {
          startInlineTextEdit(item);
          return;
        }
      }

      if (e.target.closest('.crop-box') || e.target.closest('.crop-mask') || e.target.closest('.stage') || e.target.closest('#cropImage')) {
        resetCrop();
      }
    });

    // Shortcuts
    window.addEventListener('keydown', (e) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      // Undo / Redo shortcuts
      if (isCmdOrCtrl && e.key.toLowerCase() === 'z') {
        if (!['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
          e.preventDefault();
          if (e.shiftKey) {
            redo();
          } else {
            undo();
          }
          return;
        }
      }
      if (isCmdOrCtrl && e.key.toLowerCase() === 'y') {
        if (!['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
          e.preventDefault();
          redo();
          return;
        }
      }

      // Duplicate shortcut (Cmd+D)
      if (isCmdOrCtrl && e.key.toLowerCase() === 'd') {
        if (selectedAnnotationId && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
          e.preventDefault();
          const orig = annotations.find(a => a.id === selectedAnnotationId);
          if (orig) {
            pushHistory();
            const copy = JSON.parse(JSON.stringify(orig));
            copy.id = 'anno_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
            const offset = 20;
            if (copy.type === 'line' || copy.type === 'arrow') {
              copy.x1 += offset; copy.y1 += offset;
              copy.x2 += offset; copy.y2 += offset;
            } else {
              copy.x += offset; copy.y += offset;
            }
            annotations.push(copy);
            selectAnnotation(copy.id);
            renderAnnotations();
          }
          return;
        }
      }

      // Delete / Backspace to remove selected annotation
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedAnnotationId && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
          e.preventDefault();
          deleteSelected();
          return;
        }
      }

      // Arrow keys to nudge selected annotation
      if (selectedAnnotationId && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        if (!['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 2;
          const item = annotations.find(a => a.id === selectedAnnotationId);
          if (item) {
            let dx = 0, dy = 0;
            if (e.key === 'ArrowLeft') dx = -step;
            if (e.key === 'ArrowRight') dx = step;
            if (e.key === 'ArrowUp') dy = -step;
            if (e.key === 'ArrowDown') dy = step;

            if (item.type === 'line' || item.type === 'arrow') {
              item.x1 += dx; item.y1 += dy;
              item.x2 += dx; item.y2 += dy;
            } else {
              item.x += dx; item.y += dy;
            }
            renderAnnotations();
          }
          return;
        }
      }

      // Save and Copy shortcuts should always work, even if an input was focused
      if (isCmdOrCtrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
          document.activeElement.blur();
        }
        saveAndOverwrite();
        return;
      }
      if (isCmdOrCtrl && e.key.toLowerCase() === 'c') {
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
          return;
        }
        e.preventDefault();
        copyCroppedImage();
        return;
      }

      // Don't trigger single-letter shortcuts (1, F, P, R, etc.) if focus is inside an input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        if (e.key === 'Escape') {
          document.activeElement.blur();
        }
        return;
      }

      if (isCmdOrCtrl && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomChange(0.1);
      } else if (isCmdOrCtrl && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        zoomChange(-0.1);
      } else if (isCmdOrCtrl && e.key === '0') {
        e.preventDefault();
        resetZoom();
      } else if (e.key === 'Escape') {
        if (isEyedropperActive) {
          cancelEyedropperFallback();
          return;
        }
        closeAllPopovers();
        closeContextMenu();
        if (settingsModal && settingsModal.classList.contains('open')) {
          closeSettingsModal();
        } else if (resizeModal && resizeModal.classList.contains('open')) {
          closeResizeModal();
        } else {
          cancel();
        }
      } else if (e.key === '1') {
        setRatio('1:1');
      } else if (e.key.toLowerCase() === 'p') {
        padToSquare();
      } else if (e.key.toLowerCase() === 'f') {
        setRatio('free');
      } else if (e.key.toLowerCase() === 'r') {
        resetCrop();
      } else if (e.key === '[') {
        rotateImage(-90);
      } else if (e.key === ']') {
        rotateImage(90);
      }
    });

    window.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        zoomChange(delta);
      }
    }, { passive: false });

    // Context Menu & Copy Functions
    const contextMenu = document.getElementById('customContextMenu');
    let toastTimeout = null;

    function showToast(msg) {
      const toast = document.getElementById('toast');
      if (!toast) return;
      toast.innerText = msg;
      toast.classList.add('show');
      if (toastTimeout) clearTimeout(toastTimeout);
      toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
      }, 2000);
    }

    function closeContextMenu() {
      if (contextMenu && contextMenu.classList.contains('open')) {
        contextMenu.classList.remove('open');
        contextMenu.style.display = 'none';
      }
    }

    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!contextMenu) return;

      contextMenu.style.display = 'block';
      const menuW = contextMenu.offsetWidth || 150;
      const menuH = contextMenu.offsetHeight || 42;

      let x = e.clientX;
      let y = e.clientY;
      if (x + menuW > window.innerWidth) x = Math.max(0, window.innerWidth - menuW - 8);
      if (y + menuH > window.innerHeight) y = Math.max(0, window.innerHeight - menuH - 8);

      contextMenu.style.left = x + 'px';
      contextMenu.style.top = y + 'px';
      contextMenu.classList.add('open');
    });

    window.addEventListener('click', (e) => {
      if (contextMenu && !contextMenu.contains(e.target)) {
        closeContextMenu();
      }
    });

    function getCroppedCanvas() {
      const stageW = img.clientWidth;
      const scale = img.naturalWidth / stageW;

      const naturalX = Math.round(crop.left * scale);
      const naturalY = Math.round(crop.top * scale);
      const naturalW = Math.round(crop.width * scale);
      const naturalH = Math.round(crop.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, naturalW);
      canvas.height = Math.max(1, naturalH);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Ensure transparent background (RGBA 0,0,0,0)
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Clip circle or rounded corners
      if (cropShape === 'circle') {
        ctx.beginPath();
        ctx.ellipse(
          canvas.width / 2,
          canvas.height / 2,
          canvas.width / 2,
          canvas.height / 2,
          0,
          0,
          Math.PI * 2
        );
        ctx.clip();
      } else if (cornerRadius > 0) {
        const r = Math.min(cornerRadius, canvas.width / 2, canvas.height / 2);
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(0, 0, canvas.width, canvas.height, r);
        } else {
          ctx.moveTo(r, 0);
          ctx.arcTo(canvas.width, 0, canvas.width, canvas.height, r);
          ctx.arcTo(canvas.width, canvas.height, 0, canvas.height, r);
          ctx.arcTo(0, canvas.height, 0, 0, r);
          ctx.arcTo(0, 0, canvas.width, 0, r);
          ctx.closePath();
        }
        ctx.clip();
      }

      // Draw original image relative to crop position
      // If crop is expanded outside (e.g. naturalX < 0), drawX becomes positive, creating transparent margins
      const drawX = -naturalX;
      const drawY = -naturalY;
      const drawW = img.naturalWidth;
      const drawH = img.naturalHeight;

      ctx.drawImage(img, drawX, drawY, drawW, drawH);

      // Draw annotations on top of cropped image
      ctx.save();
      ctx.translate(drawX, drawY);

      for (const item of annotations) {
        ctx.save();
        const stroke = item.strokeColor === 'transparent' ? null : item.strokeColor;
        const fill = item.fillColor === 'transparent' ? null : item.fillColor;
        ctx.lineWidth = item.strokeWidth;
        if (stroke) ctx.strokeStyle = stroke;
        if (fill) ctx.fillStyle = fill;

        if (item.type === 'rect') {
          if (fill) ctx.fillRect(item.x, item.y, item.width, item.height);
          if (stroke && item.strokeWidth > 0) ctx.strokeRect(item.x, item.y, item.width, item.height);
        } else if (item.type === 'rounded-rect') {
          const r = Math.min(item.radius || 16, Math.abs(item.width) / 2, Math.abs(item.height) / 2);
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(item.x, item.y, item.width, item.height, r);
          } else {
            ctx.moveTo(item.x + r, item.y);
            ctx.arcTo(item.x + item.width, item.y, item.x + item.width, item.y + item.height, r);
            ctx.arcTo(item.x + item.width, item.y + item.height, item.x, item.y + item.height, r);
            ctx.arcTo(item.x, item.y + item.height, item.x, item.y, r);
            ctx.arcTo(item.x, item.y, item.x + item.width, item.y, r);
            ctx.closePath();
          }
          if (fill) ctx.fill();
          if (stroke && item.strokeWidth > 0) ctx.stroke();
        } else if (item.type === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(
            item.x + item.width / 2,
            item.y + item.height / 2,
            Math.abs(item.width / 2),
            Math.abs(item.height / 2),
            0,
            0,
            Math.PI * 2
          );
          if (fill) ctx.fill();
          if (stroke && item.strokeWidth > 0) ctx.stroke();
        } else if (item.type === 'line') {
          if (stroke) {
            ctx.beginPath();
            ctx.moveTo(item.x1, item.y1);
            ctx.lineTo(item.x2, item.y2);
            ctx.lineCap = 'round';
            ctx.stroke();
          }
        } else if (item.type === 'arrow') {
          if (stroke) {
            const headLen = Math.max(16, item.strokeWidth * 3.8);
            const angle = Math.atan2(item.y2 - item.y1, item.x2 - item.x1);
            ctx.beginPath();
            ctx.moveTo(item.x1, item.y1);
            ctx.lineTo(item.x2, item.y2);
            ctx.lineCap = 'round';
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(item.x2, item.y2);
            ctx.lineTo(
              item.x2 - headLen * Math.cos(angle - Math.PI / 6),
              item.y2 - headLen * Math.sin(angle - Math.PI / 6)
            );
            ctx.lineTo(
              item.x2 - headLen * Math.cos(angle + Math.PI / 6),
              item.y2 - headLen * Math.sin(angle + Math.PI / 6)
            );
            ctx.closePath();
            ctx.fillStyle = stroke;
            ctx.fill();
          }
        } else if (item.type === 'text') {
          ctx.font = (item.fontWeight || 'bold') + ' ' + item.fontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
          ctx.textBaseline = 'top';
          ctx.fillStyle = item.color || stroke || '#ff3b30';
          const lines = (item.text || '').split(String.fromCharCode(10));
          const lineHeight = item.fontSize * 1.25;
          lines.forEach((line, idx) => {
            ctx.fillText(line, item.x, item.y + idx * lineHeight);
          });
        }
        ctx.restore();
      }
      ctx.restore();

      return canvas;
    }

    async function copyCroppedImage() {
      closeContextMenu();
      const canvas = getCroppedCanvas();
      if (!canvas) return;

      let copied = false;
      if (navigator.clipboard && window.ClipboardItem) {
        try {
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          if (blob) {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob })
            ]);
            copied = true;
          }
        } catch (err) {
          console.warn('navigator.clipboard.write failed, falling back to postMessage', err);
        }
      }

      const dataUrl = canvas.toDataURL('image/png', 1.0);
      if (copied) {
        showToast(getT().copiedToast || '📋 Copied to clipboard!');
      } else {
        vscode.postMessage({
          command: 'copyImage',
          data: dataUrl
        });
      }
    }

    function saveAndOverwrite() {
      saveBtn.disabled = true;
      saveBtn.innerText = getT().savingBtn;

      setTimeout(() => {
        const canvas = getCroppedCanvas();
        const dataUrl = canvas.toDataURL('${mimeType}', 1.0);
        vscode.postMessage({
          command: 'save',
          data: dataUrl
        });
      }, 50);
    }

    function cancel() {
      vscode.postMessage({ command: 'cancel' });
    }

    window.addEventListener('resize', () => {
      resetCrop();
    });

    // Resize Modal Functions
    let originalImageAspect = 1;

    function openResizeModal() {
      originalImageAspect = img.naturalWidth / img.naturalHeight;
      modalCurrentSize.innerText = img.naturalWidth + ' x ' + img.naturalHeight + ' px';
      resizeWidth.value = img.naturalWidth;
      resizeHeight.value = img.naturalHeight;
      resizeKeepRatio.checked = true;
      resizeModal.classList.add('open');
    }

    function closeResizeModal() {
      resizeModal.classList.remove('open');
    }

    function onModalOverlayClick(e) {
      if (e.target === resizeModal) {
        closeResizeModal();
      }
    }

    function onResizeWidthInput() {
      if (resizeKeepRatio.checked) {
        const w = parseFloat(resizeWidth.value);
        if (!isNaN(w) && w > 0) {
          resizeHeight.value = Math.round(w / originalImageAspect);
        }
      }
    }

    function onResizeHeightInput() {
      if (resizeKeepRatio.checked) {
        const h = parseFloat(resizeHeight.value);
        if (!isNaN(h) && h > 0) {
          resizeWidth.value = Math.round(h * originalImageAspect);
        }
      }
    }

    function onKeepRatioChange() {
      if (resizeKeepRatio.checked) {
        const w = parseFloat(resizeWidth.value);
        if (!isNaN(w) && w > 0) {
          resizeHeight.value = Math.round(w / originalImageAspect);
        }
      }
    }

    function applyPresetScale(multiplier) {
      const newW = Math.round(img.naturalWidth * multiplier);
      const newH = Math.round(img.naturalHeight * multiplier);
      resizeWidth.value = newW;
      resizeHeight.value = newH;
    }

    function executeResizeAndSave() {
      const targetW = parseInt(resizeWidth.value, 10);
      const targetH = parseInt(resizeHeight.value, 10);

      if (isNaN(targetW) || targetH <= 0 || targetW <= 0 || isNaN(targetH)) {
        alert('Please enter valid width and height values.');
        return;
      }

      closeResizeModal();
      saveBtn.disabled = true;
      saveBtn.innerText = getT().resizingBtn;

      setTimeout(() => {
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, targetW, targetH);

        const dataUrl = canvas.toDataURL('${mimeType}', 1.0);
        vscode.postMessage({
          command: 'save',
          data: dataUrl
        });
      }, 50);
    }

    // Settings Modal Functions
    function openSettingsModal() {
      if (settingsThemeSelect) settingsThemeSelect.value = currentTheme;
      if (settingsLangSelect) settingsLangSelect.value = currentLanguage;
      if (settingsModal) settingsModal.classList.add('open');
    }

    function closeSettingsModal() {
      if (settingsModal) settingsModal.classList.remove('open');
    }

    function onSettingsModalOverlayClick(e) {
      if (e.target === settingsModal) {
        closeSettingsModal();
      }
    }

    function onThemeSelectChange() {
      applyTheme(settingsThemeSelect.value, true);
    }

    function onLangSelectChange() {
      applyLanguage(settingsLangSelect.value, true);
    }
  </script>
</body>
</html>`;
}

module.exports = {
  activate,
  deactivate: () => {}
};
