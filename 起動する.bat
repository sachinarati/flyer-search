@echo off
rem Open the v2 (PDF upload) app in the default browser.
rem NOTE: Some browsers block local file access for the PDF worker.
rem If the PDF import does not work by double-click, use a local server:
rem   1) Install Node, then in this folder run:  npx serve .
rem   2) Or with Python:  python -m http.server
rem   3) Then open the shown http://localhost:... address.
start "" "%~dp0index.html"
