# 行程大侦探 · 在线 Demo(纯静态)

浏览器直接调用 OpenAI 兼容接口的纯前端版本,用于在线演示。
不含任何后端,API Key 只存在访客自己的浏览器里。

## 文件

```
web-demo/
├── index.html          首页
├── css/ink.css         水墨样式(与本地版一致)
├── js/prompt.js        系统提示词(由 backend/prompt.py 同步生成)
├── js/app.js           前端逻辑:直连接口 + 渲染
└── .nojekyll           告诉 GitHub Pages 不要用 Jekyll 处理
```

## 本地预览

任选一种静态服务器(必须用 http,不能直接双击 file:// 打开):

```bat
:: 方式一:Python
python -m http.server 8080
:: 方式二:任意静态服务器

:: 然后浏览器打开 http://127.0.0.1:8080
```

## 部署到 GitHub Pages

1. 新建公开仓库:`trip-detective-demo`
2. 把本目录(`web-demo/` 内的全部文件)推到仓库根目录:
   ```bat
   cd web-demo
   git init
   git add .
   git commit -m "行程大侦探 online demo"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/trip-detective-demo.git
   git push -u origin main
   ```
   > 注意:推的是 `web-demo/` 里的内容(仓库根应能直接看到 index.html)。
3. 仓库 → Settings → Pages → Source 选 `Deploy from a branch`,
   Branch 选 `main` / `(root)` → Save
4. 等 1–2 分钟,链接:
   `https://<你的用户名>.github.io/trip-detective-demo/`

## 现场演示

打开链接后:
1. 在顶部「API Key」填自己的 DeepSeek Key(地址与模型已预填,可改)
2. 输入一句旅行需求,例如:
   「我下周末带爸妈去杭州,2天1晚,预算1500,爸爸爱喝茶,妈妈爱拍照」
3. 查看线索清单、矛盾裁决、预算账本、方案对照,并可导出 Markdown

## 重要提醒

- **必须用支持跨域的接口**。DeepSeek 的 `api.deepseek.com` 支持浏览器直连;
  若换用其它接口出现「无法连接(跨域被拦截)」,说明该接口不允许浏览器直连,
  需要改用允许 CORS 的地址或自建代理。
- 每次重新部署前,若改过 `backend/prompt.py`,请重新生成 `js/prompt.js`:
  ```bat
  cd ..
  "E:\Miniconda3\envs\ai-api-env\python.exe" -c "import json,sys; sys.path.insert(0,'.'); from backend.prompt import SYSTEM_PROMPT, DEFAULT_API_URL, DEFAULT_MODEL; open('web-demo/js/prompt.js','w',encoding='utf-8').write('// 自动生成\nconst SYSTEM_PROMPT = ' + json.dumps(SYSTEM_PROMPT, ensure_ascii=False) + ';\nconst DEFAULT_API_URL = ' + json.dumps(DEFAULT_API_URL, ensure_ascii=False) + ';\nconst DEFAULT_MODEL = ' + json.dumps(DEFAULT_MODEL, ensure_ascii=False) + ';\n')"
  ```
- Key 仅存访客浏览器,页面不收集、不上传。
