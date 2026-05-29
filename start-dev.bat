@echo off
REM Mindcraft dev launcher for Windows
REM Creates .env from .env.example if missing, then starts the dev server.

if exist .env (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" if not "%%A:~0,1%"=="#" set "%%A=%%B"
  )
)

if not defined PORT set PORT=8080
if not defined NODE_ENV set NODE_ENV=development

echo Starting Mindcraft (dev) on port %PORT%...
pnpm --filter @workspace/api-server run dev
