const { app, BrowserWindow, session, desktopCapturer } = require('electron');
const path = require('path');
const express = require('express');
const http = require('http');

let mainWindow;

function startServerAndWindow() {
    const expressApp = express();
    const server = http.createServer(expressApp);

    expressApp.use(express.static(path.join(__dirname, 'public')));
    expressApp.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

    // Wir lassen das System dynamisch einen freien Port finden
    server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        
        mainWindow = new BrowserWindow({
            width: 1280,
            height: 800,
            autoHideMenuBar: true,
            title: "WebRTC Video App",
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        // Berechtigungen automatisch erteilen
        session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
            if (['media', 'display-capture'].includes(permission)) {
                callback(true);
            } else {
                callback(false);
            }
        });
        
        session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
            if (['media', 'display-capture'].includes(permission)) {
                return true;
            }
            return false;
        });

        // Automatische Quelle für Screenshare (ganzer Bildschirm) bereitstellen
        session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
            desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
                // Den ersten gefundenen Bildschirm zurückgeben
                callback({ video: sources[0], audio: 'loopback' });
            }).catch(err => {
                console.error('Error getting sources:', err);
            });
        });

        // Localhost statt 127.0.0.1 nutzen, da Browser dies als sicheren Kontext behandeln (notwendig für getUserMedia)
        mainWindow.loadURL(`http://localhost:${port}`);
    });
}

// Hardwarebeschleunigung für flüssiges WebRTC und Screen Capture
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');

app.whenReady().then(startServerAndWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});