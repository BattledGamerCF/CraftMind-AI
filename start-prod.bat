@echo off
REM Mindcraft production launcher for Windows
REM Builds from source then runs the compiled output.

if exist .env (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" if not "%%A:~0,1%"=="#" set "%%A=%%B"
  )
)

if not defined PORT set PORT=8080
set NODE_ENV=production

echo Building Mindcraft...
pnpm --filter @workspace/api-server run build
if errorlevel 1 (
  echo Build failed.
  exit /b 1
)

echo Starting Mindcraft (prod) on port %PORT%...
node --enable-source-maps artifacts/api-server/dist/index.mjs
