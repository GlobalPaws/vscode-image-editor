# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.1] - 2026-10-24

### Added
- **Rotation Handle for Shapes & Text**: Drag rotation handle (`⟳`) to rotate shapes and text to any angle, with 15° snapping via Shift key, fully reflected on canvas export.
- **Copy & Paste for Annotations**: Copy selected shape or text with `Cmd+C` / `Ctrl+C` and paste with `Cmd+V` / `Ctrl+V`, integrated with right-click context menu.

### Fixed
- **Default Text Font Size**: Fixed initial text font size to 18px and eliminated redundant outer focus frame during inline text editing.
- **Style Persistence**: Ensured stroke width, colors, and typography settings persist across different images and editor sessions.

## [1.6.0] - 2026-10-24

### Added
- **Mac-style Markup & Annotations**: Support shapes (Rectangle, Rounded Rectangle, Ellipse, Arrow, Line) and Text annotations.
- **macOS-Style Color Palette & Eyedropper**: 12-color quick swatches, grayscale & hue gradient picker, transparent option, and canvas Eyedropper tool.
- **Sidebar-based Inspector Layout**: Redesigned right-side collapsible panel for crop, shapes, styling, and action controls.
- **Style Persistence**: Stroke width, stroke color, fill color, and text font settings persist across images and editor sessions via `globalState`.
- **12 Languages & Dark/Light Themes**: Comprehensive localization with instant UI preview.
- **Undo / Redo & Save Undo**: Full history stack for annotations and file-level overwrite save recovery.
- **Automated Webview Syntax Verification**: Test suite verifying generated script syntax across all 12 languages.

## [1.5.1] - 2026-09-08

### Added
- Circle crop mode (transparent outer area)
- Image 90-degree rotation (left/right)
- Rounded corner crop (corner radius R control)

## [1.4.2] - 2026-09-07

### Added
- Right-click context menu "Copy" (`Cmd+C` / `Ctrl+C`)
- Transparent icon design refresh

## [1.4.1] - 2026-09-07

### Added
- Multi-language support (12 languages) in Settings modal
- Real-time preview update upon setting changes

## [1.3.0] - 2026-09-06

### Added
- Persistent Light/Dark theme switching
- Resize image modal with preset percentages and exact dimensions
- Crop dimensions stepper controls (W × H) and ratio locking

## [1.2.0] - 2026-09-06

### Added
- Custom Editor API support (`vscode.openWith` and default editor association)
