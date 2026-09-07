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

    webviewPanel.webview.html = getWebviewContent(fileName, mimeType, base64Data);

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
      } else if (message.command === 'cancel') {
        webviewPanel.dispose();
      }
    });
  }
}

function getWebviewContent(fileName, mimeType, base64Data) {
  const imageSrc = `data:${mimeType};base64,${base64Data}`;

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
      padding: 6px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      z-index: 100;
      box-shadow: 0 2px 6px rgba(0,0,0,0.15);
      flex-wrap: wrap;
    }
    .toolbar-left, .toolbar-center, .toolbar-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .file-title {
      font-weight: 600;
      font-size: 13px;
      color: var(--text-title);
      white-space: nowrap;
      max-width: 180px;
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
      padding: 4px 9px;
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
      gap: 4px;
      background: var(--btn-group-bg);
      padding: 2px 6px;
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
      width: 52px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--input-text);
      font-size: 11px;
      font-family: monospace;
      padding: 2px 4px;
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
      font-size: 12px;
      padding: 2px 4px;
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
      padding: 5px 12px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      border: 1px solid transparent;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
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
      padding: 5px 9px;
      font-size: 12px;
      border-radius: 4px;
      cursor: pointer;
    }
    .btn-theme:hover {
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

    /* Modal (Resize) */
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
      transition: background-color 0.2s;
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
<body class="theme-dark">

  <!-- Toolbar -->
  <div class="toolbar">
    <div class="toolbar-left">
      <span class="file-title" title="${fileName}">${fileName}</span>
      <span class="badge" id="originalSizeBadge">Original: -- x --</span>
      <span class="badge badge-crop" id="cropSizeBadge">Crop: -- x --</span>
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
      <button class="btn btn-secondary" onclick="openResizeModal()" title="Resize image dimensions">
        📐 Resize
      </button>

      <!-- Reset Button -->
      <button class="btn btn-secondary" onclick="resetCrop()" title="Reset crop box to full image">
        ↺ Reset
      </button>
    </div>

    <div class="toolbar-right">
      <!-- Theme Toggle Button -->
      <button class="btn-theme" id="themeToggleBtn" onclick="toggleTheme()" title="Toggle Light/Dark Theme">
        ☀️ Light
      </button>

      <button class="btn btn-secondary" onclick="cancel()">Close</button>
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
        <h3>📐 Resize Image</h3>
        <button class="modal-close-btn" onclick="closeResizeModal()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <label>Current Size:</label>
          <span id="modalCurrentSize" style="font-family: monospace; font-size: 11px;">-- x --</span>
        </div>
        <div class="form-row">
          <label for="resizeWidth">New Width (px):</label>
          <input type="number" id="resizeWidth" min="1" max="10000" oninput="onResizeWidthInput()">
        </div>
        <div class="form-row">
          <label for="resizeHeight">New Height (px):</label>
          <input type="number" id="resizeHeight" min="1" max="10000" oninput="onResizeHeightInput()">
        </div>
        <label class="checkbox-row">
          <input type="checkbox" id="resizeKeepRatio" checked onchange="onKeepRatioChange()">
          <span>Maintain aspect ratio</span>
        </label>
        <div>
          <span style="font-size: 11px; color: var(--text-muted);">Quick Scale:</span>
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
        <button class="btn btn-secondary" onclick="closeResizeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="executeResizeAndSave()">💾 Resize & Save</button>
      </div>
    </div>
  </div>

  <!-- Footer Hint -->
  <div class="footer-hint">
    <div>
      💡 <b>Tips:</b> Drag corners or edges to crop. Drag inside box to move. Direct edit W/H px in toolbar.
    </div>
    <div>
      Shortcuts: <span class="shortcut-tag">Cmd + S</span> Save / <span class="shortcut-tag">1</span> 1:1 / <span class="shortcut-tag">F</span> Free / <span class="shortcut-tag">R</span> Reset / <span class="shortcut-tag">Esc</span> Close
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

    // Modal elements
    const resizeModal = document.getElementById('resizeModal');
    const modalCurrentSize = document.getElementById('modalCurrentSize');
    const resizeWidth = document.getElementById('resizeWidth');
    const resizeHeight = document.getElementById('resizeHeight');
    const resizeKeepRatio = document.getElementById('resizeKeepRatio');

    // State
    const savedState = vscode.getState() || {};
    let currentTheme = savedState.theme || 'dark';
    let currentRatio = 'free'; // 'free', '1:1', '16:9', '4:3'
    let isRatioLocked = false;
    let lockedRatioValue = 1; // W / H

    let crop = { left: 0, top: 0, width: 100, height: 100 };
    let isDragging = false;
    let dragMode = null;
    let startX = 0, startY = 0;
    let startCrop = { ...crop };

    // Apply saved theme
    applyTheme(currentTheme);

    function applyTheme(theme) {
      currentTheme = theme;
      if (theme === 'light') {
        document.body.classList.add('theme-light');
        document.body.classList.remove('theme-dark');
        themeToggleBtn.innerText = '🌙 Dark';
      } else {
        document.body.classList.add('theme-dark');
        document.body.classList.remove('theme-light');
        themeToggleBtn.innerText = '☀️ Light';
      }
      vscode.setState({ ...vscode.getState(), theme: currentTheme });
    }

    function toggleTheme() {
      applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    }

    img.onload = () => {
      originalSizeBadge.innerText = \`Original: \${img.naturalWidth} x \${img.naturalHeight}\`;
      resetCrop();
    };

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'updated') {
        img.src = msg.imageSrc;
        saveBtn.disabled = false;
        saveBtn.innerText = '💾 Save & Overwrite (Cmd+S)';
        // Reset crop box to full image on save
        currentRatio = 'free';
        updateRatioButtons();
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
      cropSizeBadge.innerText = \`Crop: \${actualW} x \${actualH}\`;

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
      if (e.target.closest('.modal-content') || e.target.closest('.toolbar')) return;

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

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
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
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        if (e.key === 'Escape') {
          document.activeElement.blur();
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveAndOverwrite();
      } else if (e.key === 'Escape') {
        if (resizeModal.classList.contains('open')) {
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

    function saveAndOverwrite() {
      saveBtn.disabled = true;
      saveBtn.innerText = 'Saving...';

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
      modalCurrentSize.innerText = \`\${img.naturalWidth} x \${img.naturalHeight} px\`;
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

      if (isNaN(targetW) || isNaN(targetH) || targetW <= 0 || targetH <= 0) {
        alert('Please enter valid width and height values.');
        return;
      }

      closeResizeModal();
      saveBtn.disabled = true;
      saveBtn.innerText = 'Resizing & Saving...';

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
  </script>
</body>
</html>`;
}

module.exports = {
  activate,
  deactivate: () => {}
};
