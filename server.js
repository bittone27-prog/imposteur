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

const rooms = {};
const categories = {
  movies: ["Avatar", "Inception", "Interstellar", "Matrix", "Titanic", "Forrest Gump", "Pulp Fiction"],
  sports: ["Football", "Tennis", "Basketball", "Natation", "Boxe", "Golf", "Cyclisme"],
  animals: ["Chat", "Chien", "Lion", "Aigle", "Dauphin", "Tigre", "Elephant"],
  food: ["Pizza", "Burger", "Sushi", "Pâtes", "Tacos", "Salade", "Chocolate"],
  countries: ["France", "Japon", "Brésil", "Égypte", "Canada", "Australie", "Espagne"],
  random: ["Soleil", "Lune", "Montagne", "Ocean", "Forêt", "Désert", "Volcan"]
};

function getRandomWord(category = "random") {
  const cat = categories[category] || categories.random;
  return cat[Math.floor(Math.random() * cat.length)];
}

function getPublicRoomsList() {
  return Object.values(rooms)
    .filter(r => r.isPublic && !r.gameRunning)
    .map(r => ({
      code: r.code,
      hostName: r.hostName,
      playerCount: r.players.length,
      selectedCategory: r.selectedCategory || "random"
    }));
}

function generateCode() {
  return Math.random().toString(36).substr(2, 4).toUpperCase();
}

io.on("connection", (socket) => {
  console.log(`✅ Joueur connecté: ${socket.id}`);

  // === CRÉER UNE SALLE ===
  socket.on("createRoom", (data) => {
    const code = generateCode();
    const roomData = {
      code,
      host: socket.id,
      hostName: data.name,
      players: [
        {
          id: socket.id,
          name: data.name,
          eliminated: false,
          word: null,
          clue: null
        }
      ],
      isPublic: data.quick || false,
      selectedCategory: data.category || "random",
      gameRunning: false,
      state: null,
      settings: { showRole: false }
    };

    rooms[code] = roomData;
    socket.join(code);
    socket.emit("roomUpdate", roomData);
    io.to(code).emit("updatePublicRooms", getPublicRoomsList());
  });

  // === REJOINDRE AVEC CODE ===
  socket.on("joinRoom", (data) => {
    const { name, code } = data;
    const room = rooms[code];

    if (!room) {
      return socket.emit("errorMsg", "❌ Code invalide !");
    }

    if (room.gameRunning) {
      return socket.emit("errorMsg", "❌ La partie a déjà commencé !");
    }

    // Vérifier si le joueur existe déjà
    if (room.players.some(p => p.id === socket.id)) {
      socket.join(code);
      io.to(code).emit("roomUpdate", room);
      return;
    }

    // Ajouter le joueur
    room.players.push({
      id: socket.id,
      name,
      eliminated: false,
      word: null,
      clue: null
    });

    socket.join(code);
    io.to(code).emit("roomUpdate", room);
    io.to(code).emit("updatePublicRooms", getPublicRoomsList());
  });

  // === CHANGER LA CATÉGORIE (DANS LE LOBBY) ===
  socket.on("changeCategory", (data) => {
    const { code, category } = data;
    const room = rooms[code];

    if (!room || room.host !== socket.id) {
      return socket.emit("errorMsg", "❌ Seul l'hôte peut changer la catégorie !");
    }

    room.selectedCategory = category;
    io.to(code).emit("roomUpdate", room);
    io.to(code).emit("updatePublicRooms", getPublicRoomsList());
  });

  // === TOGGLE PUBLIC ===
  socket.on("togglePublic", (isPublic) => {
    const room = Object.values(rooms).find(r => r.players.some(p => p.id === socket.id));
    
    if (room && room.host === socket.id) {
      room.isPublic = isPublic;
      io.to(room.code).emit("roomUpdate", room);
      io.to(room.code).emit("updatePublicRooms", getPublicRoomsList());
    }
  });

  // === LANCER LA PARTIE ===
  socket.on("startGame", () => {
    const room = Object.values(rooms).find(r => r.players.some(p => p.id === socket.id));

    if (!room || room.host !== socket.id) return;
    if (room.players.length < 3) {
      return socket.emit("errorMsg", "❌ Minimum 3 joueurs requis !");
    }

    room.gameRunning = true;

    // Assigner les rôles
    const impostorIndex = Math.floor(Math.random() * room.players.length);
    const impostorWord = getRandomWord(room.selectedCategory);

    room.players.forEach((player, index) => {
      player.word = index === impostorIndex ? "🎭 IMPOSTEUR" : impostorWord;
      player.clue = null;
      player.eliminated = false;
    });

    room.currentPlayerIndex = 0;
    room.clues = [];
    room.impostorId = room.players[impostorIndex].id;
    room.roundCount = 0;

    const gameData = {
      players: room.players.map(p => ({ id: p.id, name: p.name, eliminated: p.eliminated })),
      myWord: null,
      currentPlayer: room.players[room.currentPlayerIndex].id,
      clues: [],
      impostorWord: impostorWord
    };

    room.players.forEach(player => {
      const playerData = { ...gameData };
      playerData.myWord = player.word;
      io.to(player.id).emit("gameStart", playerData);
    });

    setTimeout(() => {
      io.to(room.code).emit("turnUpdate", {
        game: gameData,
        currentPlayerName: room.players[room.currentPlayerIndex].name
      });
    }, 500);
  });

  // === ENVOYER UN INDICE ===
  socket.on("sendClue", (clue) => {
    const room = Object.values(rooms).find(r => r.players.some(p => p.id === socket.id));

    if (!room || room.gameRunning === false) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || room.players[room.currentPlayerIndex].id !== socket.id) return;

    player.clue = clue;
    room.clues.push({
      playerName: player.name,
      clue,
      isImpostor: player.id === room.impostorId
    });

    io.to(room.code).emit("clueAdded", {
      game: {
        players: room.players.map(p => ({ id: p.id, name: p.name, eliminated: p.eliminated })),
        clues: room.clues
      }
    });

    // Passer au joueur suivant
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    const nextPlayer = room.players[room.currentPlayerIndex];

    setTimeout(() => {
      // Vérifier si tous les joueurs ont parlé
      const allSpoke = room.players.every(p => p.clue !== null);

      if (allSpoke) {
        // PHASE DE VOTE
        io.to(room.code).emit("votePhase", {
          game: {
            players: room.players.map(p => ({ id: p.id, name: p.name, eliminated: p.eliminated })),
            clues: room.clues
          }
        });
      } else {
        io.to(room.code).emit("turnUpdate", {
          game: {
            players: room.players.map(p => ({ id: p.id, name: p.name, eliminated: p.eliminated })),
            clues: room.clues
          },
          currentPlayerName: nextPlayer.name
        });
      }
    }, 300);
  });

  // === VOTE ===
  socket.on("vote", (votedPlayerId) => {
    const room = Object.values(rooms).find(r => r.players.some(p => p.id === socket.id));

    if (!room) return;

    if (!room.votes) room.votes = {};
    room.votes[socket.id] = votedPlayerId;

    const allVoted = room.players.length === Object.keys(room.votes).length;

    if (allVoted) {
      // Compter les votes
      const voteCount = {};
      Object.values(room.votes).forEach(id => {
        voteCount[id] = (voteCount[id] || 0) + 1;
      });

      const mostVoted = Object.keys(voteCount).reduce((a, b) => 
        voteCount[a] > voteCount[b] ? a : b
      );

      const eliminated = room.players.find(p => p.id === mostVoted);
      eliminated.eliminated = true;

      const innocentsWon = mostVoted === room.impostorId;

      io.to(room.code).emit("gameResult", {
        impostor: room.impostorId,
        innocentsWon,
        eliminatedPlayer: eliminated.name
      });

      room.gameRunning = false;
      room.votes = {};
      room.clues = [];
      room.players.forEach(p => p.clue = null);
    }
  });

  // === GET PARTIES PUBLIQUES ===
  socket.on("getPublicRooms", () => {
    socket.emit("updatePublicRooms", getPublicRoomsList());
  });

  // === QUITTER ===
  socket.on("leaveRoom", () => {
    const room = Object.values(rooms).find(r => r.players.some(p => p.id === socket.id));

    if (room) {
      room.players = room.players.filter(p => p.id !== socket.id);

      if (room.players.length === 0) {
        delete rooms[room.code];
      } else {
        if (room.host === socket.id) {
          room.host = room.players[0].id;
          room.hostName = room.players[0].name;
        }
        io.to(room.code).emit("roomUpdate", room);
      }
    }

    socket.leave(room?.code || "");
    io.emit("updatePublicRooms", getPublicRoomsList());
  });

  socket.on("disconnect", () => {
    console.log(`❌ Joueur déconnecté: ${socket.id}`);
    const room = Object.values(rooms).find(r => r.players.some(p => p.id === socket.id));

    if (room) {
      room.players = room.players.filter(p => p.id !== socket.id);

      if (room.players.length === 0) {
        delete rooms[room.code];
      } else {
        if (room.host === socket.id) {
          room.host = room.players[0].id;
          room.hostName = room.players[0].name;
        }
        io.to(room.code).emit("roomUpdate", room);
      }
    }

    io.emit("updatePublicRooms", getPublicRoomsList());
  });
});

server.listen(3000, () => {
  console.log("🎮 Serveur démarré sur http://localhost:3000");
});
