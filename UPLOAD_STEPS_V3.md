# v3 アップロード手順

## 絶対ルール

GitHubには、この `UPLOAD_THIS_CONTENTS` フォルダの **中身だけ** をアップロードします。

`UPLOAD_THIS_CONTENTS` フォルダそのものをアップロードしないでください。

## 手順

1. zipを展開する
2. 展開後の `github-upload-safe-v3` フォルダを開く
3. その中の `UPLOAD_THIS_CONTENTS` フォルダを開く
4. `UPLOAD_THIS_CONTENTS` の中身を全部選択する
5. GitHubの新しいリポジトリ `katekyo-notification-portal-v3` を開く
6. `Add file` -> `Upload files`
7. 選択した中身をドラッグ&ドロップする
8. `Commit changes`

## GitHubトップに見えていればOK

```text
ARCHITECTURE_REVIEW.html
ARCHITECTURE_REVIEW.md
README.md
UPLOAD_STEPS_V3.md
preview-manager
```

## GitHubトップに見えていたらNG

```text
browser.js
index.html
index.js
package.json
styles.css
app.js
server.js
scripts
api
UPLOAD_THIS_CONTENTS
```

## preview-manager/public の中身

ここは以下の5つだけになっていればOKです。

```text
browser.js
index.html
index.js
package.json
styles.css
```

## Vercel設定

Root Directory:

```text
preview-manager/public
```

