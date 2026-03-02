const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// rooms = { roomId: { id, name, password, users: Set(socketId) } }
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
    console.log('User connected:', socket.id);
    
    // Send current rooms to new user
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
        if (!room) {
            return callback({ success: false, message: 'Room not found' });
        }
        
        if (room.password && room.password !== password) {
            return callback({ success: false, message: 'Invalid password' });
        }

        socket.join(roomId);
        room.users.add(socket.id);
        socket.roomId = roomId;

        callback({ success: true, users: Array.from(room.users).filter(id => id !== socket.id) });

        // Notify others in room
        socket.to(roomId).emit('user-connected', socket.id);
        io.emit('update-rooms', getPublicRooms());
    });

    socket.on('leave-room', () => {
        if (socket.roomId && rooms[socket.roomId]) {
            const roomId = socket.roomId;
            rooms[roomId].users.delete(socket.id);
            socket.leave(roomId);
            socket.to(roomId).emit('user-disconnected', socket.id);
            
            if (rooms[roomId].users.size === 0) {
                delete rooms[roomId];
            }
            
            socket.roomId = null;
            io.emit('update-rooms', getPublicRooms());
        }
    });

    socket.on('disconnect', () => {
        if (socket.roomId && rooms[socket.roomId]) {
            const roomId = socket.roomId;
            rooms[roomId].users.delete(socket.id);
            socket.to(roomId).emit('user-disconnected', socket.id);
            
            if (rooms[roomId].users.size === 0) {
                delete rooms[roomId];
            }
            io.emit('update-rooms', getPublicRooms());
        }
        console.log('User disconnected:', socket.id);
    });

    // WebRTC Signaling
    socket.on('offer', ({ target, caller, sdp }) => {
        socket.to(target).emit('offer', { caller, sdp });
    });

    socket.on('answer', ({ target, caller, sdp }) => {
        socket.to(target).emit('answer', { caller, sdp });
    });

    socket.on('ice-candidate', ({ target, candidate }) => {
        socket.to(target).emit('ice-candidate', { sender: socket.id, candidate });
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});