@echo off
setlocal enabledelayedexpansion

:: Change to automation root (parent of scripts folder)
set "AUTOMATION_ROOT=%~dp0.."
cd /d "%AUTOMATION_ROOT%"

echo ============================================================
echo        LINK FIXING WORKFLOW
echo ============================================================
echo.

:: ------------------------------------------------------------
:: STEP 1: Find broken links
:: ------------------------------------------------------------
echo [STEP 1] Scanning for broken links...
node scripts/check-broken-links.js
if errorlevel 1 (
    echo ERROR: Failed to scan broken links.
    pause
    exit /b 1
)
echo.
echo Broken links report: data\links\broken-links.csv
echo.

:: ------------------------------------------------------------
:: STEP 2: User confirmation before fixing
:: ------------------------------------------------------------
set /p fix="Do you want to proceed with fixing broken links? (Y/N): "
if /i not "!fix!"=="Y" (
    echo Exiting.
    pause
    exit /b 0
)

:: ------------------------------------------------------------
:: STEP 3: Choose fixing method
:: ------------------------------------------------------------
echo.
echo Choose fixing method:
echo   1) AI-assisted fix (intelligent, slower, uses OpenRouter API)
echo   2) Manual spotlight fix (replace all broken links with a single spotlight movie)
set /p method="Enter 1 or 2: "

if "!method!"=="2" (
    set /p spotlight="Enter spotlight filename (e.g., project-hail-mary.html): "
    echo.
    echo [STEP 2] Running manual spotlight fix...
    node scripts/fix-links-manual.js --spotlight !spotlight!
    if errorlevel 1 (
        echo ERROR: Manual fix failed.
        pause
        exit /b 1
    )
    goto after_fix
)

:: Default to AI method
echo.
echo [STEP 2] Running AI link fixer...
node scripts/fix-links.js
if errorlevel 1 (
    echo ERROR: AI fix failed.
    pause
    exit /b 1
)

:after_fix
echo.
echo Corrected files written to: data\output\

:: Count how many HTML files were written to data/output
set output_count=0
for %%f in ("data\output\*.html") do set /a output_count+=1
echo Number of files written to output directory: %output_count%

:: Extract number of corrections from AI log (if AI method was used)
set corrections_count=0
if "!method!"=="1" (
    if exist "logs\fix-links.log" (
        for /f "tokens=*" %%a in ('type "logs\fix-links.log" ^| findstr /i "Received.*file-level correction objects"') do (
            set last_line=%%a
        )
        for /f "tokens=2" %%b in ("!last_line!") do set corrections_count=%%b
    )
    echo Number of corrections made by AI: %corrections_count%
) else (
    echo Manual spotlight fix applied.
)

:: ------------------------------------------------------------
:: STEP 4: Verify changes
:: ------------------------------------------------------------
echo.
echo [STEP 3] Verifying link changes...
node scripts/verify-links.js
echo.
echo Verification report: data\links\link-verification.csv

:: Count link differences from verification output
set link_diffs=0
if exist "data\links\link-verification.csv" (
    for /f %%c in ('type "data\links\link-verification.csv" ^| find /c /v ""') do set /a link_diffs=%%c-1
    if !link_diffs! lss 0 set link_diffs=0
)
echo Number of link differences found: %link_diffs%
echo.

:: ------------------------------------------------------------
:: STEP 5: Ask user if they want to overwrite originals
:: ------------------------------------------------------------
set /p overwrite="Do you want to overwrite original HTML files with corrected versions? (Y/N): "
if /i not "!overwrite!"=="Y" (
    echo Exiting without overwriting. Corrected files remain in data\output\.
    pause
    exit /b 0
)

:: ------------------------------------------------------------
:: STEP 6: Backup and deploy
:: ------------------------------------------------------------
echo.
echo Creating backup of original files in: C:\Users\andre\projects\movies-backup
if not exist "C:\Users\andre\projects\movies-backup" mkdir "C:\Users\andre\projects\movies-backup"
xcopy /Y "C:\Users\andre\projects\movies\*.html" "C:\Users\andre\projects\movies-backup\" >nul
echo Backup complete.

echo.
echo Overwriting original files with corrected versions...
xcopy /Y "data\output\*.html" "C:\Users\andre\projects\movies\" >nul
echo Overwrite complete.
echo %output_count% file(s) replaced.

:: ------------------------------------------------------------
:: STEP 7: Optional final re-scan
:: ------------------------------------------------------------
echo.
set /p recheck="Do you want to re-run broken link scan to confirm fixes? (Y/N): "
if /i "!recheck!"=="Y" (
    echo Running final scan...
    node scripts/check-broken-links.js
)

echo.
echo ============================================================
echo WORKFLOW COMPLETE
echo ============================================================
echo Summary:
if "!method!"=="1" (
    echo   - Corrections made by AI: %corrections_count%
)
echo   - Files written to output: %output_count%
echo   - Link differences verified: %link_diffs%
echo   - Backup saved to movies-backup
echo   - %output_count% file(s) overwritten in movies directory
echo ============================================================
pause