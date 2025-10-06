const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

let rooms = {};

function generateRoomCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Host creates room
  socket.on('createRoom', (hostName, callback) => {
    const code = generateRoomCode();
    rooms[code] = {
      host: {id: socket.id, name: hostName},
      players: [],
      sectors: [
        {name:"Railways Electrification", return:8, green:3, locked:true},
        {name:"Expressways (DMEDL)", return:10, green:4, locked:true},
        {name:"Solar Parks (Rewa)", return:7, green:5, locked:true}
      ],
      started: false,
      impostors: []
    };
    socket.join(code);
    callback(code);
  });

  // Player joins room
  socket.on('joinRoom', (roomCode, playerName, avatar, callback) => {
    const room = rooms[roomCode];
    if(!room){ callback({error:"Room doesn't exist"}); return; }
    if(room.players.length>=8){ callback({error:"Max 8 teams"}); return; }

    const player = {id: socket.id, name: playerName, avatar, role:'investor', investments:{}, remaining:100};
    room.players.push(player);
    socket.join(roomCode);

    io.to(roomCode).emit('updatePlayers', room.players);
    callback({success:true});
  });

  // Start game by host
  socket.on('startGame', roomCode => {
    const room = rooms[roomCode];
    if(!room || socket.id!==room.host.id) return;
    room.started = true;

    const shuffled = room.players.sort(()=>0.5-Math.random());
    room.impostors = shuffled.slice(0,2);
    room.impostors.forEach(p=>p.role='impostor');

    io.to(roomCode).emit('gameStarted', room.sectors, room.impostors.map(p=>p.id));
  });

  // Player invests
  socket.on('invest', (roomCode, investments) => {
    const room = rooms[roomCode];
    if(!room) return;
    const player = room.players.find(p=>p.id===socket.id);
    if(!player) return;
    player.investments = investments;
    player.remaining = 100 - Object.values(investments).reduce((a,b)=>a+b,0);
    io.to(roomCode).emit('updatePlayers', room.players);
  });

  // Host flashes news
  socket.on('flashNews', (roomCode, msg) => {
    const room = rooms[roomCode];
    if(!room || socket.id!==room.host.id) return;
    io.to(roomCode).emit('news', msg);
  });

  // Host unlocks sectors
  socket.on('unlockSectors', roomCode => {
    const room = rooms[roomCode];
    if(!room || socket.id!==room.host.id) return;
    room.sectors.forEach(s=>s.locked=false);
    io.to(roomCode).emit('sectorsUnlocked', room.sectors);
  });

  // Host ends game
  socket.on('endGame', roomCode => {
    const room = rooms[roomCode];
    if(!room || socket.id!==room.host.id) return;

    const scores = room.players.map(p=>{
      let financial=0, green=0;
      room.sectors.forEach(s=>{
        if(p.investments[s.name]){
          financial += p.investments[s.name]*s.return;
          green += p.investments[s.name]*s.green;
        }
      });
      return {name:p.name, role:p.role, total:0.5*financial + 0.5*green};
    });

    const winner = scores.reduce((a,b)=>b.total>a.total?b:a);
    io.to(roomCode).emit('gameEnded', {scores, winner, impostors: room.impostors.map(p=>p.name)});
  });

  // Disconnect
  socket.on('disconnect', ()=>{ console.log('User disconnected:', socket.id); });
});

http.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
