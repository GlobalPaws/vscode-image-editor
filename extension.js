const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function activate(context) {
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

    let base64Data;
    try {
      const fileBuffer = fs.readFileSync(filePath);
      base64Data = fileBuffer.toString('base64');
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to load image: ${err.message}`);
      return;
    }

    let mimeType = 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.webp') mimeType = 'image/webp';
    else if (ext === '.bmp') mimeType = 'image/bmp';

    const fileName = path.basename(filePath);
    const panel = vscode.window.createWebviewPanel(
      'simpleImageCrop',
      `Crop: ${fileName}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    panel.webview.html = getWebviewContent(fileName, mimeType, base64Data);

    panel.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'save') {
        try {
          const rawBase64 = message.data.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(rawBase64, 'base64');
          fs.writeFileSync(filePath, buffer);
          vscode.window.showInformationMessage(`✅ Overwritten: ${fileName} (${buffer.length} bytes)`);
          panel.dispose();
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to overwrite file: ${err.message}`);
        }
      } else if (message.command === 'cancel') {
        panel.dispose();
      }
    }, undefined, context.subscriptions);
  });

  context.subscriptions.push(disposable);
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
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      user-select: none;
    }
    body {
      background-color: #1e1e1e;
      color: #cccccc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* Toolbar */
    .toolbar {
      background: #252526;
      border-bottom: 1px solid #3c3c3c;
      padding: 8px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      z-index: 100;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }
    .toolbar-left, .toolbar-center, .toolbar-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .file-title {
      font-weight: 600;
      font-size: 14px;
      color: #ffffff;
      white-space: nowrap;
    }
    .badge {
      background: #333333;
      color: #9cdcfe;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-family: monospace;
    }
    .btn-group {
      display: flex;
      background: #333;
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid #444;
    }
    .btn-toggle {
      background: transparent;
      border: none;
      color: #aaa;
      padding: 5px 12px;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .btn-toggle:hover {
      background: #444;
      color: #fff;
    }
    .btn-toggle.active {
      background: #0e639c;
      color: #fff;
      font-weight: 600;
    }
    .btn {
      padding: 6px 14px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      border: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s, transform 0.05s;
    }
    .btn:active {
      transform: scale(0.98);
    }
    .btn-secondary {
      background: #3c3c3c;
      color: #e0e0e0;
    }
    .btn-secondary:hover {
      background: #4a4a4a;
    }
    .btn-primary {
      background: #107c41; /* Excel Green */
      color: #ffffff;
      font-weight: 600;
    }
    .btn-primary:hover {
      background: #13914c;
    }

    /* Workspace */
    .workspace {
      flex: 1;
      overflow: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      background: #181818;
      background-image:
        linear-gradient(45deg, #222 25%, transparent 25%),
        linear-gradient(-45deg, #222 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #222 75%),
        linear-gradient(-45deg, transparent 75%, #222 75%);
      background-size: 20px 20px;
      background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
      padding: 40px;
    }

    /* Stage Container */
    .stage {
      position: relative;
      box-shadow: 0 8px 30px rgba(0,0,0,0.6);
      display: inline-block;
    }

    /* Base Image */
    #sourceImg {
      display: block;
      max-width: 80vw;
      max-height: calc(80vh - 60px);
      width: auto;
      height: auto;
      pointer-events: none;
      image-rendering: auto;
    }

    /* Crop Mask (Dark Outer Overlay) */
    .mask {
      position: absolute;
      background: rgba(30, 30, 30, 0.68);
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
      outline: 1px dashed rgba(255, 255, 255, 0.85);
      cursor: move;
    }

    /* Excel-style Handles */
    .handle {
      position: absolute;
      z-index: 20;
    }

    /* Corner L-Handles */
    .handle-corner {
      width: 22px;
      height: 22px;
      box-sizing: border-box;
    }
    .handle-corner::after {
      content: '';
      position: absolute;
      width: 36px;
      height: 36px;
    }

    .handle-tl {
      top: -3px;
      left: -3px;
      border-top: 5px solid #000;
      border-left: 5px solid #000;
      filter: drop-shadow(0 0 1px #fff);
      cursor: nwse-resize;
    }
    .handle-tl::after { top: -8px; left: -8px; }

    .handle-tr {
      top: -3px;
      right: -3px;
      border-top: 5px solid #000;
      border-right: 5px solid #000;
      filter: drop-shadow(0 0 1px #fff);
      cursor: nesw-resize;
    }
    .handle-tr::after { top: -8px; right: -8px; }

    .handle-bl {
      bottom: -3px;
      left: -3px;
      border-bottom: 5px solid #000;
      border-left: 5px solid #000;
      filter: drop-shadow(0 0 1px #fff);
      cursor: nesw-resize;
    }
    .handle-bl::after { bottom: -8px; left: -8px; }

    .handle-br {
      bottom: -3px;
      right: -3px;
      border-bottom: 5px solid #000;
      border-right: 5px solid #000;
      filter: drop-shadow(0 0 1px #fff);
      cursor: nwse-resize;
    }
    .handle-br::after { bottom: -8px; right: -8px; }

    /* Edge Bar Handles */
    .handle-bar-h {
      width: 28px;
      height: 5px;
      background: #000;
      box-shadow: 0 0 1px 1px #fff;
      cursor: ns-resize;
    }
    .handle-bar-h::after {
      content: '';
      position: absolute;
      top: -12px;
      left: -6px;
      width: 40px;
      height: 28px;
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
      height: 28px;
      background: #000;
      box-shadow: 0 0 1px 1px #fff;
      cursor: ew-resize;
    }
    .handle-bar-v::after {
      content: '';
      position: absolute;
      top: -6px;
      left: -12px;
      width: 28px;
      height: 40px;
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

    /* Footer Hint */
    .footer-hint {
      background: #252526;
      border-top: 1px solid #333;
      padding: 5px 16px;
      font-size: 11px;
      color: #888;
      display: flex;
      justify-content: space-between;
    }
    .shortcut-tag {
      background: #333;
      color: #ccc;
      padding: 1px 5px;
      border-radius: 3px;
      margin: 0 3px;
    }
  </style>
</head>
<body>

  <!-- Toolbar -->
  <div class="toolbar">
    <div class="toolbar-left">
      <span class="file-title">${fileName}</span>
      <span class="badge" id="originalSizeBadge">Original: -- x --</span>
      <span class="badge" id="cropSizeBadge" style="color: #4ec9b0;">Crop: -- x --</span>
    </div>

    <div class="toolbar-center">
      <div class="btn-group">
        <button class="btn-toggle active" id="ratioFree" onclick="setRatio('free')">Free</button>
        <button class="btn-toggle" id="ratioSquare" onclick="setRatio('1:1')">1:1 (Square)</button>
      </div>
      <button class="btn btn-secondary" onclick="resetCrop()">↺ Reset</button>
    </div>

    <div class="toolbar-right">
      <button class="btn btn-secondary" onclick="cancel()">Cancel</button>
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

  <div class="footer-hint">
    <div>
      💡 <b>Tips:</b> Drag corner L-handles or edge bars to adjust crop area. Drag inside the box to move.
    </div>
    <div>
      Shortcuts: <span class="shortcut-tag">Cmd + S</span> Save / <span class="shortcut-tag">1</span> Square / <span class="shortcut-tag">F</span> Free / <span class="shortcut-tag">R</span> Reset / <span class="shortcut-tag">Esc</span> Close
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

    let currentRatio = 'free'; // 'free' or '1:1'
    let crop = { left: 0, top: 0, width: 100, height: 100 };
    let isDragging = false;
    let dragMode = null; // 'box' or 'tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'
    let startX = 0, startY = 0;
    let startCrop = { ...crop };

    img.onload = () => {
      originalSizeBadge.innerText = \`Original: \${img.naturalWidth} x \${img.naturalHeight}\`;
      resetCrop();
    };

    function resetCrop() {
      const stageW = img.clientWidth;
      const stageH = img.clientHeight;

      if (currentRatio === '1:1') {
        const side = Math.min(stageW, stageH) * 0.9;
        crop = {
          left: (stageW - side) / 2,
          top: (stageH - side) / 2,
          width: side,
          height: side
        };
      } else {
        crop = {
          left: 0,
          top: 0,
          width: stageW,
          height: stageH
        };
      }
      updateUI();
    }

    function setRatio(ratio) {
      currentRatio = ratio;
      document.getElementById('ratioFree').classList.toggle('active', ratio === 'free');
      document.getElementById('ratioSquare').classList.toggle('active', ratio === '1:1');

      if (ratio === '1:1') {
        const stageW = img.clientWidth;
        const stageH = img.clientHeight;
        let side = Math.min(crop.width, crop.height);
        if (side < 30) side = Math.min(stageW, stageH) * 0.8;

        let left = crop.left + (crop.width - side) / 2;
        let top = crop.top + (crop.height - side) / 2;

        left = Math.max(0, Math.min(stageW - side, left));
        top = Math.max(0, Math.min(stageH - side, top));

        crop = { left, top, width: side, height: side };
        updateUI();
      }
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
    }

    // Drag handlers
    window.addEventListener('mousedown', (e) => {
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

        if (currentRatio === '1:1') {
          let side;
          if (dragMode === 't' || dragMode === 'b') {
            side = newB - newT;
            const midX = (newL + newR) / 2;
            newL = midX - side / 2;
            newR = midX + side / 2;
          } else if (dragMode === 'l' || dragMode === 'r') {
            side = newR - newL;
            const midY = (newT + newB) / 2;
            newT = midY - side / 2;
            newB = midY + side / 2;
          } else {
            side = Math.max(newR - newL, newB - newT);
            if (dragMode === 'tl') { newL = newR - side; newT = newB - side; }
            if (dragMode === 'tr') { newR = newL + side; newT = newB - side; }
            if (dragMode === 'bl') { newL = newR - side; newB = newT + side; }
            if (dragMode === 'br') { newR = newL + side; newB = newT + side; }
          }

          if (newL < 0) { newR -= newL; newL = 0; }
          if (newR > stageW) { newL -= (newR - stageW); newR = stageW; }
          if (newT < 0) { newB -= newT; newT = 0; }
          if (newB > stageH) { newT -= (newB - stageH); newB = stageH; }
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveAndOverwrite();
      } else if (e.key === 'Escape') {
        cancel();
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
  </script>
</body>
</html>`;
}

module.exports = {
  activate,
  deactivate: () => {}
};
