# Base64 Link Opener

右クリックした選択文字列を Base64 / Base64URL として decode し、安全なURLを抽出して開く Chrome 拡張です。

## 改良点

- **2つの右クリック操作**
  - `Base64をdecodeして開く`
  - `Base64をdecodeして結果を確認`
- **候補抽出を改善**
  - 選択範囲全体だけでなく、その中に含まれる Base64 っぽいトークンも自動抽出
  - JWT 形式 (`aaa.bbb.ccc`) の payload も decode を試行
  - `%` エンコードされた候補も追加で試行
- **結果表示を強化**
  - 安全なURLを複数件一覧表示
  - ブロックしたURLと理由を表示
  - 候補ごとの pass ごとの decode 結果を確認可能
- **設定ページを追加**
  - 1件だけ安全なURLが見つかったときの自動オープンのON/OFF
  - バックグラウンドで開くかどうか
  - 最大 decode 回数
  - `http:` / `https:` / `magnet:` の許可設定
- **保存先を整理**
  - 設定は `storage.sync`
  - 最新の decode 結果は `storage.session`

## できること

- 選択文字列を右クリックして decode
- 通常の Base64 と URL-safe Base64 を両対応
- パディング省略 (`=` なし) も補完
- 1〜5回の decode を設定可能（初期値 3）
- decode 後に URL / JSON 内 URL / `%3A` 付きURL / JWT payload 内URL を抽出
- `javascript:` / `data:` / `file:` などは開かない

## インストール

1. Chrome で `chrome://extensions` を開く
2. 右上の **デベロッパー モード** を ON
3. **「パッケージ化されていない拡張機能を読み込む」** を押す
4. このフォルダ `base64-link-opener` を選ぶ

## 使い方

1. ページ上の Base64 文字列（またはその周辺テキスト）を選択
2. 右クリック
3. 次のどちらかを選ぶ
   - **「Base64をdecodeして開く」**
   - **「Base64をdecodeして結果を確認」**
4. 安全なURLが1件だけ見つかれば、新しいタブで開く
5. 複数候補や危険なschemeがある場合は結果ページで確認

## 設定

拡張のオプションページから次を変更できます。

- 自動で開くか
- バックグラウンドで開くか
- 最大 decode 回数
- 許可するscheme
- URLコンテナ検査や URL デコード補助を使うか

## 補足

- 既定では `https:` と `magnet:` を許可し、`http:` はOFFです。
- 最新のdecode結果はブラウザセッション中だけ保持します。
