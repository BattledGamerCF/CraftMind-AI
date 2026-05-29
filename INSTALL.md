# Installing Mindcraft

Welcome! This guide will help you get Mindcraft running — no technical experience needed.

---

## What you need before starting

1. **A computer** running Windows, macOS, or Linux
2. **Minecraft Java Edition** (any recent version)
3. **An AI model** — choose one:
   - **Ollama** (free, runs on your computer) — recommended for beginners
   - **OpenAI** (ChatGPT) — requires a paid API key
   - **Anthropic** (Claude) — requires a paid API key

---

## Step 1 — Install Node.js

Mindcraft needs Node.js to run. If you already have it, skip this step.

1. Open your browser and go to **https://nodejs.org**
2. Click the big green **"LTS"** download button
3. Run the installer and follow the steps (click Next, Next, Install)
4. When it finishes, restart your computer

---

## Step 2 — Download Mindcraft

### Option A — From GitHub (recommended)

1. Go to the Mindcraft GitHub page
2. Click the green **Code** button
3. Click **Download ZIP**
4. Open your Downloads folder and double-click the ZIP to unzip it
5. Move the unzipped folder somewhere you'll remember (e.g. your Desktop or Documents)

### Option B — With Git

If you know what Git is:
```
git clone https://github.com/your-org/mindcraft.git
```

---

## Step 3 — Install dependencies

This step downloads the code libraries Mindcraft needs.

1. Open the Mindcraft folder
2. Hold **Shift** and right-click inside the folder → **Open PowerShell window here** (Windows)
   — or — right-click the folder on macOS and choose **New Terminal at Folder**
3. Type this command and press Enter:
   ```
   npm install -g pnpm
   ```
4. Then type this and press Enter:
   ```
   pnpm install
   ```
5. Wait for it to finish (it may take a minute)

---

## Step 4 — Set up your AI provider

### If you're using Ollama (free, local)

1. Go to **https://ollama.com** and download Ollama
2. Install it and open it — it runs in your system tray
3. Open a terminal and run:
   ```
   ollama pull llama3.2
   ```
4. That's it — Mindcraft will find Ollama automatically

### If you're using OpenAI or Anthropic

1. Open the Mindcraft folder
2. Find the file called **`.env`** (it was created automatically on first run)
   - On Windows: open File Explorer, click View, check "Hidden items"
3. Open `.env` in Notepad or any text editor
4. Find the line with `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`
5. Replace the `...` with your actual API key
6. Save the file

---

## Step 5 — Start Mindcraft

### Windows

Double-click **`Mindcraft.bat`**

A black window will open. Wait for it to say **"Mindcraft is running!"** — your browser will open automatically.

### macOS

Double-click **`Mindcraft.command`**

> If macOS says it can't be opened because the developer is unknown:
> Right-click the file → Open → Open

### Linux

Open a terminal in the Mindcraft folder and run:
```
bash Mindcraft.sh
```

---

## Step 6 — Connect your first bot

Once the dashboard opens in your browser:

1. Start your Minecraft Java Edition game
2. Open a world (Singleplayer works fine — enable LAN in the pause menu)
3. In the Mindcraft dashboard, click **+ New Bot**
4. Fill in:
   - **Host:** `localhost` (or your server's address)
   - **Bot Username:** anything you like (e.g. `MindBot`)
   - **Provider:** choose your AI (Ollama if you followed Step 4A)
5. Click **Connect Bot**

Your bot will join the game. You'll see it appear in the bot list.

---

## Troubleshooting

### "Node.js is not installed"
Follow Step 1 and restart your computer after installing.

### "Dependencies are not installed"
Follow Step 3.

### "Port 8080 is already in use"
Something else is using that port. You can change the port:
- Open `.env` in a text editor
- Add a line: `PORT=8081`
- Try starting again

### The bot can't connect to Minecraft
- Make sure Minecraft is running and the world is open
- If using Singleplayer, pause and click **Open to LAN** → **Start LAN World**
- Check that the **Host** field says `localhost`

### "API offline" badge in the dashboard
The server part of Mindcraft isn't running. Close the browser tab and restart using the launcher file.

### The browser didn't open automatically
Look at the terminal window for a line that says **"Dashboard: http://localhost:3000"** and open that URL yourself.

---

## Stopping Mindcraft

Click on the terminal/PowerShell window that's running Mindcraft and press **Ctrl + C**.

Everything will shut down cleanly.

---

## Keeping Mindcraft up to date

### If you downloaded a ZIP
Download the new ZIP from GitHub and replace the old folder.

### If you used Git
Open a terminal in the Mindcraft folder and run:
```
git pull
pnpm install
```

---

## Getting help

- Check the **README.md** file in the Mindcraft folder for technical details
- Open an issue on GitHub if something isn't working

---

*Mindcraft — AI companions for Minecraft*
