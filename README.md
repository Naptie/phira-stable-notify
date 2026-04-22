# phira-stable-notify

基于 Node.js 与 node-napcat-ts 的应用程序，用于 Phira 谱面上架申请提醒事务。

`config.json` 内容如下：

```jsonc
{
  "napcatWs": "ws://127.0.0.1:3001",
  "napcatToken": "token",
  "groups": [12345678],
  "thresholds": {
    "approvals": 3,
    "denials": 0
  },
  "intervalMillis": 60000
}
```
