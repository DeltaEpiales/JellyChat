@echo off
setlocal
echo =======================================
echo Tailchat Release Builder
echo =======================================
echo.

echo [1/5] Building frontend...
cd frontend
call npm install
call npm run build
if %errorlevel% neq 0 (
    echo Frontend build failed!
    exit /b %errorlevel%
)
cd ..

echo [2/5] Preparing backend assets...
cd backend
if exist public rmdir /s /q public
mkdir public
xcopy /s /y ..\frontend\dist\* public\

echo [3/5] Updating backend package.json for pkg...
node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync('package.json')); pkg.pkg={scripts:[],assets:['public/**/*']}; pkg.bin='server.js'; fs.writeFileSync('package.json',JSON.stringify(pkg,null,2));"

echo [4/5] Installing pkg and building executable...
call npm install -g pkg
call npm install
call pkg . -t node18-win-x64 -o JellyChat.exe
if %errorlevel% neq 0 (
    echo PKG build failed!
    exit /b %errorlevel%
)

echo [5/5] Copying native modules (sqlite3)...
if not exist release_out mkdir release_out
move JellyChat.exe release_out\
copy node_modules\sqlite3\build\Release\node_sqlite3.node release_out\

echo.
echo =======================================
echo BUILD COMPLETE!

echo [6/6] Applying JellyChat Icon...
call npm install -g png-to-ico rcedit
if exist ..\frontend\public\icon.png (
    call npx png-to-ico ..\frontend\public\icon.png > release_out\icon.ico
    call npx rcedit release_out\JellyChat.exe --set-icon release_out\icon.ico
) else (
    echo Icon not found in ..\frontend\public\icon.png, skipping icon injection.
)

echo [7/7] Bundling Tailscale Installer...
if not exist release_out\tailscale-setup.exe (
    powershell -Command "Invoke-WebRequest -Uri 'https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe' -OutFile 'release_out\tailscale-setup.exe'"
) else (
    echo Tailscale installer already downloaded.
)
echo Your release files are located in: tailchat\backend\release_out
echo =======================================
pause







