const fs = require('fs');
const path = require('path');

// 1. Read extension.js
const extPath = path.join(__dirname, '..', 'extension.js');
const extCode = fs.readFileSync(extPath, 'utf8');

// 2. Extract getWebviewContent function
const start = extCode.indexOf('function getWebviewContent');
const end = extCode.lastIndexOf('module.exports = {');
if (start === -1 || end === -1) {
  console.error('❌ Could not locate getWebviewContent in extension.js');
  process.exit(1);
}
const funcStr = extCode.substring(start, end);
eval(funcStr);

if (typeof getWebviewContent !== 'function') {
  console.error('❌ getWebviewContent evaluation failed');
  process.exit(1);
}

// 3. Languages to verify
const languages = ['en', 'ja', 'zh', 'ko', 'es', 'de', 'fr', 'vi', 'hi', 'it', 'pt', 'ru'];
let hasError = false;

console.log('🔍 [Rule Verification] Testing Webview generation & Script syntax across all languages...');

for (const lang of languages) {
  try {
    const html = getWebviewContent('sample.png', 'image/png', 'data:image/png;base64,abc', {
      theme: 'light',
      language: lang,
      isReadOnly: false,
      scheme: 'file'
    });

    const scriptStart = html.indexOf('<script>') + 8;
    const scriptEnd = html.indexOf('</script>');
    if (scriptStart === -1 || scriptEnd === -1) {
      throw new Error('Missing <script> tag in generated HTML');
    }
    const scriptCode = html.substring(scriptStart, scriptEnd);

    // Validate JavaScript syntax in the generated script block
    new Function(scriptCode);
    console.log(`  ✅ [${lang}] Webview script syntax OK`);
  } catch (err) {
    console.error(`  ❌ [${lang}] Syntax/Runtime Error in generated Webview script:`, err.message);
    hasError = true;
  }
}

// 3. Verify custom style persistence injection
try {
  const customStyle = {
    strokeColor: '#0078d4',
    strokeWidth: 10,
    fillColor: '#ffff00',
    fontSize: 44,
    fontWeight: 'normal'
  };
  const htmlWithStyle = getWebviewContent('sample.png', 'image/png', 'data:image/png;base64,abc', {
    theme: 'dark',
    language: 'ja',
    style: customStyle,
    isReadOnly: false,
    scheme: 'file'
  });
  if (!htmlWithStyle.includes('"#0078d4"') || !htmlWithStyle.includes('"#ffff00"')) {
    throw new Error('Custom style was not properly embedded in Webview HTML');
  }
  const scriptStart = htmlWithStyle.indexOf('<script>') + 8;
  const scriptEnd = htmlWithStyle.indexOf('</script>');
  const scriptCode = htmlWithStyle.substring(scriptStart, scriptEnd);
  new Function(scriptCode);
  if (!htmlWithStyle.includes('annotation-rotate-handle') || !htmlWithStyle.includes('copySelectedAnnotation')) {
    throw new Error('Rotation handles or copy/paste functions missing from Webview script');
  }
  console.log('  ✅ [Style Persistence] Custom style injection & Webview script syntax OK');
  console.log('  ✅ [Rotation & CopyPaste] Functions and handles verified');
} catch (err) {
  console.error('  ❌ [Style Persistence] Error:', err.message);
  hasError = true;
}

// 4. Verify package.json rules (engines >= 1.75.0 should not have redundant activationEvents)
const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.engines && pkg.engines.vscode && pkg.engines.vscode.startsWith('^1.75')) {
  if (pkg.activationEvents && pkg.activationEvents.length > 0) {
    console.error('  ❌ package.json has activationEvents that should be omitted for engines ^1.75.0');
    hasError = true;
  } else {
    console.log('  ✅ package.json activationEvents rule OK');
  }
}

if (hasError) {
  console.error('\n❌ Verification failed! Fix Webview template strings or package rules before packaging.');
  process.exit(1);
} else {
  console.log('\n🎉 All Webview & package rules passed successfully!');
}
