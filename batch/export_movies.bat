@echo off
set MOVIES=C:\Users\andre\projects\movies
set MOVIES_OUT=C:\Users\andre\projects\movies_full_export.txt

:: ============================================================
:: MOVIES EXPORT
:: ============================================================
echo. > %MOVIES_OUT%

:: All HTML files in root
for %%f in ("%MOVIES%\*.html") do (
  echo ======================================================== >> %MOVIES_OUT%
  echo FILE: %%~pnxf >> %MOVIES_OUT%
  echo ======================================================== >> %MOVIES_OUT%
  type "%%f" >> %MOVIES_OUT%
  echo. >> %MOVIES_OUT%
)

:: css/ folder
for /r "%MOVIES%\css" %%f in (*.css) do (
  echo ======================================================== >> %MOVIES_OUT%
  echo FILE: %%~pnxf >> %MOVIES_OUT%
  echo ======================================================== >> %MOVIES_OUT%
  type "%%f" >> %MOVIES_OUT%
  echo. >> %MOVIES_OUT%
)

echo Movies export done: %MOVIES_OUT%
echo.
echo All exports complete.
