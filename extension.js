const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

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

    const filePath = document.uri.fsPath;
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    let mimeType = 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.webp') mimeType = 'image/webp';
    else if (ext === '.bmp') mimeType = 'image/bmp';

    let base64Data;
    try {
      const fileBuffer = fs.readFileSync(filePath);
      base64Data = fileBuffer.toString('base64');
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to load image: ${err.message}`);
      return;
    }

    // Default theme is 'light'. If user changes it, globalState persists it across sessions.
    const initialTheme = this.context.globalState.get('simple-image-crop.theme', 'light');
    const defaultLang = (vscode.env.language && vscode.env.language.startsWith('ja')) ? 'ja' : 'en';
    const initialLanguage = this.context.globalState.get('simple-image-crop.language', defaultLang);

    webviewPanel.webview.html = getWebviewContent(fileName, mimeType, base64Data, {
      theme: initialTheme,
      language: initialLanguage
    });

    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'save') {
        try {
          const rawBase64 = message.data.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(rawBase64, 'base64');
          fs.writeFileSync(filePath, buffer);
          vscode.window.showInformationMessage(`✅ Overwritten: ${fileName} (${buffer.length} bytes)`);

          // Re-feed new image to webview so it displays the updated crop immediately
          base64Data = buffer.toString('base64');
          webviewPanel.webview.postMessage({
            command: 'updated',
            imageSrc: `data:${mimeType};base64,${base64Data}`
          });
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to overwrite file: ${err.message}`);
        }
      } else if (message.command === 'saveSettings') {
        if (message.settings) {
          if (message.settings.theme) {
            await this.context.globalState.update('simple-image-crop.theme', message.settings.theme);
          }
          if (message.settings.language) {
            await this.context.globalState.update('simple-image-crop.language', message.settings.language);
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

    /* Toolbar */
    .toolbar {
      background: var(--bg-toolbar);
      border-bottom: 1px solid var(--border-color);
      padding: 6px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      z-index: 100;
      box-shadow: 0 2px 6px rgba(0,0,0,0.15);
      flex-wrap: nowrap;
      white-space: nowrap;
      overflow-x: auto;
    }
    .toolbar-left, .toolbar-center, .toolbar-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: nowrap;
      flex-shrink: 0;
    }
    .toolbar-left {
      min-width: 0;
      flex-shrink: 1;
    }
    .file-title {
      font-weight: 600;
      font-size: 13px;
      color: var(--text-title);
      white-space: nowrap;
      max-width: 150px;
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
      background: transparent;
      border: none;
      cursor: pointer;
      color: var(--text-muted);
      font-size: 11px;
      padding: 2px 3px;
      border-radius: 3px;
      display: inline-flex;
      align-items: center;
      transition: color 0.15s, background 0.15s;
    }
    .lock-btn:hover {
      background: var(--btn-toggle-hover);
    }
    .lock-btn.locked {
      color: #0e639c;
    }
    body.theme-light .lock-btn.locked {
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
      padding: 3px 6px;
      font-size: 12px;
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
      padding: 30px;
      transition: background-color 0.2s;
    }

    /* Stage Container */
    .stage {
      position: relative;
      box-shadow: 0 8px 30px rgba(0,0,0,0.5);
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
    }

    /* Crop Mask */
    .mask {
      position: absolute;
      background: var(--mask-color);
      pointer-events: none;
      transition: background 0.1s;
    }
    #maskTop { top: 0; left: 0; right: 0; }
    #maskBottom { bottom: 0; left: 0; right: 0; }
    #maskLeft { left: 0; }
    #maskRight { right: 0; }

    /* Crop Box */
    .crop-box {
      position: absolute;
      box-sizing: border-box;
      outline: 1.5px dashed var(--crop-outline);
      cursor: move;
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
  </style>
</head>
<body class="${initialTheme === 'light' ? 'theme-light' : 'theme-dark'}">

  <!-- Toolbar -->
  <div class="toolbar">
    <div class="toolbar-left">
      <button class="btn-icon" id="settingsBtn" onclick="openSettingsModal()" title="Settings / 設定">⚙️</button>
      <span class="file-title" title="${fileName}">${fileName}</span>
    </div>

    <div class="toolbar-center">
      <!-- Aspect Ratio Presets -->
      <div class="btn-group">
        <button class="btn-toggle active" id="ratioFree" onclick="setRatio('free')" title="Free crop">Free</button>
        <button class="btn-toggle" id="ratioSquare" onclick="setRatio('1:1')" title="Square (1:1)">1:1</button>
        <button class="btn-toggle" id="ratio16_9" onclick="setRatio('16:9')" title="16:9 Landscape">16:9</button>
        <button class="btn-toggle" id="ratio4_3" onclick="setRatio('4:3')" title="4:3 Landscape">4:3</button>
      </div>

      <!-- Numerical Crop Size Direct Input -->
      <div class="crop-size-control" title="Crop size in pixels (W x H)">
        <div class="size-input-wrapper">
          <label for="cropInputW">W:</label>
          <input type="number" id="cropInputW" class="size-input" min="1" step="1" onchange="onCropInputChange()">
        </div>
        <span>×</span>
        <div class="size-input-wrapper">
          <label for="cropInputH">H:</label>
          <input type="number" id="cropInputH" class="size-input" min="1" step="1" onchange="onCropInputChange()">
        </div>
        <button id="ratioLockBtn" class="lock-btn" onclick="toggleRatioLock()" title="Lock Aspect Ratio">🔓</button>
      </div>

      <!-- Resize Image Button -->
      <button class="btn btn-secondary" id="btnOpenResize" onclick="openResizeModal()" title="Resize image dimensions">
        📐 Resize
      </button>

      <!-- Reset Button -->
      <button class="btn btn-secondary" id="btnReset" onclick="resetCrop()" title="Reset crop box to full image">
        ↺ Reset
      </button>
    </div>

    <div class="toolbar-right">
      <!-- Theme Toggle Button -->
      <button class="btn-theme" id="themeToggleBtn" onclick="toggleTheme()" title="Toggle Light/Dark Theme">
        ${initialTheme === 'light' ? '🌙 Dark' : '☀️ Light'}
      </button>

      <button class="btn btn-secondary" id="btnClose" onclick="cancel()">Close</button>
      <button class="btn btn-primary" id="saveBtn" onclick="saveAndOverwrite()">
        💾 Save & Overwrite (Cmd+S)
      </button>
    </div>
  </div>

  <!-- Workspace -->
  <div class="workspace" id="workspace">
    <div class="stage" id="stage">
      <img id="sourceImg" src="${imageSrc}" alt="${fileName}">

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
      <span id="footerShortcutsText">Shortcuts: <span class="shortcut-tag">Cmd + S</span> Save / <span class="shortcut-tag">1</span> 1:1 / <span class="shortcut-tag">F</span> Free / <span class="shortcut-tag">R</span> Reset</span>
    </div>
  </div>

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

    // Settings Modal elements
    const settingsModal = document.getElementById('settingsModal');
    const settingsThemeSelect = document.getElementById('settingsThemeSelect');
    const settingsLangSelect = document.getElementById('settingsLangSelect');

    // i18n Dictionary
    const I18N = {
      en: {
        ratioFree: 'Free',
        ratioSquare: '1:1',
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
        shortcuts: 'Shortcuts: <span class=\"shortcut-tag\">Cmd + S</span> Save / <span class=\"shortcut-tag\">1</span> 1:1 / <span class=\"shortcut-tag\">F</span> Free / <span class=\"shortcut-tag\">R</span> Reset',
        themeLight: '☀️ Light',
        themeDark: '🌙 Dark'
      },
      ja: {
        ratioFree: '自由',
        ratioSquare: '1:1',
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
        shortcuts: 'ショートカット: <span class=\"shortcut-tag\">Cmd + S</span> 保存 / <span class=\"shortcut-tag\">1</span> 1:1 / <span class=\"shortcut-tag\">F</span> 自由 / <span class=\"shortcut-tag\">R</span> リセット',
        themeLight: '☀️ ライト',
        themeDark: '🌙 ダーク'
      },
      zh: {
        ratioFree: '自由',
        ratioSquare: '1:1',
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
        shortcuts: '快捷键: <span class=\"shortcut-tag\">Cmd + S</span> 保存 / <span class=\"shortcut-tag\">1</span> 1:1 / <span class=\"shortcut-tag\">F</span> 自由 / <span class=\"shortcut-tag\">R</span> 重置',
        themeLight: '☀️ 浅色',
        themeDark: '🌙 深色'
      },
      ko: {
        ratioFree: '자유',
        ratioSquare: '1:1',
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
        shortcuts: '단축키: <span class=\"shortcut-tag\">Cmd + S</span> 저장 / <span class=\"shortcut-tag\">1</span> 1:1 / <span class=\"shortcut-tag\">F</span> 자유 / <span class=\"shortcut-tag\">R</span> 초기화',
        themeLight: '☀️ 라이트',
        themeDark: '🌙 다크'
      },
      es: {
        ratioFree: 'Libre',
        ratioSquare: '1:1',
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
        shortcuts: 'Atajos: <span class=\"shortcut-tag\">Cmd + S</span> Guardar / <span class=\"shortcut-tag\">1</span> 1:1 / <span class=\"shortcut-tag\">F</span> Libre / <span class=\"shortcut-tag\">R</span> Reset',
        themeLight: '☀️ Claro',
        themeDark: '🌙 Oscuro'
      },
      de: {
        ratioFree: 'Frei',
        ratioSquare: '1:1',
        ratio16_9: '16:9',
        ratio4_3: '4:3',
        resizeBtn: '📐 Skalieren',
        resetBtn: '↺ Zurücksetzen',
        closeBtn: 'Schließen',
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
        shortcuts: 'Kürzel: <span class=\"shortcut-tag\">Cmd + S</span> Speichern / <span class=\"shortcut-tag\">1</span> 1:1 / <span class=\"shortcut-tag\">F</span> Frei / <span class=\"shortcut-tag\">R</span> Reset',
        themeLight: '☀️ Hell',
        themeDark: '🌙 Dunkel'
      },
      fr: {
        ratioFree: 'Libre',
        ratioSquare: '1:1',
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
        shortcuts: 'Raccourcis : <span class=\"shortcut-tag\">Cmd + S</span> Enregistrer / <span class=\"shortcut-tag\">1</span> 1:1 / <span class=\"shortcut-tag\">F</span> Libre / <span class=\"shortcut-tag\">R</span> Reset',
        themeLight: '☀️ Clair',
        themeDark: '🌙 Sombre'
      },
      vi: {
        ratioFree: 'Tự do',
        ratioSquare: '1:1',
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
        shortcuts: 'Phím tắt: <span class=\"shortcut-tag\">Cmd + S</span> Lưu / <span class=\"shortcut-tag\">1</span> 1:1 / <span class=\"shortcut-tag\">F</span> Tự do / <span class=\"shortcut-tag\">R</span> Đặt lại',
        themeLight: '☀️ Sáng',
        themeDark: '🌙 Tối'
      },
      hi: {
        ratioFree: 'मुक्त',
        ratioSquare: '1:1',
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
        shortcuts: 'शॉर्टकट: <span class=\"shortcut-tag\">Cmd + S</span> सेव / <span class=\"shortcut-tag\">1</span> 1:1 / <span class=\"shortcut-tag\">F</span> मुक्त / <span class=\"shortcut-tag\">R</span> रीसेट',
        themeLight: '☀️ लाइट',
        themeDark: '🌙 डार्क'
      },
      it: {
        ratioFree: 'Libero',
        ratioSquare: '1:1',
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
        shortcuts: 'Scorciatoie: <span class=\"shortcut-tag\">Cmd + S</span> Salva / <span class=\"shortcut-tag\">1</span> 1:1 / <span class=\"shortcut-tag\">F</span> Libero / <span class=\"shortcut-tag\">R</span> Reset',
        themeLight: '☀️ Chiaro',
        themeDark: '🌙 Scuro'
      },
      pt: {
        ratioFree: 'Livre',
        ratioSquare: '1:1',
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
        shortcuts: 'Atalhos: <span class=\"shortcut-tag\">Cmd + S</span> Salvar / <span class=\"shortcut-tag\">1</span> 1:1 / <span class=\"shortcut-tag\">F</span> Livre / <span class=\"shortcut-tag\">R</span> Reset',
        themeLight: '☀️ Claro',
        themeDark: '🌙 Escuro'
      },
      ru: {
        ratioFree: 'Свободно',
        ratioSquare: '1:1',
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
        shortcuts: 'Горячие клавиши: <span class=\"shortcut-tag\">Cmd + S</span> Сохранить / <span class=\"shortcut-tag\">1</span> 1:1 / <span class=\"shortcut-tag\">F</span> Свободно / <span class=\"shortcut-tag\">R</span> Сброс',
        themeLight: '☀️ Светлая',
        themeDark: '🌙 Темная'
      }
    };

    // State
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

    // Apply initial theme & language
    applyTheme(currentTheme, false);
    applyLanguage(currentLanguage, false);

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
      document.getElementById('ratio16_9').innerText = t.ratio16_9;
      document.getElementById('ratio4_3').innerText = t.ratio4_3;
      document.getElementById('btnOpenResize').innerText = t.resizeBtn;
      document.getElementById('btnReset').innerText = t.resetBtn;
      document.getElementById('btnClose').innerText = t.closeBtn;
      document.getElementById('saveBtn').innerText = t.saveBtn;

      themeToggleBtn.innerText = currentTheme === 'light' ? t.themeDark : t.themeLight;

      // Settings Modal
      document.getElementById('settingsModalTitle').innerText = t.settingsTitle;
      document.getElementById('labelTheme').innerText = t.themeLabel;
      document.getElementById('labelLanguage').innerText = t.langLabel;

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

      updateUI();

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

    img.onload = () => {
      const t = getT();
      originalSizeBadge.innerText = t.originalBadge + img.naturalWidth + ' x ' + img.naturalHeight;
      resetZoom();
      resetCrop();
    };

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'updated') {
        img.src = msg.imageSrc;
        saveBtn.disabled = false;
        saveBtn.innerText = getT().saveBtn;
        // Reset crop box to full image on save
        currentRatio = 'free';
        updateRatioButtons();
        resetZoom();
        // Wait for image layout to update then reset
        requestAnimationFrame(() => {
          resetCrop();
        });
      }
    });

    function resetCrop() {
      const stageW = img.clientWidth;
      const stageH = img.clientHeight;
      if (stageW === 0 || stageH === 0) return;

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

        let w = stageW * 0.9;
        let h = w / targetAspect;
        if (h > stageH * 0.9) {
          h = stageH * 0.9;
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
      document.getElementById('ratio16_9').classList.toggle('active', currentRatio === '16:9');
      document.getElementById('ratio4_3').classList.toggle('active', currentRatio === '4:3');
    }

    function setRatio(ratio) {
      currentRatio = ratio;
      updateRatioButtons();

      if (ratio !== 'free') {
        let targetAspect = 1;
        if (ratio === '1:1') targetAspect = 1;
        else if (ratio === '16:9') targetAspect = 16 / 9;
        else if (ratio === '4:3') targetAspect = 4 / 3;

        const stageW = img.clientWidth;
        const stageH = img.clientHeight;

        let w = crop.width;
        let h = w / targetAspect;
        if (h > stageH) {
          h = stageH;
          w = h * targetAspect;
        }
        if (w > stageW) {
          w = stageW;
          h = w / targetAspect;
        }

        let left = crop.left + (crop.width - w) / 2;
        let top = crop.top + (crop.height - h) / 2;
        left = Math.max(0, Math.min(stageW - w, left));
        top = Math.max(0, Math.min(stageH - h, top));

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

    function onCropInputChange() {
      const stageW = img.clientWidth;
      const stageH = img.clientHeight;
      const scale = img.naturalWidth / stageW;

      let targetNaturalW = parseInt(cropInputW.value, 10);
      let targetNaturalH = parseInt(cropInputH.value, 10);

      if (isNaN(targetNaturalW) || targetNaturalW < 1) targetNaturalW = 1;
      if (isNaN(targetNaturalH) || targetNaturalH < 1) targetNaturalH = 1;

      targetNaturalW = Math.min(img.naturalWidth, targetNaturalW);
      targetNaturalH = Math.min(img.naturalHeight, targetNaturalH);

      let newW = targetNaturalW / scale;
      let newH = targetNaturalH / scale;

      // Keep center of current crop
      const centerX = crop.left + crop.width / 2;
      const centerY = crop.top + crop.height / 2;

      let newL = centerX - newW / 2;
      let newT = centerY - newH / 2;

      newL = Math.max(0, Math.min(stageW - newW, newL));
      newT = Math.max(0, Math.min(stageH - newH, newT));

      crop = { left: newL, top: newT, width: newW, height: newH };
      updateUI();
    }

    function updateUI() {
      const stageW = img.clientWidth;
      const stageH = img.clientHeight;
      if (stageW === 0 || stageH === 0) return;

      cropBox.style.left = crop.left + 'px';
      cropBox.style.top = crop.top + 'px';
      cropBox.style.width = crop.width + 'px';
      cropBox.style.height = crop.height + 'px';

      maskTop.style.height = crop.top + 'px';

      maskBottom.style.top = (crop.top + crop.height) + 'px';
      maskBottom.style.height = (stageH - (crop.top + crop.height)) + 'px';

      maskLeft.style.top = crop.top + 'px';
      maskLeft.style.height = crop.height + 'px';
      maskLeft.style.width = crop.left + 'px';

      maskRight.style.top = crop.top + 'px';
      maskRight.style.height = crop.height + 'px';
      maskRight.style.left = (crop.left + crop.width) + 'px';
      maskRight.style.width = (stageW - (crop.left + crop.width)) + 'px';

      const scale = img.naturalWidth / stageW;
      const actualW = Math.round(crop.width * scale);
      const actualH = Math.round(crop.height * scale);
      const t = getT();
      cropSizeBadge.innerText = t.cropBadge + actualW + ' x ' + actualH;

      // Update input fields without stealing focus
      if (document.activeElement !== cropInputW) {
        cropInputW.value = actualW;
      }
      if (document.activeElement !== cropInputH) {
        cropInputH.value = actualH;
      }
    }

    // Drag handlers
    window.addEventListener('mousedown', (e) => {
      if (e.target.closest('.modal-content') || e.target.closest('.toolbar') || e.target.closest('.footer-hint')) return;

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

      startX = e.clientX;
      startY = e.clientY;
      startCrop = { ...crop };
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const dx = (e.clientX - startX) / currentZoom;
      const dy = (e.clientY - startY) / currentZoom;
      const stageW = img.clientWidth;
      const stageH = img.clientHeight;
      const minSize = 20;

      let { left, top, width, height } = startCrop;

      if (dragMode === 'box') {
        left = Math.max(0, Math.min(stageW - width, left + dx));
        top = Math.max(0, Math.min(stageH - height, top + dy));
      } else {
        let newL = left;
        let newR = left + width;
        let newT = top;
        let newB = top + height;

        if (dragMode.includes('l')) newL = Math.min(newR - minSize, Math.max(0, left + dx));
        if (dragMode.includes('r')) newR = Math.max(newL + minSize, Math.min(stageW, left + width + dx));
        if (dragMode.includes('t')) newT = Math.min(newB - minSize, Math.max(0, top + dy));
        if (dragMode.includes('b')) newB = Math.max(newT + minSize, Math.min(stageH, top + height + dy));

        let activeAspect = null;
        if (currentRatio === '1:1') activeAspect = 1;
        else if (currentRatio === '16:9') activeAspect = 16 / 9;
        else if (currentRatio === '4:3') activeAspect = 4 / 3;
        else if (isRatioLocked) activeAspect = lockedRatioValue;

        if (activeAspect !== null) {
          let sideW, sideH;
          if (dragMode === 't' || dragMode === 'b') {
            sideH = newB - newT;
            sideW = sideH * activeAspect;
            const midX = (newL + newR) / 2;
            newL = midX - sideW / 2;
            newR = midX + sideW / 2;
          } else if (dragMode === 'l' || dragMode === 'r') {
            sideW = newR - newL;
            sideH = sideW / activeAspect;
            const midY = (newT + newB) / 2;
            newT = midY - sideH / 2;
            newB = midY + sideH / 2;
          } else {
            // Corners
            let wCandidate = newR - newL;
            let hCandidate = newB - newT;
            let chosenW = Math.max(wCandidate, hCandidate * activeAspect);
            let chosenH = chosenW / activeAspect;

            if (dragMode === 'tl') { newL = newR - chosenW; newT = newB - chosenH; }
            if (dragMode === 'tr') { newR = newL + chosenW; newT = newB - chosenH; }
            if (dragMode === 'bl') { newL = newR - chosenW; newB = newT + chosenH; }
            if (dragMode === 'br') { newR = newL + chosenW; newB = newT + chosenH; }
          }

          if (newL < 0) {
            newR = Math.min(stageW, newR - newL);
            newL = 0;
          }
          if (newR > stageW) {
            newL = Math.max(0, newL - (newR - stageW));
            newR = stageW;
          }
          if (newT < 0) {
            newB = Math.min(stageH, newB - newT);
            newT = 0;
          }
          if (newB > stageH) {
            newT = Math.max(0, newT - (newB - stageH));
            newB = stageH;
          }
        }

        left = Math.max(0, newL);
        top = Math.max(0, newT);
        width = Math.max(minSize, Math.min(stageW - left, newR - left));
        height = Math.max(minSize, Math.min(stageH - top, newB - top));
      }

      crop = { left, top, width, height };
      updateUI();
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
      dragMode = null;
    });

    // Shortcuts
    window.addEventListener('keydown', (e) => {
      // Don't trigger shortcuts if focus is inside an input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        if (e.key === 'Escape') {
          document.activeElement.blur();
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveAndOverwrite();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomChange(0.1);
      } else if ((e.metaKey || e.ctrlKey) && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        zoomChange(-0.1);
      } else if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault();
        resetZoom();
      } else if (e.key === 'Escape') {
        if (settingsModal.classList.contains('open')) {
          closeSettingsModal();
        } else if (resizeModal.classList.contains('open')) {
          closeResizeModal();
        } else {
          cancel();
        }
      } else if (e.key === '1') {
        setRatio('1:1');
      } else if (e.key.toLowerCase() === 'f') {
        setRatio('free');
      } else if (e.key.toLowerCase() === 'r') {
        resetCrop();
      }
    });

    window.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        zoomChange(delta);
      }
    }, { passive: false });

    function saveAndOverwrite() {
      saveBtn.disabled = true;
      saveBtn.innerText = getT().savingBtn;

      setTimeout(() => {
        const stageW = img.clientWidth;
        const scale = img.naturalWidth / stageW;

        const naturalX = Math.round(crop.left * scale);
        const naturalY = Math.round(crop.top * scale);
        const naturalW = Math.round(crop.width * scale);
        const naturalH = Math.round(crop.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = naturalW;
        canvas.height = naturalH;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.drawImage(img, naturalX, naturalY, naturalW, naturalH, 0, 0, naturalW, naturalH);

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
      settingsThemeSelect.value = currentTheme;
      settingsLangSelect.value = currentLanguage;
      settingsModal.classList.add('open');
    }

    function closeSettingsModal() {
      settingsModal.classList.remove('open');
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
