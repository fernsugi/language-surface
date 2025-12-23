# 🌐 Language Surface

Try it live <https://fernsugi.github.io/language-surface>

**Language Surface** is a lightweight, local-first translation management tool  
built for developers who want **simplicity, control, and zero backend**.

It runs entirely in your browser using **HTML, CSS, and Vanilla JavaScript**  
and is designed to be hosted on **GitHub Pages** or any static file host.

---

## ✨ Features

### 📁 Projects
- Default project on first launch
- Create, rename, duplicate, and delete projects
- Switch projects via dropdown

### 🌍 Languages & Keys
- Dot-notation keys (`lp.hello`)
- Unlimited languages per project
- Add/remove languages globally
- Select which languages to show in list view

### ✏️ Editing
- List view for quick scanning
- Detail view for full editing
- Add/delete keys with confirmation
- Clean, modern UI

### 📥 Import
- CSV or JSON OR TXT
- Automatic validation
- Prompted project naming
- Uses filename if name is empty

### 📤 Export
- CSV
- Single nested JSON
- Multiple JSON files (one per language)

### 🤖 AI Translation (Optional)
- Bring your own OpenAI API key
- Per-field AI translation
- Bulk translate one language at a time
- Optional max character limit per translation
- Preserves placeholders (`{}`, `%s`, etc.)

### ⚙️ Settings
- API key (stored locally)
- Model selection
- Default source language
- Default max character limit
- Light / Dark mode
- Confirm delete toggle

---

## 🧠 Local-First Philosophy

> **All data is stored locally in your browser using `localStorage`.**

- No servers
- No database
- No tracking
- No analytics
- No accounts

You own your data — export it anytime.

---

## ⚠️ Security Notice (IMPORTANT)

This app allows you to store an **API key in your browser** to enable AI translation.

- The key is stored **only in `localStorage`**
- It is **never sent anywhere except directly to OpenAI**
- There is **no backend**

⚠️ **Use at your own risk.**
If you are concerned about key exposure:
- Use a restricted or temporary API key
- Or fork the project and add your own proxy backend

---

## 🧪 Supported File Formats

### CSV
```csv
key,en,ja
lp.hello,Hello,こんにちは
lp.bye,Good Bye,さようなら
```

### Single JSON
```json
{
  "lp": {
    "hello": { "en": "Hello", "ja": "こんにちは" },
    "bye":   { "en": "Good Bye", "ja": "さようなら" }
  }
}
```

### Multiple JSON
```json
// project_en.json
{
  "lp": {
    "hello": "Hello",
    "bye": "Good Bye"
  }
}
```

```json
// project_ja.json
{
  "lp": {
    "hello": "こんにちは",
    "bye": "さようなら"
  }
}
```

## 🚀 Getting Started

1. Clone or fork the repository
2. Open index.html locally or
3. Deploy to GitHub Pages
4. No build step required.

## 🛠 Tech Stack

- HTML
- CSS
- Vanilla JavaScript
- LocalStorage
- OpenAI Responses API (optional)

## 📄 License

MIT License — free to use, modify, and distribute.

## 💡 Inspiration
Language Surface is built for:

- Indie devs
- Game localization
- App UI translation
- Static site localization
- Anyone tired of bloated translation tools

Enjoy ✨

Contributions and ideas are welcome.

---
