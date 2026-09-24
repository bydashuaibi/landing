@echo off
REM ===========================================================================
REM  Landing - repair the pet's local model (restart Ollama + preload model)
REM
REM  WHEN TO RUN:  the pet bubble says "local model not responding" / it just
REM  keeps showing the thinking state.
REM
REM  WHY THIS HAPPENS (measured 2026-09-24 on this machine, Ollama 0.34.3):
REM  Ollama's runner survives only the FIRST model load of a server session.
REM  Every re-load after the model was unloaded dies in 0.3s with
REM  "llama-server process has terminated: exit status 1".
REM  Fixes applied:
REM    * OLLAMA_KEEP_ALIVE=-1  -> the model stays resident, so a re-load is
REM      never needed         (already set as a user env var)
REM    * this script           -> a clean restart = fresh session whose first
REM      load always works, then preloads the model again
REM  Not affected: model files, arguments, ports, free RAM - all verified fine.
REM  The same runner loads the same model correctly when started by hand.
REM ===========================================================================
setlocal
set "OLLAMA_DIR=%LOCALAPPDATA%\Programs\Ollama"
set "MODEL=pet-cpu:1.5b"

echo.
echo [1/3] Stopping Ollama ...
taskkill /F /IM "ollama app.exe" >nul 2>&1
taskkill /F /IM ollama.exe        >nul 2>&1
taskkill /F /IM llama-server.exe  >nul 2>&1
timeout /t 3 /nobreak >nul

echo [2/3] Starting Ollama ...
start "" "%OLLAMA_DIR%\ollama app.exe"
timeout /t 12 /nobreak >nul

echo [3/3] Preloading %MODEL% ...
"%OLLAMA_DIR%\ollama.exe" run %MODEL% "hi" >nul 2>&1

echo.
"%OLLAMA_DIR%\ollama.exe" ps
echo.
echo OK if PROCESSOR shows "100%% CPU" and UNTIL shows "Forever".
echo Then go back to Landing and talk to your pet again.
echo.
pause
