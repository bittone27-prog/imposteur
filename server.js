const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  const file = path.join(__dirname, "public", "index.html");
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(500);
      return res.end("Erreur serveur");
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  });
});

const io = new Server(server, {
  cors: { origin: "*" }
});

const rooms = {};
let nextId = 1;

const PAIRS = [
  ["Football", "Basketball"],
  ["Chat", "Chien"],
  ["Pizza", "Burger"],
  ["Paris", "Londres"],
  ["Soleil", "Lune"],
  ["Rouge", "Bleu"],
  ["Été", "Hiver"],
  ["Montagne", "Plage"]
];

function makeCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
  } while (rooms[code]);
  return code;
}

function broadcast(room) {
  for (const p of room.players) {
    p.ws.emit('roomUpdate', {
      code: room.code,
      host: room.hostId,
      players: room.players.map(pl => ({ id: pl.id, name: pl.name })),
      selectedCategory: room.selectedCategory || 'sport'
    });
  }
}

function broadcastGame(room) {
  const impostor = room.players.find(p => p.isImpostor);
  for (const p of room.players) {
    p.ws.emit('gameUpdate', {
      phase: room.phase,
      word: p.word,
      turn: room.players[room.turnIndex]?.id,
      players: room.players.map(pl => ({ id: pl.id, name: pl.name, isImpostor: pl.isImpostor })),
      clues: room.players.flatMap(pl => pl.clues.map(clue => ({ name: pl.name, clue })))
    });
  }
}

function broadcastResult(room) {
  const impostor = room.players.find(p => p.isImpostor);
  for (const p of room.players) {
    p.ws.emit('state', {
      phase: 'result',
      players: room.players.map(pl => ({ 
        id: pl.id, 
        name: pl.name, 
        isImpostor: pl.isImpostor,
        word: pl.word
      })),
      result: {
        groupWins: room.result.groupWins,
        accusedName: room.result.accusedName
      }
    });
  }
}

function startGame(room) {
  const pair = PAIRS[Math.floor(Math.random() * PAIRS.length)];
  const flip = Math.random() < 0.5;
  const common = flip ? pair[0] : pair[1];
  const odd = flip ? pair[1] : pair[0];
  const impostorIdx = Math.floor(Math.random() * room.players.length);
  
  room.players.forEach((p, i) => {
    p.isImpostor = i === impostorIdx;
    p.word = p.isImpostor ? odd : common;
    p.clues = [];
  });
  
  room.votes = {};
  room.result = null;
  room.round = 1;
  room.turnIndex = 0;
  room.phase = "clues";
  
  broadcastGame(room);
}

function endVoting(room) {
  const tally = {};
  Object.values(room.votes).forEach((id) => {
    tally[id] = (tally[id] || 0) + 1;
  });
  
  let max = 0;
  let accusedIds = [];
  for (const id in tally) {
    if (tally[id] > max) {
      max = tally[id];
      accusedIds = [id];
    } else if (tally[id] === max) {
      accusedIds.push(id);
    }
  }
  
  const impostor = room.players.find((p) => p.isImpostor);
  const tie = accusedIds.length !== 1;
  const accused = tie ? null : room.players.find((p) => p.id === accusedIds[0]);
  
  const groupWins = accused && accused.isImpostor;
  
  room.result = {
    groupWins,
    accusedName: accused ? accused.name : "Égalité !"
  };
  
  room.phase = "result";
  broadcastResult(room);
}

function removePlayer(ws) {
  const code = ws.roomCode;
  const room = rooms[code];
  if (!room) return;
  
  const idx = room.players.findIndex((p) => p.ws === ws);
  if (idx === -1) return;
  
  const leaving = room.players[idx];
  room.players.splice(idx, 1);
  
  if (room.players.length === 0) {
    delete rooms[code];
    return;
  }
  
  if (room.hostId === leaving.id) room.hostId = room.players[0].id;
  
  if (room.phase !== "lobby" && room.players.length < 3) {
    room.phase = "lobby";
    room.players.forEach((p) => (p.clues = []));
  }
  
  broadcast(room);
}

io.on("connection", (ws) => {
  ws.on("createRoom", (msg) => {
    const name = String(msg.name || "").trim().slice(0, 16);
    if (!name) return ws.emit('message', { type: 'error', message: 'Entre un pseudo.' });
    
    const code = makeCode();
    const player = { id: String(nextId++), name, ws, clues: [], isImpostor: false, word: null };
    
    rooms[code] = {
      code,
      hostId: player.id,
      players: [player],
      phase: "lobby",
      votes: {},
      turnIndex: 0,
      round: 1,
      selectedCategory: 'sport',
      voteTimeout: null
    };
    
    ws.roomCode = code;
    ws.id = player.id;
    broadcast(rooms[code]);
  });

  ws.on("joinRoom", (msg) => {
    const name = String(msg.name || "").trim().slice(0, 16);
    const code = String(msg.code || "").trim().toUpperCase();
    
    if (!name) return ws.emit('message', { type: 'error', message: 'Entre un pseudo.' });
    
    const room = rooms[code];
    if (!room) return ws.emit('message', { type: 'error', message: 'Code invalide.' });
    if (room.phase !== "lobby") return ws.emit('message', { type: 'error', message: 'La partie a déjà commencé.' });
    if (room.players.length >= 10) return ws.emit('message', { type: 'error', message: 'Partie pleine (10 max).' });
    if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase()))
      return ws.emit('message', { type: 'error', message: 'Ce pseudo est déjà pris.' });
    
    const player = { id: String(nextId++), name, ws, clues: [], isImpostor: false, word: null };
    room.players.push(player);
    ws.roomCode = code;
    ws.id = player.id;
    broadcast(room);
  });

  ws.on("setCategory", (msg) => {
    const room = rooms[ws.roomCode];
    if (!room) return;
    room.selectedCategory = msg.category;
    broadcast(room);
  });

  ws.on("startGame", (msg) => {
    const room = rooms[ws.roomCode];
    if (!room) return;
    if (ws.id !== room.hostId) return;
    if (room.players.length < 3) return ws.emit('message', { type: 'error', message: 'Il faut au moins 3 joueurs.' });
    
    startGame(room);
  });

  ws.on("sendClue", (msg) => {
    const room = rooms[ws.roomCode];
    if (!room || room.phase !== "clues") return;
    
    const me = room.players.find((p) => p.ws === ws);
    if (!me || room.players[room.turnIndex].id !== me.id) return;
    
    const clue = String(msg.clue || "").trim().slice(0, 24);
    if (!clue) return;
    
    me.clues.push(clue);
    room.turnIndex++;
    
    if (room.turnIndex >= room.players.length) {
      if (room.round >= 2) {
        room.phase = "voting";
        broadcastGame(room);
        
        if (room.voteTimeout) clearTimeout(room.voteTimeout);
        room.voteTimeout = setTimeout(() => {
          endVoting(room);
        }, 15000);
      } else {
        room.round++;
        room.turnIndex = 0;
        broadcastGame(room);
      }
    } else {
      broadcastGame(room);
    }
  });

  ws.on("vote", (msg) => {
    const room = rooms[ws.roomCode];
    if (!room || room.phase !== "voting") return;
    
    const me = room.players.find((p) => p.ws === ws);
    if (!me) return;
    
    const target = msg.votedId;
    if (!room.players.some((p) => p.id === target) || target === me.id) return;
    
    room.votes[me.id] = target;
    
    if (Object.keys(room.votes).length === room.players.length) {
      if (room.voteTimeout) clearTimeout(room.voteTimeout);
      endVoting(room);
    }
  });

  ws.on("again", (msg) => {
    const room = rooms[ws.roomCode];
    if (!room) return;
    if (ws.id !== room.hostId) return;
    
    if (room.voteTimeout) clearTimeout(room.voteTimeout);
    
    room.phase = "lobby";
    room.players.forEach((p) => (p.clues = [], p.isImpostor = false, p.word = null));
    room.votes = {};
    room.result = null;
    room.round = 1;
    room.turnIndex = 0;
    
    broadcast(room);
  });

  ws.on("close", () => removePlayer(ws));
  ws.on("disconnect", () => removePlayer(ws));
});

server.listen(PORT, () => console.log('Serveur sur le port ' + PORT));
