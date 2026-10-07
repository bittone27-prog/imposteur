const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
let nextId = 0;
let rooms = {};

const CATEGORIES = {
  sport: [
    ["Football", "Sport"],
    ["Tennis", "Sport"],
    ["Natation", "Sport"],
    ["Basket", "Sport"],
    ["Volleyball", "Sport"],
    ["Cyclisme", "Sport"]
  ],
  celebrite: [
    ["Elon Musk", "Personnage célèbre"],
    ["Taylor Swift", "Personnage célèbre"],
    ["Cristiano Ronaldo", "Personnage célèbre"],
    ["Beyoncé", "Personnage célèbre"],
    ["Dwayne Johnson", "Personnage célèbre"],
    ["Oprah Winfrey", "Personnage célèbre"]
  ],
  film: [
    ["Marvel", "Film"],
    ["Star Wars", "Film"],
    ["Harry Potter", "Film"],
    ["Titanic", "Film"],
    ["Avatar", "Film"],
    ["Inception", "Film"]
  ],
  anime: [
    ["One Piece", "Anime"],
    ["Naruto", "Anime"],
    ["Dragon Ball", "Anime"],
    ["Attack on Titan", "Anime"],
    ["Demon Slayer", "Anime"],
    ["My Hero Academia", "Anime"]
  ],
  musique: [
    ["Guitare", "Musique"],
    ["Piano", "Musique"],
    ["Batterie", "Musique"],
    ["Violon", "Musique"],
    ["Saxophone", "Musique"],
    ["Microphone", "Musique"]
  ],
  nature: [
    ["Arbre", "Nature"],
    ["Montagne", "Nature"],
    ["Océan", "Nature"],
    ["Forêt", "Nature"],
    ["Fleur", "Nature"],
    ["Soleil", "Nature"]
  ],
  nourriture: [
    ["Pizza", "Nourriture"],
    ["Sushi", "Nourriture"],
    ["Burger", "Nourriture"],
    ["Pâtes", "Nourriture"],
    ["Glace", "Nourriture"],
    ["Chocolat", "Nourriture"]
  ],
  animaux: [
    ["Chat", "Animal"],
    ["Chien", "Animal"],
    ["Lion", "Animal"],
    ["Éléphant", "Animal"],
    ["Oiseau", "Animal"],
    ["Poisson", "Animal"]
  ]
};

function makeCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function startGame(room) {
  const category = room.selectedCategory || "sport";
  const pairs = CATEGORIES[category] || CATEGORIES.sport;
  const pair = pairs[Math.floor(Math.random() * pairs.length)];
  
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
  room.clues = [];
}

function broadcastLobby(room) {
  const lobbyData = {
    type: "roomUpdate",
    code: room.code,
    state: "lobby",
    host: room.hostId,
    players: room.players.map(p => ({ id: p.id, name: p.name })),
    categories: Object.keys(CATEGORIES),
    selectedCategory: room.selectedCategory
  };

  io.to(room.code).emit("roomUpdate", lobbyData);
}

io.on("connection", (socket) => {
  socket.on("createRoom", (msg) => {
    const name = String(msg.name || "").trim().slice(0, 16);
    if (!name) return socket.emit("message", { type: "error", message: "Entre un pseudo." });

    const code = makeCode();
    const player = { id: socket.id, name, clues: [] };
    rooms[code] = {
      code,
      hostId: socket.id,
      players: [player],
      phase: "lobby",
      votes: {},
      turnIndex: 0,
      round: 1,
      clues: [],
      selectedCategory: "sport"
    };

    socket.join(code);
    socket.roomCode = code;
    broadcastLobby(rooms[code]);
  });

  socket.on("joinRoom", (msg) => {
    const name = String(msg.name || "").trim().slice(0, 16);
    const code = String(msg.code || "").trim().toUpperCase();

    if (!name) return socket.emit("message", { type: "error", message: "Entre un pseudo." });
    const room = rooms[code];
    if (!room) return socket.emit("message", { type: "error", message: "Code invalide." });
    if (room.phase !== "lobby") return socket.emit("message", { type: "error", message: "La partie a déjà commencé." });
    if (room.players.length >= 10) return socket.emit("message", { type: "error", message: "Partie pleine (10 max)." });
    if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return socket.emit("message", { type: "error", message: "Ce pseudo est déjà pris." });
    }

    const player = { id: socket.id, name, clues: [] };
    room.players.push(player);
    socket.join(code);
    socket.roomCode = code;
    broadcastLobby(room);
  });

  socket.on("setCategory", (msg) => {
    const room = rooms[socket.roomCode];
    if (!room) return;

    const me = room.players.find((p) => p.id === socket.id);
    if (!me || me.id !== room.hostId) return;

    const category = String(msg.category || "").toLowerCase();
    if (CATEGORIES[category]) {
      room.selectedCategory = category;
      broadcastLobby(room);
    }
  });

  socket.on("startGame", () => {
    const room = rooms[socket.roomCode];
    if (!room) return;

    const me = room.players.find((p) => p.id === socket.id);
    if (!me || me.id !== room.hostId) return;
    if (room.players.length < 3) {
      return socket.emit("message", { type: "error", message: "Il faut au moins 3 joueurs." });
    }

    startGame(room);
    
    room.players.forEach((p) => {
      io.to(p.id).emit("gameUpdate", {
        word: p.word,
        players: room.players.map(pl => ({ id: pl.id, name: pl.name })),
        turn: room.players[room.turnIndex]?.id,
        clues: room.clues,
        phase: room.phase,
        round: room.round,
        category: room.selectedCategory
      });
    });
  });

  socket.on("sendClue", (msg) => {
    const room = rooms[socket.roomCode];
    if (!room || room.phase !== "clues") return;

    const me = room.players.find((p) => p.id === socket.id);
    if (!me) return;

    if (room.players[room.turnIndex].id !== socket.id) return;

    const clue = String(msg.clue || "").trim().slice(0, 24);
    if (!clue) return;

    room.clues.push({ name: me.name, clue });
    room.turnIndex++;

    if (room.turnIndex >= room.players.length) {
      if (room.round >= 2) {
        room.phase = "voting";
      } else {
        room.round++;
        room.turnIndex = 0;
      }
    }

    room.players.forEach((p) => {
      io.to(p.id).emit("gameUpdate", {
        word: p.word,
        players: room.players.map(pl => ({ id: pl.id, name: pl.name })),
        turn: room.players[room.turnIndex]?.id,
        clues: room.clues,
        phase: room.phase,
        round: room.round,
        category: room.selectedCategory
      });
    });
  });

  socket.on("vote", (msg) => {
    const room = rooms[socket.roomCode];
    if (!room || room.phase !== "voting") return;

    room.votes[socket.id] = msg.votedId;

    if (Object.keys(room.votes).length === room.players.length) {
      const voteCounts = {};
      Object.values(room.votes).forEach((id) => {
        voteCounts[id] = (voteCounts[id] || 0) + 1;
      });

      const maxVotes = Math.max(...Object.values(voteCounts));
      const elimId = Object.keys(voteCounts).find((id) => voteCounts[id] === maxVotes);

      const elim = room.players.find((p) => p.id === elimId);
      const isImpostorElim = elim.isImpostor;

      room.result = {
        eliminatedName: elim.name,
        wasImpostor: isImpostorElim,
        impostorWas: room.players.find((p) => p.isImpostor).name
      };

      room.phase = "end";
      io.to(room.code).emit("gameEnd", room.result);
    }
  });

  socket.on("disconnect", () => {
    const room = rooms[socket.roomCode];
    if (!room) return;

    room.players = room.players.filter((p) => p.id !== socket.id);

    if (room.players.length === 0) {
      delete rooms[socket.roomCode];
    } else {
      if (room.hostId === socket.id) {
        room.hostId = room.players[0].id;
      }
      if (room.phase === "lobby") {
        broadcastLobby(room);
      }
    }
  });
});

server.listen(PORT, () => console.log(`Serveur sur le port ${PORT}`));
