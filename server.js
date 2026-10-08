const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname, "public")));

// Base de données en mémoire
const rooms = {}; // { code: { code, host, hostName, players, isPublic, settings, gameRunning, state, selectedCategory, ... } }
const categories = {
  movies: ["Avatar", "Inception", "Interstellar", "Matrix", "Titanic", "Forrest Gump", "Pulp Fiction"],
  sports: ["Football", "Tennis", "Basketball", "Natation", "Boxe", "Golf", "Cyclisme"],
  animals: ["Chat", "Chien", "Lion", "Aigle", "Dauphin", "Tigre", "Elephant"],
  food: ["Pizza", "Burger", "Sushi", "Pâtes", "Tacos", "Salade", "Chocolate"],
  countries: ["France", "Japon", "Brésil", "Égypte", "Canada", "Australie", "Espagne"],
  random: ["Soleil", "Lune", "Montagne", "Ocean", "Forêt", "Désert", "Volcan"]
};

// === UTILITAIRES ===
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

// === SOCKET EVENTS ===
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
      isPublic: data.quick || false, // Quick Game = public
      selectedCategory: data.category || "random",
      gameRunning: false,
      state: null,
      settings: {
        showRole: false
      }
    };

    rooms[code] = roomData;
    socket.join(code);
    socket.emit("roomUpdate", roomData);

    // Si public, notifier tous les clients
    if (roomData.isPublic) {
      io.emit("updatePublicRooms", getPublicRoomsList());
    }

    console.log(`🎮 Salle créée: ${code} (Public: ${roomData.isPublic})`);
  });

  // === REJOINDRE UNE SALLE ===
  socket.on("joinRoom", (data) => {
    const room = rooms[data.code];

    if (!room) {
      socket.emit("errorMsg", "❌ Salle introuvable");
      return;
    }

    if (room.gameRunning) {
      socket.emit("errorMsg", "❌ Partie déjà en cours");
      return;
    }

    if (room.players.some(p => p.id === socket.id)) {
      socket.emit("errorMsg", "❌ Tu es déjà dans cette salle");
      return;
    }

    // Ajouter le joueur
    room.players.push({
      id: socket.id,
      name: data.name,
      eliminated: false,
      word: null,
      clue: null
    });

    socket.join(data.code);
    io.to(data.code).emit("roomUpdate", room);

    // Si public, mettre à jour la liste
    if (room.isPublic) {
      io.emit("updatePublicRooms", getPublicRoomsList());
    }

    console.log(`➕ ${data.name} a rejoint ${data.code}`);
  });

  // === TOGGLE PUBLIC/PRIVÉ ===
  socket.on("togglePublic", (isPublic) => {
    const room = Object.values(rooms).find(r => r.host === socket.id);
    if (!room) return;

    room.isPublic = isPublic;
    io.to(room.code).emit("roomUpdate", room);
    io.emit("updatePublicRooms", getPublicRoomsList());

    console.log(`🔄 ${room.code} est maintenant ${isPublic ? "PUBLIC" : "PRIVÉ"}`);
  });

  // === OBTENIR LES SALLES PUBLIQUES ===
  socket.on("getPublicRooms", () => {
    socket.emit("updatePublicRooms", getPublicRoomsList());
  });

  // === LANCER LA PARTIE ===
  socket.on("startGame", () => {
    const room = Object.values(rooms).find(r => r.host === socket.id);
    if (!room || room.players.length < 2) return;

    room.gameRunning = true;

    // Assigner les mots
    const word = getRandomWord(room.selectedCategory);
    const impostorIndex = Math.floor(Math.random() * room.players.length);

    room.players.forEach((p, i) => {
      p.word = i === impostorIndex ? "❓ TU ES L'IMPOSTEUR" : word;
      p.eliminated = false;
      p.clue = null;
    });

    room.state = {
      phase: "game", // game, vote, result
      currentPlayerIndex: 0,
      impostorId: room.players[impostorIndex].id,
      clues: [],
      votes: {},
      winner: null,
      roundCount: 0,
      maxRounds: room.players.length
    };

    // Envoyer les infos à chaque joueur
    room.players.forEach(p => {
      const playerSocket = io.sockets.sockets.get(p.id);
      if (playerSocket) {
        playerSocket.emit("gameStart", {
          myWord: p.word,
          game: {
            code: room.code,
            players: room.players.map(pl => ({ id: pl.id, name: pl.name, eliminated: pl.eliminated })),
            currentPlayer: room.players[room.state.currentPlayerIndex].id,
            clues: room.state.clues,
            phase: "game"
          }
        });
      }
    });

    io.to(room.code).emit("turnUpdate", {
      game: {
        players: room.players.map(p => ({ id: p.id, name: p.name, eliminated: p.eliminated })),
        currentPlayer: room.players[0].id,
        clues: []
      },
      currentPlayerName: room.players[0].name
    });

    console.log(`🎮 Partie lancée: ${room.code}`);
  });

  // === ENVOYER UN MOT ===
  socket.on("sendClue", (clue) => {
    const roomCode = Array.from(socket.rooms).find(c => rooms[c]);
    const room = rooms[roomCode];
    
    if (!room || room.state.phase !== "game") return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const currentPlayer = room.players[room.state.currentPlayerIndex];
    if (currentPlayer.id !== socket.id) return;

    // Ajouter le clue
    const isImpostor = socket.id === room.state.impostorId;
    room.state.clues.push({
      playerName: player.name,
      clue: clue,
      isImpostor: isImpostor
    });

    io.to(room.code).emit("clueAdded", {
      game: {
        players: room.players.map(p => ({ id: p.id, name: p.name, eliminated: p.eliminated })),
        clues: room.state.clues
      }
    });

    // Passer au joueur suivant
    room.state.currentPlayerIndex = (room.state.currentPlayerIndex + 1) % room.players.length;
    const nextPlayer = room.players[room.state.currentPlayerIndex];
    room.state.roundCount++;

    // Vérifier si on doit passer au vote
    if (room.state.roundCount >= room.state.maxRounds) {
      room.state.phase = "vote";
      io.to(room.code).emit("votePhase", {
        game: {
          players: room.players.map(p => ({ id: p.id, name: p.name, eliminated: p.eliminated })),
          clues: room.state.clues
        }
      });
      console.log(`🗳️ Phase de vote: ${room.code}`);
    } else {
      io.to(room.code).emit("turnUpdate", {
        game: {
          players: room.players.map(p => ({ id: p.id, name: p.name, eliminated: p.eliminated })),
          currentPlayer: nextPlayer.id,
          clues: room.state.clues
        },
        currentPlayerName: nextPlayer.name
      });
    }

    console.log(`💬 ${player.name} a dit: "${clue}"`);
  });

  // === VOTER ===
  socket.on("vote", (targetId) => {
    const roomCode = Array.from(socket.rooms).find(c => rooms[c]);
    const room = rooms[roomCode];
    
    if (!room || room.state.phase !== "vote") return;

    room.state.votes[socket.id] = targetId;

    // Si tous les joueurs ont voté
    if (Object.keys(room.state.votes).length === room.players.length) {
      // Compter les votes
      const voteCount = {};
      Object.values(room.state.votes).forEach(vid => {
        voteCount[vid] = (voteCount[vid] || 0) + 1;
      });

      const mostVoted = Object.keys(voteCount).reduce((a, b) => 
        voteCount[a] > voteCount[b] ? a : b
      );

      const eliminated = room.players.find(p => p.id === mostVoted);
      if (eliminated) eliminated.eliminated = true;

      // Vérifier si l'imposteur est éliminé
      const impostorEliminated = mostVoted === room.state.impostorId;
      const innocentsWon = impostorEliminated;

      room.state.phase = "result";

      io.to(room.code).emit("gameResult", {
        impostor: room.state.impostorId,
        eliminated: mostVoted,
        innocentsWon: innocentsWon,
        word: room.players.find(p => p.id === room.state.impostorId).word,
        votes: room.state.votes
      });

      console.log(`🏁 Partie terminée: ${room.code} - Imposteur ${impostorEliminated ? "éliminé" : "gagne"}`);
    }
  });

  // === QUITTER LA SALLE ===
  socket.on("leaveRoom", () => {
    for (const code in rooms) {
      const room = rooms[code];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);

      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        socket.leave(code);

        if (room.players.length === 0) {
          delete rooms[code];
          console.log(`🗑️ Salle ${code} supprimée (vide)`);
        } else {
          // Si l'hôte part, promouvoir le premier joueur
          if (room.host === socket.id) {
            room.host = room.players[0].id;
            room.hostName = room.players[0].name;
          }

          io.to(code).emit("roomUpdate", room);
          console.log(`👋 Joueur parti de ${code}`);
        }

        // Mettre à jour la liste publique
        io.emit("updatePublicRooms", getPublicRoomsList());
        break;
      }
    }
  });

  // === RETOUR AU LOBBY ===
  socket.on("backToLobby", () => {
    for (const code in rooms) {
      const room = rooms[code];
      if (room.players.some(p => p.id === socket.id)) {
        room.gameRunning = false;
        room.state = null;
        room.players.forEach(p => {
          p.word = null;
          p.eliminated = false;
          p.clue = null;
        });

        io.to(code).emit("roomUpdate", room);
        break;
      }
    }
  });

  // === DÉCONNEXION ===
  socket.on("disconnect", () => {
    for (const code in rooms) {
      const room = rooms[code];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);

      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);

        if (room.players.length === 0) {
          delete rooms[code];
          console.log(`🗑️ Salle ${code} supprimée (déconnexion)`);
        } else {
          if (room.host === socket.id) {
            room.host = room.players[0].id;
            room.hostName = room.players[0].name;
          }

          io.to(code).emit("roomUpdate", room);
        }

        io.emit("updatePublicRooms", getPublicRoomsList());
        break;
      }
    }

    console.log(`❌ Joueur déconnecté: ${socket.id}`);
  });
});

// === DÉMARRAGE DU SERVEUR ===
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
});
