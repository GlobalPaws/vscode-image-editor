# Image Editor: Simple Crop

<p align="center">
  <img src="https://raw.githubusercontent.com/GlobalPaws/vscode-image-editor/main/icon.png" width="128" height="128" alt="Image Editor: Simple Crop Icon">
</p>

<p align="center">
  <b>Fast, intuitive image cropping, resizing, and zoom with Excel-style handles and direct overwrite saving.</b><br>
  <i>Excel風のハンドル操作で直感的にトリミング・リサイズ・ズームし、元ファイルに直接上書き保存できるVS Code拡張機能</i>
</p>

<p align="center">
  <a href="#english">English</a> •
  <a href="#日本語-japanese">日本語</a> •
  <a href="#简体中文-chinese">简体中文</a> •
  <a href="#한국어-korean">한국어</a> •
  <a href="#tiếng-việt-vietnamese">Tiếng Việt</a> •
  <a href="#deutsch-german">Deutsch</a> •
  <a href="#español-spanish">Español</a> •
  <a href="#français-french">Français</a> •
  <a href="#हिन्दी-hindi">हिन्दी</a> •
  <a href="#italiano-italian">Italiano</a> •
  <a href="#português-portuguese">Português</a> •
  <a href="#русский-russian">Русский</a>
</p>

---

## Preview / プレビュー

<p align="center">
  <img src="./preview_demo.png" alt="Image Editor: Simple Crop Preview" width="100%">
</p>

---

## English

### Overview
**Image Editor: Simple Crop** provides a familiar and intuitive cropping experience inspired by Microsoft Excel's crop tool. Instead of complicated photo editing menus, you can adjust top, bottom, left, right edges and corners individually, then press `Cmd+S` to overwrite the file in place immediately.

### Key Features
- **Excel-style 8 Handles**: 4 corner L-handles for diagonal resizing, and 4 edge bars for individual edge adjustments.
- **⚙️ Settings Modal & Multi-Language (12 Languages)**: Configure Theme (Light/Dark) and Language (English, 日本語, 简体中文, 한국어, Español, Deutsch, Français, Tiếng Việt, हिन्दी, Italiano, Português, Русский) directly from the header settings button.
- **Persistent Light / Dark Theme**: Starts in Light theme by default, and automatically remembers your chosen theme (Dark/Light) across sessions.
- **Image Resize & Direct Crop Input**: Resize image dimensions with presets (25%–200%) or exact px, and directly type crop dimensions (W × H) with ratio locking.
- **Canvas Zoom Controls**: Zoom in/out (25%–400%) via footer controls, mouse wheel (Cmd/Ctrl + Wheel), and keyboard shortcuts.
- **Auto Reset to Full Image**: Automatically resets the crop box to cover the entire image upon saving or resetting.
- **Aspect Ratio Presets**: Switch easily between Free-form, 1:1 (Square), 16:9, and 4:3 modes.
- **Instant Overwrite**: Overwrite the original image file directly with `Cmd + S` or the "Save & Overwrite" button.
- **Lossless & Transparency Preserved**: Keeps PNG/WebP alpha transparency and high resolution intact.
- **Supported Formats**: PNG, JPG, JPEG, WEBP, BMP.

### How to Use
1. Right-click any image file in the VS Code Explorer.
2. Select **`Image Editor: Simple Crop`**.
3. Drag the corner L-handles or edge bars to trim unwanted borders, or enter exact W × H in the header.
4. Press **`Cmd + S`** (or click "Save & Overwrite") to update your image.

### Shortcuts
| Shortcut | Action |
|---|---|
| **Cmd + S** / **Ctrl + S** | Save & Overwrite original image |
| **Cmd + C** / **Ctrl + C** | Copy cropped image to clipboard |
| **Cmd + Wheel** / **Ctrl + Wheel** | Zoom In / Out |
| **Cmd + +** / **Ctrl + +** | Zoom In |
| **Cmd + -** / **Ctrl + -** | Zoom Out |
| **Cmd + 0** / **Ctrl + 0** | Reset Zoom to 100% |
| **1** | Switch to 1:1 (Square) ratio |
| **F** | Switch to Free-form ratio |
| **R** | Reset crop box to full image |
| **Esc** | Close modal or editor without saving |

---

## 日本語 (Japanese)

### 概要
**Image Editor: Simple Crop** は、Microsoft Excelの画像トリミングと同様の直感的な操作感を提供する画像切り抜き拡張機能です。余計な機能や複雑なレイヤー操作はなく、上下左右や四隅のハンドルを動かして `Cmd + S` を押すだけで、元画像に直接上書き保存できます。

### 主な特徴
- **Excel風の8方向ハンドル**: 斜め調整の「L字ハンドル」と、上下左右の辺を個別に詰められる「バーハンドル」を搭載。
- **⚙️ 設定モーダル & 多言語対応（12言語）**: ツールバー左側の設定アイコンから、テーマ（Light / Dark）と表示言語（日本語、英語、中国語、韓国語、スペイン語、ドイツ語、フランス語、ベトナム語、ヒンディー語、イタリア語、ポルトガル語、ロシア語の全12言語）を設定可能。
- **テーマ設定の固定・永続化**: デフォルトは「Light」。ユーザーがDark等に変更した場合は以降すべての画像で設定を自動維持。
- **サイズ変更・解像度リサイズ機能**: プリセット倍率（25%〜200%）や任意pxでの画像リサイズ、およびクロップサイズの直接px入力（W × H、縦横比固定ロック対応）。
- **フッターズーム機能**: ➖/➕ボタン、マウスホイール（Cmd/Ctrl + スクロール）、ショートカットで25%〜400%のズームに対応。
- **保存後の自動フルリセット**: 「Save & Overwrite」実行後、調整枠が自動的に新画像全体（100%）にフィットした状態にリセット。
- **多彩な比率プリセット**: 自由比率（Free）、1:1（正方形）、16:9、4:3をワンタップ切替。
- **ワンクリック上書き保存**: `Cmd + S` または保存ボタンで、元画像ファイルを即座に直接上書き。
- **透過と高画質を維持**: PNG/WebPの透明度（アルファチャンネル）や解像度を損なわずに保存。
- **対応形式**: PNG, JPG, JPEG, WEBP, BMP。

### 使い方
1. エクスプローラーで画像ファイルを **右クリック**。
2. **`Image Editor: Simple Crop`** を選択。
3. ハンドルをドラッグ、またはヘッダーのW/H数値を入力してトリミング範囲を調整（枠内ドラッグで位置移動）。
4. **`Cmd + S`** を押すと、元ファイルに上書き保存されます。

---

## 简体中文 (Chinese)

### 概述
**Image Editor: Simple Crop** 是一款轻量直观的图片裁剪与调整扩展，完美还原了类似 Microsoft Excel 的裁剪体验。没有复杂的多层编辑，支持自由裁剪、尺寸调整（Resize）、画布缩放（Zoom）与明暗主题切换，按下 `Cmd + S` 即可直接覆盖原图。

### 主要功能
- **Excel 风格 8 向手柄**：四角 L 型手柄支持对角缩放，四边居中条状手柄可单独裁剪上下左右边距。
- **浅色与深色主题切换**：一键在 Dark / Light 主题间切换，自动保存偏好。
- **图像缩放与精确尺寸输入**：支持按预设比例（25%–200%）或精确像素调整分辨率，并可直接在工具栏输入裁剪尺寸（W × H，支持比例锁定）。
- **底部画布缩放控制**：支持 25%–400% 缩放（➖/➕ 按钮、Cmd/Ctrl + 滚轮、快捷键）。
- **保存后自动重置为全图**：点击覆盖保存后，自动将裁剪框贴合到新图像全图。
- **丰富比例预设**：自由比例、1:1 正方形、16:9、4:3 一键切换。
- **一键覆盖保存**：通过 `Cmd + S` 或保存按钮，直接覆盖保存到原图片文件。
- **保留透明通道与原画质**：无损保留 PNG/WebP 的 Alpha 透明通道及高清分辨率。
- **支持格式**：PNG, JPG, JPEG, WEBP, BMP。

---

## 한국어 (Korean)

### 개요
**Image Editor: Simple Crop** 은 엑셀의 이미지 자르기와 같은 직관적인 조작감을 제공하는 간편한 이미지 편집·크롭 확장 기능입니다. 상하좌우 및 모서리 핸들을 조정하고, 크기 변경(Resize) 및 줌(Zoom) 기능과 함께 `Cmd + S`를 누르면 원본 파일에 즉시 덮어씌워집니다.

### 주요 기능
- **엑셀 스타일 8방향 핸들**: 사각 L자 핸들 및 상하좌우 바 핸들로 손쉬운 영역 조절.
- **Light / Dark 테마 전환**: 툴바 우측 버튼으로 손쉽게 라이트/다크 모드 전환 및 자동 기억.
- **해상도 리사이즈 및 픽셀 직접 입력**: 프리셋(25%~200%) 또는 px 단위 크기 조절, W × H 직접 입력 지원(비율 고정 가능).
- **하단 줌 컨트롤**: 25%~400% 확대/축소 지원(➖/➕ 버튼, Cmd/Ctrl + 휠, 단축키).
- **저장 후 전자동 풀리셋**: 저장 완료 후 크롭 영역이 새 이미지 전체(100%)로 자동 리셋.
- **다양한 비율 프리셋**: Free, 1:1, 16:9, 4:3 원터치 전환.
- **원클릭 덮어쓰기 저장**: `Cmd + S` 키로 원본 이미지에 바로 덮어쓰기 저장.
- **투명도 및 화질 유지**: PNG/WebP 투명 알파 채널 및 고해상도를 완벽 유지.

---

## Tiếng Việt (Vietnamese)

### Tổng quan
**Image Editor: Simple Crop** mang đến trải nghiệm cắt xén ảnh trực quan như trong Microsoft Excel ngay bên trong VS Code. Tích hợp tính năng đổi kích thước (Resize), thu phóng (Zoom), chuyển đổi giao diện Sáng/Tối, sau đó nhấn `Cmd + S` để lưu ghi đè trực tiếp lên tệp gốc.

### Tính năng chính
- **8 tay cầm theo phong cách Excel**: 4 tay cầm chữ L ở góc và 4 thanh ở các cạnh giúp tinh chỉnh chính xác.
- **Chuyển đổi giao diện Sáng / Tối**: Nút chuyển đổi nhanh Dark/Light và tự động ghi nhớ cài đặt.
- **Đổi kích thước ảnh & Nhập px trực tiếp**: Thay đổi kích thước (25%–200% hoặc px tùy ý), nhập trực tiếp kích thước cắt W × H.
- **Điều khiển thu phóng (Zoom)**: Phóng to/thu nhỏ 25%–400% ở chân trang (nút ➖/➕, Cmd/Ctrl + Cuộn chuột, phím tắt).
- **Tự động đặt lại toàn ảnh sau khi lưu**: Khung cắt tự động bao phủ toàn bộ ảnh mới sau khi lưu.
- **Các tỷ lệ đặt sẵn**: Chuyển đổi linh hoạt giữa Tự do, 1:1, 16:9, và 4:3.
- **Lưu đè nhanh chóng**: Nhấn `Cmd + S` để ghi đè ngay lập tức lên ảnh gốc.
- **Giữ nguyên độ trong suốt (Alpha)**: Không làm mất chất lượng gốc và nền trong suốt của PNG/WebP.

---

## Deutsch (German)

### Übersicht
**Image Editor: Simple Crop** bietet ein vertrautes Zuschneideerlebnis wie in Microsoft Excel. Passen Sie Kanten und Ecken an, skalieren Sie Bilder, zoomen Sie stufenlos und speichern Sie das Bild mit `Cmd + S` direkt über die Originaldatei.

### Hauptmerkmale
- **8 Griffe im Excel-Stil**: 4 L-Griffe an den Ecken und 4 Kantenleisten zum individuellen Zuschneiden.
- **Hell- & Dunkel-Modus**: Schnelles Umschalten zwischen Light- und Dark-Design mit automatischer Speicherung.
- **Größenänderung (Resize) & Pixel-Eingabe**: Bildgröße anpassen (Presets 25%–200% oder genaue px) und W × H direkt eingeben.
- **Zoom-Steuerung im Footer**: 25%–400% Zoom (Tasten ➖/➕, Cmd/Ctrl + Mausrad, Tastaturkürzel).
- **Automatischer Reset auf Vollbild**: Nach dem Speichern passt sich der Rahmen automatisch wieder dem gesamten neuen Bild an.
- **Seitenverhältnis-Vorlagen**: Schneller Wechsel zwischen Freiform, 1:1, 16:9 und 4:3.
- **Direktes Überschreiben**: Mit `Cmd + S` oder Tastendruck wird die Originaldatei sofort aktualisiert.
- **Transparenz bleibt erhalten**: Behält die ursprüngliche Qualität und PNG/WebP-Transparenz bei.

---

## Español (Spanish)

### Resumen
**Image Editor: Simple Crop** ofrece una experiencia de recorte intuitiva inspirada en Microsoft Excel dentro de VS Code. Con soporte para cambio de tamaño (Resize), zoom dinámico y temas Claro/Oscuro, presiona `Cmd + S` para sobrescribir el archivo original al instante.

### Características clave
- **8 controles estilo Excel**: 4 esquinas en forma de L y 4 barras en los bordes para un recorte preciso.
- **Tema Claro y Oscuro**: Alterna entre modos Light y Dark con persistencia automática.
- **Redimensionar y entrada directa de píxeles**: Cambia la resolución (25%–200% o px exactos) e ingresa W × H directamente con bloqueo de proporción.
- **Control de Zoom en el pie**: Zoom de 25% a 400% (botones ➖/➕, Cmd/Ctrl + Rueda, atajos).
- **Reinicio automático a imagen completa**: Tras guardar, el cuadro de recorte se reajusta automáticamente al 100% de la nueva imagen.
- **Ajustes preestablecidos de proporción**: Alterna entre Libre, 1:1, 16:9 y 4:3.
- **Sobrescribir al instante**: Guarda directamente sobre el archivo original con `Cmd + S`.
- **Conserva la transparencia**: Mantiene el canal alfa y la calidad original en archivos PNG/WebP.

---

## Français (French)

### Aperçu
**Image Editor: Simple Crop** offre un outil de recadrage intuitif inspiré de Microsoft Excel, enrichi d'un outil de redimensionnement, d'un zoom réglable et d'un basculement Thème Clair/Sombre. Appuyez sur `Cmd + S` pour écraser et sauvegarder directement le fichier source.

### Points forts
- **8 poignées de style Excel** : Poignées d'angle en L et barres latérales pour un contrôle optimal.
- **Bascule Thème Clair / Sombre** : Changez de thème en un clic avec mémorisation automatique.
- **Redimensionnement & Saisie directe en px** : Redimensionnez (25%–200% ou px précis) et saisissez les dimensions W × H directement.
- **Contrôles de zoom** : Zoom de 25% à 400% en pied de page (boutons ➖/➕, Cmd/Ctrl + Molette, raccourcis).
- **Réinitialisation automatique pleine image** : Le cadre s'ajuste automatiquement à 100% de l'image après sauvegarde.
- **Rapports d'aspect prédéfinis** : Basculez entre Libre, 1:1, 16:9 et 4:3.
- **Écrasement direct** : Sauvegarde instantanée sur le fichier original via `Cmd + S`.
- **Transparence conservée** : Conserve la résolution d'origine et la transparence alpha (PNG/WebP).

---

## हिन्दी (Hindi)

### विवरण
**Image Editor: Simple Crop** वीएस कोड के भीतर माइक्रोसॉफ्ट एक्सेल जैसी सरल और सहज इमेज क्रॉपिंग, रीसाइज़िंग और ज़ूम सुविधा प्रदान करता है। `Cmd + S` दबाकर सीधे मूल फ़ाइल पर ओवरराइट करें।

### मुख्य विशेषताएं
- **एक्सेल-शैली के 8 हैंडल**: 4 कोने वाले L-हैंडल और 4 साइड बार।
- **लाइट और डार्क थीम टॉगल**: एक क्लिक में थीम बदलें (सेटिंग्स स्वतः सहेजी जाती हैं)।
- **इमेज रीसाइज़ और डायरेक्ट पिक्सेल इनपुट**: 25%–200% या कस्टम px में आकार बदलें, सीधे W × H इनपुट करें।
- **फूटर ज़ूम नियंत्रण**: 25% से 400% तक ज़ूम (बटन, Cmd/Ctrl + व्हील, शॉर्टकट)।
- **सेव के बाद ऑटो फुल रीसेट**: सेव करने पर क्रॉप बॉक्स अपने आप पूरी इमेज पर सेट हो जाता है।
- **अनुपात प्रीसेट**: फ्री-फॉर्म, 1:1, 16:9 और 4:3 के बीच टॉगल करें।
- **त्वरित ओवरराइट**: `Cmd + S` से सीधे मूल छवि फ़ाइल पर सेव करें।
- **पारदर्शिता सुरक्षित**: PNG/WebP छवियों में पारदर्शिता और गुणवत्ता बरकरार रहती है।

---

## Italiano (Italian)

### Panoramica
**Image Editor: Simple Crop** offre uno strumento di ritaglio semplice e intuitivo ispirato a Microsoft Excel, completo di ridimensionamento, zoom e supporto per temi Chiaro/Scuro. Premi `Cmd + S` per sovrascrivere direttamente il file originale.

### Caratteristiche principali
- **8 maniglie stile Excel**: Maniglie ad angolo a L e barre sui bordi per la massima precisione.
- **Tema Chiaro e Scuro**: Passa facilmente tra modalità Light e Dark.
- **Ridimensionamento & Input px diretto**: Modifica la risoluzione (preset 25%–200% o px esatti) e imposta direttamente W × H.
- **Controllo Zoom a piè di pagina**: Zoom da 25% a 400% (pulsanti ➖/➕, Cmd/Ctrl + Rotella, scorciatoie).
- **Reset automatico a schermo intero**: Dopo il salvataggio il box di ritaglio si reimposta automaticamente all'intera nuova immagine.
- **Preimpostazioni proporzioni**: Libero, 1:1, 16:9 e 4:3 con un clic.
- **Sovrascrittura istantanea**: Salva direttamente sul file immagine originale con `Cmd + S`.
- **Mantiene la trasparenza**: Nessuna perdita di risoluzione o canale alfa per PNG e WebP.

---

## Português (Portuguese)

### Visão Geral
**Image Editor: Simple Crop** oferece uma experiência de corte direta inspirada no Microsoft Excel, com suporte a redimensionamento, zoom da tela e temas Claro/Escuro. Pressione `Cmd + S` para sobrescrever diretamente o arquivo original.

### Principais Recursos
- **8 alças estilo Excel**: 4 alças em L nos cantos e 4 barras laterais para ajuste fino.
- **Alternância de Tema Claro / Escuro**: Alterne entre modos Light e Dark com persistência automática.
- **Redimensionamento e Entrada Direta de Pixels**: Redimensione (25%–200% ou px exatos) e defina W × H diretamente.
- **Controles de Zoom**: Zoom de 25% a 400% no rodapé (botões ➖/➕, Cmd/Ctrl + Roda do mouse, atalhos).
- **Redefinição automática para imagem completa**: Após salvar, a área de corte volta a cobrir 100% da nova imagem.
- **Proporções pré-definidas**: Livre, 1:1, 16:9 e 4:3 com um clique.
- **Sobrescrita direta**: Salve e substitua o arquivo original instantaneamente com `Cmd + S`.
- **Preserva transparência e qualidade**: Mantém o canal alfa e resolução original de imagens PNG/WebP.

---

## Русский (Russian)

### Обзор
**Image Editor: Simple Crop** — это расширение для быстрой обрезки, масштабирования (Resize) и зумирования изображений в стиле Microsoft Excel прямо в VS Code. Поддерживает переключение тем, точный ввод пикселей и сохранение по `Cmd + S`.

### Основные возможности
- **8 маркеров в стиле Excel**: Угловые L-маркеры и полосы на краях для точной подгонки.
- **Переключение светлой и темной темы**: Мгновенное переключение Light/Dark с автосохранением.
- **Изменение размера и прямой ввод px**: Масштабирование разрешения (25%–200% или точные px) и прямой ввод W × H.
- **Управление масштабом (Zoom)**: Зум 25%–400% в футере (кнопки ➖/➕, Cmd/Ctrl + Колесо, горячие клавиши).
- **Автосброс рамки на полное изображение**: После сохранения рамка автоматически охватывает всё новое изображение.
- **Готовые пропорции**: Быстрый выбор между свободным соотношением, 1:1, 16:9 и 4:3.
- **Прямая перезапись**: Мгновенно сохраняет изменения в исходный файл по нажатию `Cmd + S`.
- **Сохранение прозрачности**: Полностью сохраняет альфа-канал и исходное разрешение (PNG/WebP).

---

## License
MIT
