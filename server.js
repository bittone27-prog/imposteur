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
    ["Football", "Rugby"],
    ["Tennis", "Badminton"],
    ["Natation", "Plongée"],
    ["Basket", "Handball"],
    ["Volleyball", "Beach-volley"],
    ["Cyclisme", "Course à pied"],
    ["Boxe", "Judo"],
    ["Ski", "Snowboard"],
    ["Golf", "Pétanque"],
    ["Surf", "Planche à voile"],
    ["Escalade", "Randonnée"],
    ["Hockey", "Patinage"],
    ["Baseball", "Cricket"],
    ["Karaté", "Taekwondo"],
    ["Gymnastique", "Danse"]
  ],
  celebrites: [
    ["Messi", "Ronaldo"],
    ["Beyoncé", "Rihanna"],
    ["Brad Pitt", "Tom Cruise"],
    ["Mbappé", "Neymar"],
    ["Drake", "Eminem"],
    ["Zidane", "Platini"],
    ["Michael Jackson", "Elvis Presley"],
    ["Taylor Swift", "Adele"],
    ["Leonardo DiCaprio", "Johnny Depp"],
    ["Omar Sy", "Jamel Debbouze"],
    ["Cristiano Ronaldo", "Zlatan"],
    ["Angelina Jolie", "Scarlett Johansson"],
    ["Booba", "Jul"],
    ["Elon Musk", "Mark Zuckerberg"],
    ["Will Smith", "Kevin Hart"]
  ],
  nourriture: [
    ["Pizza", "Burger"],
    ["Sushi", "Raviolis"],
    ["Pomme", "Poire"],
    ["Fraise", "Framboise"],
    ["Chocolat", "Caramel"],
    ["Café", "Thé"],
    ["Croissant", "Pain au chocolat"],
    ["Frites", "Chips"],
    ["Glace", "Sorbet"],
    ["Pâtes", "Riz"],
    ["Fromage", "Beurre"],
    ["Poulet", "Dinde"],
    ["Banane", "Mangue"],
    ["Crêpe", "Gaufre"],
    ["Tacos", "Kebab"]
  ],
  animaux: [
    ["Chat", "Chien"],
    ["Lion", "Tigre"],
    ["Cheval", "Âne"],
    ["Requin", "Dauphin"],
    ["Aigle", "Faucon"],
    ["Loup", "Renard"],
    ["Éléphant", "Rhinocéros"],
    ["Singe", "Gorille"],
    ["Lapin", "Hamster"],
    ["Serpent", "Lézard"],
    ["Papillon", "Abeille"],
    ["Crocodile", "Alligator"],
    ["Pingouin", "Manchot"],
    ["Vache", "Chèvre"],
    ["Ours", "Panda"]
  ],
  lieux: [
    ["Plage", "Piscine"],
    ["Montagne", "Colline"],
    ["Mer", "Lac"],
    ["Château", "Palais"],
    ["Cinéma", "Théâtre"],
    ["École", "Université"],
    ["Hôpital", "Clinique"],
    ["Aéroport", "Gare"],
    ["Désert", "Savane"],
    ["Forêt", "Jungle"],
    ["Musée", "Bibliothèque"],
    ["Restaurant", "Café"],
    ["Stade", "Gymnase"],
    ["Supermarché", "Marché"],
    ["Paris", "Londres"]
  ],
  objets: [
    ["Voiture", "Moto"],
    ["Avion", "Hélicoptère"],
    ["Train", "Métro"],
    ["Ordinateur", "Tablette"],
    ["Guitare", "Violon"],
    ["Stylo", "Crayon"],
    ["Chaise", "Canapé"],
    ["Montre", "Réveil"],
    ["Téléphone", "Radio"],
    ["Lunettes", "Jumelles"],
    ["Parapluie", "Imperméable"],
    ["Valise", "Sac à dos"],
    ["Clé", "Cadenas"],
    ["Miroir", "Fenêtre"],
    ["Bougie", "Lampe"]
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
