@echo off
set ILIAD=C:\Users\andre\projects\illiad
set ODYSSEY=C:\Users\andre\projects\odyssey
set ILIAD_OUT=C:\Users\andre\projects\iliad_full_export.txt
set ODYSSEY_OUT=C:\Users\andre\projects\odyssey_full_export.txt


:: ============================================================
:: ILIAD EXPORT
:: ============================================================

echo. > %ILIAD_OUT%

:: src/ — all .astro, .js, .ts, .css, .html files recursively
for /r "%ILIAD%\src" %%f in (*.astro *.js *.ts *.css *.html) do (
  echo ======================================================== >> %ILIAD_OUT%
  echo FILE: %%~pnxf >> %ILIAD_OUT%
  echo ======================================================== >> %ILIAD_OUT%
  type "%%f" >> %ILIAD_OUT%
  echo. >> %ILIAD_OUT%
)

:: public/ — all non-binary files (css, txt, xml, svg, webmanifest)
for /r "%ILIAD%\public" %%f in (*.css *.txt *.xml *.svg *.webmanifest) do (
  echo ======================================================== >> %ILIAD_OUT%
  echo FILE: %%~pnxf >> %ILIAD_OUT%
  echo ======================================================== >> %ILIAD_OUT%
  type "%%f" >> %ILIAD_OUT%
  echo. >> %ILIAD_OUT%
)

:: Root config files
for %%f in (astro.config.mjs astro.config.ts package.json netlify.toml tsconfig.json) do (
  if exist "%ILIAD%\%%f" (
    echo ======================================================== >> %ILIAD_OUT%
    echo FILE: %%f >> %ILIAD_OUT%
    echo ======================================================== >> %ILIAD_OUT%
    type "%ILIAD%\%%f" >> %ILIAD_OUT%
    echo. >> %ILIAD_OUT%
  )
)

echo Iliad export done: %ILIAD_OUT%


:: ============================================================
:: ODYSSEY EXPORT
:: ============================================================

echo. > %ODYSSEY_OUT%

:: src/ — all .astro, .js, .ts, .css, .html files recursively
for /r "%ODYSSEY%\src" %%f in (*.astro *.js *.ts *.css *.html) do (
  echo ======================================================== >> %ODYSSEY_OUT%
  echo FILE: %%~pnxf >> %ODYSSEY_OUT%
  echo ======================================================== >> %ODYSSEY_OUT%
  type "%%f" >> %ODYSSEY_OUT%
  echo. >> %ODYSSEY_OUT%
)

:: public/ — all non-binary files
for /r "%ODYSSEY%\public" %%f in (*.css *.txt *.xml *.svg *.webmanifest) do (
  echo ======================================================== >> %ODYSSEY_OUT%
  echo FILE: %%~pnxf >> %ODYSSEY_OUT%
  echo ======================================================== >> %ODYSSEY_OUT%
  type "%%f" >> %ODYSSEY_OUT%
  echo. >> %ODYSSEY_OUT%
)

:: Root config files
for %%f in (astro.config.mjs astro.config.ts package.json netlify.toml tsconfig.json) do (
  if exist "%ODYSSEY%\%%f" (
    echo ======================================================== >> %ODYSSEY_OUT%
    echo FILE: %%f >> %ODYSSEY_OUT%
    echo ======================================================== >> %ODYSSEY_OUT%
    type "%ODYSSEY%\%%f" >> %ODYSSEY_OUT%
    echo. >> %ODYSSEY_OUT%
  )
)

echo Odyssey export done: %ODYSSEY_OUT%
echo.
echo All exports complete.
