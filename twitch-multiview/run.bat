@echo off
rem Build with the JDK (17+) only, no Maven needed, then start the tool.
setlocal
cd /d "%~dp0"
if exist out rmdir /s /q out
mkdir out
javac -encoding UTF-8 -d out -sourcepath src\main\java src\main\java\twitchmultiview\Main.java
if errorlevel 1 goto error
xcopy /e /i /q /y src\main\resources out >nul
java -cp out twitchmultiview.Main %*
goto :eof

:error
echo Build failed. Please make sure JDK 17 or newer is installed and javac is on PATH.
pause
