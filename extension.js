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
      flex-wrap: wrap;
      white-space: nowrap;
    }
    .toolbar-left, .toolbar-right {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .toolbar-center {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: center;
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
      max-width: 130px;
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

    /* Responsive adjustments for toolbar */
    @media (max-width: 1150px) {
      .toolbar {
        padding: 5px 8px;
        gap: 5px;
      }
      .file-title {
        max-width: 80px;
      }
      .btn-toggle {
        padding: 3px 6px;
        font-size: 10.5px;
      }
      .btn {
        padding: 4px 7px;
        font-size: 10.5px;
      }
      .save-shortcut-hint {
        display: none;
      }
    }
    @media (max-width: 860px) {
      .toolbar {
        justify-content: center;
      }
      .toolbar-left {
        order: 1;
      }
      .toolbar-right {
        order: 2;
      }
      .toolbar-center {
        order: 3;
        width: 100%;
        margin-top: 1px;
        padding-top: 4px;
        border-top: 1px dashed var(--border-color);
      }
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
      padding: 60px;
      transition: background-color 0.2s;
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
      transition: border-radius 0.15s ease;
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
  </style>
</head>
<body class="${initialTheme === 'light' ? 'theme-light' : 'theme-dark'}">

  <!-- Toolbar -->
  <div class="toolbar">
    <div class="toolbar-left">
      <button class="btn-icon" id="settingsBtn" onclick="openSettingsModal()">⚙️</button>
      <span class="file-title" id="fileTitle" title="${fileName}">${fileName}</span>
    </div>

    <div class="toolbar-center">
      <!-- Aspect Ratio Presets -->
      <div class="btn-group">
        <button class="btn-toggle active" id="ratioFree" onclick="setRatio('free')">Free</button>
        <button class="btn-toggle" id="ratioSquare" onclick="setRatio('1:1')">1:1</button>
        <button class="btn-toggle" id="ratioPadSquare" onclick="padToSquare()">⛶ Pad 1:1</button>
        <button class="btn-toggle" id="ratio16_9" onclick="setRatio('16:9')">16:9</button>
        <button class="btn-toggle" id="ratio4_3" onclick="setRatio('4:3')">4:3</button>
      </div>

      <!-- Circle / Rounded Corner Shape Control -->
      <div class="btn-group">
        <button class="btn-toggle" id="btnShapeCircle" onclick="toggleShapeCircle()">⚪ Circle</button>
      </div>
      <div class="size-input-wrapper" id="cropRadiusWrapper">
        <label for="cropRadiusInput">R:</label>
        <input type="number" id="cropRadiusInput" class="size-input" min="0" max="1000" step="2" value="0" onchange="onRadiusInputChange()">
      </div>

      <!-- Rotate Controls with Sharp SVG Icons -->
      <div class="btn-group">
        <button class="btn-rotate" id="btnRotateLeft" onclick="rotateImage(-90)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
        </button>
        <button class="btn-rotate" id="btnRotateRight" onclick="rotateImage(90)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
            <path d="M21 3v5h-5"/>
          </svg>
        </button>
      </div>

      <!-- Numerical Crop Size Direct Input -->
      <div class="crop-size-control" id="cropSizeControl">
        <div class="size-input-wrapper">
          <label for="cropInputW">W:</label>
          <input type="number" id="cropInputW" class="size-input" min="1" step="1" onchange="onCropInputChange()">
        </div>
        <span>×</span>
        <div class="size-input-wrapper">
          <label for="cropInputH">H:</label>
          <input type="number" id="cropInputH" class="size-input" min="1" step="1" onchange="onCropInputChange()">
        </div>
        <button id="ratioLockBtn" class="lock-btn" onclick="toggleRatioLock()">🔓</button>
      </div>

      <!-- Resize Image Button -->
      <button class="btn btn-secondary" id="btnOpenResize" onclick="openResizeModal()">
        📐 Resize
      </button>

      <!-- Reset Button -->
      <button class="btn btn-secondary" id="btnReset" onclick="resetCrop()">
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
        ratioLockTitle: 'Lock Aspect Ratio'
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
        ratioLockTitle: '縦横比を固定 / 解除'
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
        ratioLockTitle: '锁定 / 解锁宽高比'
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
        ratioLockTitle: '가로세로 비율 고정 / 해제'
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
        ratioLockTitle: 'Bloquear / desbloquear relación de aspecto'
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
        ratioLockTitle: 'Seitenverhältnis sperren / entsperren'
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
        ratioLockTitle: 'Verrouiller / déverrouiller le format'
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
        ratioLockTitle: 'Khóa / mở khóa tỷ lệ khung hình'
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
        ratioLockTitle: 'पहलू अनुपात लॉक / अनलॉक करें'
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
        ratioLockTitle: 'Blocca / sblocca proporzioni'
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
        ratioLockTitle: 'Bloquear / desbloquear proporção'
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
        ratioLockTitle: 'Заблокировать / разблокировать пропорции'
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
    let cropShape = 'rect'; // 'rect' | 'circle'
    let cornerRadius = 0; // in natural pixels
    const btnShapeCircle = document.getElementById('btnShapeCircle');
    const cropRadiusInput = document.getElementById('cropRadiusInput');

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

      // Context Menu
      const copyLabel = document.getElementById('contextMenuCopyLabel');
      if (copyLabel && t.copyMenu) {
        copyLabel.innerText = t.copyMenu;
      }
      const shortcutLabel = document.getElementById('contextMenuShortcutLabel');
      if (shortcutLabel) {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        shortcutLabel.innerText = isMac ? 'Cmd+C' : 'Ctrl+C';
      }

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
      window.focus();
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
          window.focus();
        });
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

    function onRadiusInputChange() {
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
      if (isDragging) {
        window.focus();
      }
      isDragging = false;
      dragMode = null;
    });

    // Double click on crop box, masks, or stage to expand/maximize crop box to full
    window.addEventListener('dblclick', (e) => {
      if (e.target.closest('.modal-content') || e.target.closest('.toolbar') || e.target.closest('.footer-hint') || e.target.closest('.ctx-menu')) return;
      if (e.target.closest('.crop-box') || e.target.closest('.crop-mask') || e.target.closest('.stage') || e.target.closest('#cropImage')) {
        resetCrop();
      }
    });

    // Shortcuts
    window.addEventListener('keydown', (e) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

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
        closeContextMenu();
        if (settingsModal.classList.contains('open')) {
          closeSettingsModal();
        } else if (resizeModal.classList.contains('open')) {
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
