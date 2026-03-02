const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

let mainWindow;

function startServerAndWindow() {
    const expressApp = express();
    const server = http.createServer(expressApp);
    const io = socketIo(server);

    expressApp.use(express.static(path.join(__dirname, 'public')));

    // Räume speichern
    const rooms = {};

    function getPublicRooms() {
        return Object.values(rooms).map(r => ({
            id: r.id,
            name: r.name,
            hasPassword: !!r.password,
            userCount: r.users.size
        }));
    }

    io.on('connection', (socket) => {
        socket.emit('update-rooms', getPublicRooms());

        socket.on('create-room', ({ name, password }, callback) => {
            const roomId = 'room_' + Math.random().toString(36).substring(2, 11);
            rooms[roomId] = {
                id: roomId,
                name,
                password,
                users: new Set()
            };
            io.emit('update-rooms', getPublicRooms());
            callback({ success: true, roomId });
        });

        socket.on('join-room', ({ roomId, password }, callback) => {
            const room = rooms[roomId];
            if (!room) return callback({ success: false, message: 'Room not found' });
            if (room.password && room.password !== password) return callback({ success: false, message: 'Invalid password' });

            socket.join(roomId);
            room.users.add(socket.id);
            socket.roomId = roomId;

            callback({ success: true, users: Array.from(room.users).filter(id => id !== socket.id) });

            socket.to(roomId).emit('user-connected', socket.id);
            io.emit('update-rooms', getPublicRooms());
        });

        socket.on('leave-room', () => {
            if (socket.roomId && rooms[socket.roomId]) {
                const roomId = socket.roomId;
                rooms[roomId].users.delete(socket.id);
                socket.leave(roomId);
                socket.to(roomId).emit('user-disconnected', socket.id);
                if (rooms[roomId].users.size === 0) delete rooms[roomId];
                socket.roomId = null;
                io.emit('update-rooms', getPublicRooms());
            }
        });

        socket.on('disconnect', () => {
            if (socket.roomId && rooms[socket.roomId]) {
                const roomId = socket.roomId;
                rooms[roomId].users.delete(socket.id);
                socket.to(roomId).emit('user-disconnected', socket.id);
                if (rooms[roomId].users.size === 0) delete rooms[roomId];
                io.emit('update-rooms', getPublicRooms());
            }
        });

        socket.on('offer', ({ target, caller, sdp }) => socket.to(target).emit('offer', { caller, sdp }));
        socket.on('answer', ({ target, caller, sdp }) => socket.to(target).emit('answer', { caller, sdp }));
        socket.on('ice-candidate', ({ target, candidate }) => socket.to(target).emit('ice-candidate', { sender: socket.id, candidate }));
    });

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

        // Wichtig: Kamera, Mikrofon und Bildschirm-Teilen automatisch erlauben
        session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
            if (['media', 'display-capture'].includes(permission)) {
                callback(true);
            } else {
                callback(false);
            }
        });

        mainWindow.loadURL(`http://127.0.0.1:${port}`);
    });
}

app.whenReady().then(startServerAndWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});