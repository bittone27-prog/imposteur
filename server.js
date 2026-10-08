const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  fs.readFile(path.join(__dirname, "public", "index.html"), (err, data) => {
    if (err) { res.writeHead(500); return res.end("Erreur serveur"); }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  });
});

const io = new Server(server, { cors: { origin: "*" } });
const rooms = {};

const PAIRS = {
  sport: [["Football", "Basketball"], ["Tennis", "Ping-pong"], ["Natation", "Plongeon"]],
  celebrite: [["Messi", "Ronaldo"], ["Beyoncé", "Rihanna"], ["Einstein", "Newton"]],
  film: [["Titanic", "Avatar"], ["Shrek", "Madagascar"], ["Batman", "Superman"]],
  anime: [["Naruto", "Bleach"], ["One Piece", "Dragon Ball"], ["Pikachu", "Evoli"]],
  musique: [["Guitare", "Piano"], ["Rap", "Rock"], ["Violon", "Violoncelle"]],
  nature: [["Montagne", "Plage"], ["Forêt", "Désert"], ["Soleil", "Lune"]],
  nourriture: [["Pizza", "Burger"], ["Pâtes", "Riz"], ["Chocolat", "Vanille"]],
  animaux: [["Chat", "Chien"], ["Lion", "Tigre"], ["Dauphin", "Requin"]]
};

function makeCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
  } while (rooms[code]);
  return code;
}

function broadcastRoom(room) {
  for (const p of room.players) {
    p.socket.emit("roomUpdate", {
      code: room.code,
      host: room.hostId,
      players: room.players.map(pl => ({ id: pl.id, name: pl.name })),
      selectedCategory: room.category,
      settings: room.settings
    });
  }
}

function broadcastGame(room) {
  const cluesAll = [];
  for (const pl of room.players) {
    pl.clues.forEach((c, i) => cluesAll.push({ name: pl.name, clue: c, round: i + 1 }));
  }
  for (const p of room.players) {
    p.socket.emit("gameUpdate", {
      phase: room.phase,
      word: p.word,
      role: p.isImpostor ? "impostor" : "innocent",
      category: room.category,
      turn: room.players[room.turnIndex] ? room.players[room.turnIndex].id : null,
      round: room.round,
      players: room.players.map(pl => ({ id: pl.id, name: pl.name })),
      clues: cluesAll,
      votes: room.votes
    });
  }
}

function startGame(room) {
  const list = PAIRS[room.category] || PAIRS.sport;
  const pair = list[Math.floor(Math.random() * list.length)];
  const flip = Math.random() < 0.5;
  const civilWord = flip ? pair[0] : pair[1];
  const impostorWord = flip ? pair[1] : pair[0];
  const impostor = room.players[Math.floor(Math.random() * room.players.length)];

  room.players.forEach(p => {
    p.isImpostor = p === impostor;
    p.word = p.isImpostor ? impostorWord : civilWord;
    p.clues = [];
  });
  room.impostorWord = impostorWord;
  room.civilWord = civilWord;
  room.votes = {};
  room.round = 1;
  room.turnIndex = 0;
  room.phase = "clues";
  broadcastGame(room);
}

function endVoting(room) {
  if (room.phase !== "voting") return;
  room.phase = "end";
  if (room.voteTimeout) { clearTimeout(room.voteTimeout); room.voteTimeout = null; }

  const counts = {};
  Object.values(room.votes).forEach(id => { counts[id] = (counts[id] || 0) + 1; });

  let max = 0, eliminatedId = null, tie = false;
  for (const id in counts) {
    if (counts[id] > max) { max = counts[id]; eliminatedId = id; tie = false; }
    else if (counts[id] === max) tie = true;
  }

  const impostor = room.players.find(p => p.isImpostor);
  const eliminated = room.players.find(p => p.id === eliminatedId);

  const result = {
    tie: tie || !eliminated,
    eliminatedName: eliminated ? eliminated.name : null,
    wasImpostor: eliminated ? eliminated.isImpostor : false,
    impostorName: impostor ? impostor.name : "?",
    impostorWord: room.impostorWord,
    civilWord: room.civilWord
  };

  for (const p of room.players) p.socket.emit("gameEnd", result);
}

function startVoting(room) {
  room.phase = "voting";
  room.votes = {};
  broadcastGame(room);
  if (room.voteTimeout) clearTimeout(room.voteTimeout);
  room.voteTimeout = setTimeout(() => endVoting(room), 15000);
}

function removePlayer(socket) {
  const room = rooms[socket.roomCode];
  if (!room) return;
  const idx = room.players.findIndex(p => p.socket === socket);
  if (idx === -1) return;

  room.players.splice(idx, 1);
  socket.leave(room.code);
  socket.roomCode = null;

  if (room.players.length === 0) {
    if (room.voteTimeout) clearTimeout(room.voteTimeout);
    delete rooms[room.code];
    return;
  }

  if (room.hostId === socket.id) room.hostId = room.players[0].id;

  if (room.phase === "lobby") return broadcastRoom(room);

  if (room.players.length < 3) {
    if (room.voteTimeout) { clearTimeout(room.voteTimeout); room.voteTimeout = null; }
    room.phase = "lobby";
    room.votes = {};
    room.players.forEach(p => { p.clues = []; p.word = null; p.isImpostor = false; });
    for (const p of room.players) p.socket.emit("backToLobby");
    return broadcastRoom(room);
  }

  if (room.phase === "clues") {
    if (idx < room.turnIndex) room.turnIndex--;
    if (room.turnIndex >= room.players.length) {
      room.turnIndex = 0;
      room.round++;
    }
    if (room.round > 2) return startVoting(room);
    return broadcastGame(room);
  }

  if (room.phase === "voting") {
    delete room.votes[socket.id];
    for (const v in room.votes) if (room.votes[v] === socket.id) delete room.votes[v];
    if (Object.keys(room.votes).length >= room.players.length) return endVoting(room);
    broadcastGame(room);
  }
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name }) => {
    const code = makeCode();
    const room = {
      code, hostId: socket.id, players: [], phase: "lobby",
      category: "sport", votes: {}, round: 1, turnIndex: 0,
      settings: { showRole: false }
    };
    rooms[code] = room;
    room.players.push({ id: socket.id, name: String(name || "Joueur").slice(0, 16), socket, clues: [] });
    socket.roomCode = code;
    socket.join(code);
    broadcastRoom(room);
  });

  socket.on("joinRoom", ({ name, code }) => {
    const room = rooms[String(code || "").toUpperCase()];
    if (!room) return socket.emit("errorMsg", "Code introuvable");
    if (room.phase !== "lobby") return socket.emit("errorMsg", "Partie déjà commencée");
    if (room.players.length >= 10) return socket.emit("errorMsg", "Salle pleine");
    room.players.push({ id: socket.id, name: String(name || "Joueur").slice(0, 16), socket, clues: [] });
    socket.roomCode = room.code;
    socket.join(room.code);
    broadcastRoom(room);
  });

  socket.on("setCategory", (category) => {
    const room = rooms[socket.roomCode];
    if (!room || room.phase !== "lobby" || socket.id !== room.hostId) return;
    if (!PAIRS[category]) return;
    room.category = category;
    broadcastRoom(room);
  });

  socket.on("setSettings", (s) => {
    const room = rooms[socket.roomCode];
    if (!room || room.phase !== "lobby" || socket.id !== room.hostId) return;
    room.settings.showRole = !!(s && s.showRole);
    broadcastRoom(room);
  });

  socket.on("startGame", () => {
    const room = rooms[socket.roomCode];
    if (!room || socket.id !== room.hostId || room.phase !== "lobby") return;
    if (room.players.length < 3) return socket.emit("errorMsg", "Minimum 3 joueurs");
    startGame(room);
  });

  socket.on("clue", (clue) => {
    const room = rooms[socket.roomCode];
    if (!room || room.phase !== "clues") return;
    const me = room.players[room.turnIndex];
    if (!me || me.socket !== socket) return;
    const text = String(clue || "").trim().slice(0, 24);
    if (!text) return;

    me.clues.push(text);
    room.turnIndex++;

    if (room.turnIndex >= room.players.length) {
      if (room.round >= 2) return startVoting(room);
      room.round++;
      room.turnIndex = 0;
    }
    broadcastGame(room);
  });

  socket.on("vote", (targetId) => {
    const room = rooms[socket.roomCode];
    if (!room || room.phase !== "voting") return;
    if (targetId === socket.id) return;
    if (!room.players.some(p => p.id === targetId)) return;

    room.votes[socket.id] = targetId;
    broadcastGame(room);

    if (Object.keys(room.votes).length === room.players.length) {
      endVoting(room);
    }
  });

  socket.on("again", () => {
    const room = rooms[socket.roomCode];
    if (!room || socket.id !== room.hostId) return;
    if (room.voteTimeout) { clearTimeout(room.voteTimeout); room.voteTimeout = null; }
    room.phase = "lobby";
    room.votes = {};
    room.players.forEach(p => { p.clues = []; p.word = null; p.isImpostor = false; });
    for (const p of room.players) p.socket.emit("backToLobby");
    broadcastRoom(room);
  });

  socket.on("leave", () => removePlayer(socket));
  socket.on("disconnect", () => removePlayer(socket));
});

server.listen(PORT, () => console.log("Serveur sur le port " + PORT));
