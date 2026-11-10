@echo off
rem Starts the W2K-2 Dashboard bridge and opens it in your browser.
rem Add --lan to view it from other devices on the boat network.
start "" http://localhost:8642
node "%~dp0server.js" %*
