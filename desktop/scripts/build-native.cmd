@echo off
rem Compila native\audio-capture.cpp em resources\audio-capture.exe (precisa do Visual Studio com C++).
rem Uso: npm run native
setlocal
cd /d "%~dp0.."

set "VS="
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
for /f "delims=" %%i in ('call "%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath') do set "VS=%%i"
if not defined VS (
  echo Visual Studio com as ferramentas de C++ nao encontrado.
  exit /b 1
)

call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1 || exit /b 1
if not exist build\native mkdir build\native
cl /nologo /O2 /EHsc /MT /std:c++17 /W3 native\audio-capture.cpp /Fo:build\native\ /Fe:resources\audio-capture.exe ole32.lib mmdevapi.lib || exit /b 1
echo resources\audio-capture.exe gerado
