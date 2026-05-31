# Installing Mindcraft

Welcome! This guide will get Mindcraft running — no technical experience needed.

---

## What you need before starting

1. **A computer** running Windows, macOS, or Linux
2. **Minecraft Java Edition** — version 1.20.1 is the safest choice; newer versions are also supported
3. **An AI model** — choose one:
   - **Ollama** (free, runs on your computer) — recommended for beginners
   - **OpenAI** (ChatGPT) — requires a paid API key
   - **Anthropic** (Claude) — requires a paid API key

---

## Step 1 — Install Node.js

Mindcraft needs Node.js 20 or newer to run. If you already have it, skip this step.

1. Open your browser and go to **https://nodejs.org**
2. Click the big **"LTS"** download button
3. Run the installer and follow the steps (click Next, Next, Install)
4. When it finishes, **restart your computer**

To check it installed correctly, open a terminal and type:
```
node --version
```
You should see something like `v20.x.x` or higher.

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
git clone https://github.com/BattledGamerCF/CraftMind-AI.git
```

---

## Step 3 — Install dependencies

This step downloads the code libraries Mindcraft needs. You only need to do this once.

1. Open the Mindcraft folder
2. Open a terminal window inside it:
   - **Windows:** Hold Shift and right-click inside the folder → **Open PowerShell window here**
   - **macOS:** Right-click the folder → **New Terminal at Folder** (or open Terminal and drag the folder in)
   - **Linux:** Right-click inside the folder → **Open Terminal**
3. Type this command and press Enter:
   ```
   npm install -g pnpm
   ```
4. Then type this and press Enter:
   ```
   pnpm install
   ```
5. Wait for it to finish (may take 1–2 minutes on first run)

---

## Step 4 — Start Mindcraft for the first time

You can skip straight to launching — Mindcraft will auto-configure itself.

### Windows

Double-click **`Mindcraft.bat`**

A terminal window opens. Wait until it says **"Mindcraft is running!"** — your browser will open automatically.

### macOS

Double-click **`Mindcraft.command`**

> If macOS says "the developer cannot be verified": right-click the file → **Open** → **Open**

### Linux

Open a terminal in the Mindcraft folder and run:
```
bash Mindcraft.sh
```

**What happens on first launch:**
- A `.env` configuration file is created automatically from the template
- Both the API server and dashboard start
- Your browser opens to `http://localhost:3000/`
- A welcome screen guides you through connecting your first bot

---

## Step 5 — Set up your AI provider

If you are using **Ollama** (recommended — free and private):

1. Go to **https://ollama.com** and install Ollama
2. Once installed, open a terminal and run:
   ```
   ollama pull llama3.2
   ```
3. Ollama starts automatically in the background — Mindcraft will find it

If you are using **OpenAI or Anthropic** (cloud, paid):

1. Stop Mindcraft (Ctrl+C in the terminal window)
2. Open the `.env` file in the Mindcraft folder with any text editor (Notepad on Windows, TextEdit on macOS)
   - On Windows: open File Explorer → View → check "Hidden items" if you can't see `.env`
3. Find the line for your provider:
   - OpenAI: `# OPENAI_API_KEY=sk-...`
   - Anthropic: `# ANTHROPIC_API_KEY=sk-ant-...`
4. Remove the `#` at the start and replace `sk-...` with your actual API key
5. Save the file and start Mindcraft again

---

## Step 6 — Connect your first bot

Once the dashboard is open in your browser:

1. Start your Minecraft Java Edition game
2. Open a world (Singleplayer works — in the pause menu, click **Open to LAN** → **Start LAN World**)
3. Back in the dashboard, click **+ New Bot**
4. Fill in:
   - **Host:** `localhost`
   - **Bot Username:** anything you like (e.g. `MindBot`)
   - **Provider:** choose your AI (pick **Ollama** if you followed Step 5A above)
5. Click **Connect Bot**

Your bot will join the game. You'll see it appear in the sidebar.

---

## Troubleshooting

### "Node.js is not installed" or "Node.js 20 or higher is required"
Follow Step 1. Make sure to restart your computer after installing.

### "Dependencies are not installed"
Follow Step 3. Run `pnpm install` from inside the Mindcraft folder.

### "Port 8080 is already in use"
Another program is using that port. To use a different port:
1. Open `.env` in a text editor
2. Add or change this line: `API_PORT=8081`
3. Save and start Mindcraft again

To change the dashboard port (if port 3000 is taken):
- Add `DASH_PORT=3001` to `.env`

### The bot can't connect to Minecraft
- Make sure Minecraft is running and the world is open
- In Singleplayer, pause the game → **Open to LAN** → **Start LAN World**
- Use `localhost` as the Host

### "API offline" badge in the dashboard
The API server isn't running. Start Mindcraft again using the launcher file.

### The browser didn't open automatically
Look in the terminal window for a line like:
```
  Dashboard: http://localhost:3000/
```
Copy that URL and paste it into your browser.

### Ollama model not found
After installing Ollama, open a terminal and run:
```
ollama pull llama3.2
```
Then try creating the bot again.

---

## Stopping Mindcraft

Click the terminal window that is running Mindcraft and press **Ctrl + C**.

All services shut down cleanly.

---

## Keeping Mindcraft up to date

### If you downloaded a ZIP
Download the new version from GitHub, unzip it, and copy your `.env` file from the old folder into the new one to keep your settings.

### If you used Git
Open a terminal in the Mindcraft folder and run:
```
git pull
pnpm install
```

---

## Getting help

- Check **README.md** for technical documentation
- Open an issue on GitHub if something isn't working

---

*Mindcraft — AI companions for Minecraft*
