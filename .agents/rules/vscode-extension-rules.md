# VS Code Webview & Extension 実装・検証ルール

## 1. Webview 内スクリプトのテンプレートリテラル文字列規則（構文エラー防止）
- **アポストロフィ・引用符の記述**:
  - `getWebviewContent` は全体がバッククォート `` ` `` で囲まれたテンプレートリテラルであるため、内部の `<script>` で `\'` と書いても、テンプレート展開時にただの `'` にデコードされる。
  - アポストロフィ（シングルクォート `'`）を含む文字列（フランス語 `l'image`、イタリア語 `dall'immagine`、英語 `don't` など）は、**必ず二重引用符 `"` で囲む**こと。
  - または `\"` や `\u0027`、`\\'` を使用してエスケープを2重化すること。
- **Webview スクリプトの全言語構文検証**:
  - コード変更後は必ず `npm test`（または `npm run lint`）を実行し、`test/verify-webview.js` により全12言語で Webview 内の `<script>` に構文エラー（SyntaxError）が発生しないことを自動検証すること。

## 2. package.json のアクティベーション宣言ルール
- **VS Code ^1.75.0 以降の仕様**:
  - `engines.vscode` が `"^1.75.0"` 以上の拡張機能では、`contributes.commands` や `contributes.customEditors` からアクティベーションイベントが自動生成される。
  - `package.json` に明示的な `"activationEvents"`（`onCommand:...`, `onCustomEditor:...`）を記述してはならない（冗長な警告が出るため省略すること）。

## 3. DOM 初期化と安全な要素アクセス規則
- **防御的プログラミング**:
  - `document.getElementById(...)` で取得した要素に対し、直接 `.innerText` や `.innerHTML`、イベントリスナーを登録する際は、`null` チェックまたは `setInnerText(id, val)` などのヘルパー関数を必ず経由すること。
  - 存在しない要素へのプロパティアクセスでスクリプト全体の実行が停止する事故を未然に防ぐこと。

## 4. リリース前の品質ゲート
- 変更完了時は以下を必ず実行し、エラー 0 件であることを確認すること:
  1. `npm run lint`（`node -c extension.js` および `node test/verify-webview.js`）
  2. `npx @vscode/vsce package --allow-missing-repository`（パッケージング時の警告確認）
