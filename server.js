const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

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

const wss = new WebSocketServer({ server });

// Chaque paire : [fr, he, en] pour le mot A et pour le mot B
const PAIRS = [
  [["Foot", "×Ũ“ŨŨ¨Ũ’Ũ", "Soccer"], ["Basket", "ŨŨŨ“ŨŨŨ", "Basketball"]],
  [["Chat", "Ũ—ŨŨŨ", "Cat"], ["Chien", "ŨŨŨ", "Dog"]],
  [["Pizza", "ŨŨŨŨ", "Pizza"], ["Burger", "ŨŨ¨Ũ’Ũ¨", "Burger"]],
  [["Plage", "ŨŨŨŨ£", "Beach"], ["Piscine", "ŨŨ¨ŨŨ", "Pool"]],
  [["CafÃĐ", "Ũ§Ũ¤Ũ”", "Coffee"], ["ThÃĐ", "ŨŨŨ", "Tea"]],
  [["Voiture", "ŨŨŨŨŨŨŨŨ", "Car"], ["Moto", "ŨŨŨŨ¢ŨŨ", "Motorcycle"]],
  [["Avion", "ŨŨŨŨŨŨ", "Airplane"], ["HÃĐlicoptÃĻre", "ŨŨŨŨ§ŨŨ¤ŨŨ¨", "Helicopter"]],
  [["Pomme", "ŨŨ¤ŨŨ", "Apple"], ["Poire", "ŨŨ’Ũ¡", "Pear"]],
  [["Lune", "ŨŨ¨Ũ—", "Moon"], ["Soleil", "Ũ©ŨŨ©", "Sun"]],
  [["Guitare", "ŨŨŨŨ¨Ũ”", "Guitar"], ["Violon", "ŨŨŨŨŨŨŨ", "Violin"]],
  [["CinÃĐma", "Ũ§ŨŨ ŨŨ", "Cinema"], ["ThÃĐÃĒtre", "ŨŨŨŨ¨ŨŨ", "Theater"]],
  [["Hiver", "Ũ—ŨŨ£", "Winter"], ["Automne", "Ũ¡ŨŨŨ", "Autumn"]],
  [["Lion", "ŨŨ¨ŨŨ”", "Lion"], ["Tigre", "Ũ ŨŨ¨", "Tiger"]],
  [["Montagne", "Ũ”Ũ¨", "Mountain"], ["Colline", "Ũ’Ũ‘Ũ¢Ũ”", "Hill"]],
  [["Fraise", "ŨŨŨ¨ŨŨ", "Strawberry"], ["Framboise", "ŨŨ ŨŨ‘ŨŨ§", "Raspberry"]],
  [["Train", "Ũ¨Ũ›ŨŨŨŨŨ", "Train"], ["MÃĐtro", "ŨŨŨ ŨŨŨ ŨŨŨ", "Subway"]],
  [["Pluie", "Ũ’Ũ©Ũ", "Rain"], ["Neige", "Ũ©ŨŨ’", "Snow"]],
  [["Chocolat", "Ũ©ŨŨ§ŨŨŨ“", "Chocolate"], ["Caramel", "Ũ§Ũ¨ŨŨŨ", "Caramel"]],
  [["Ordinateur", "ŨŨ—Ũ©ŨŨ", "Computer"], ["Tablette", "ŨŨŨŨŨ˜", "Tablet"]],
  [["Mer", "ŨŨ", "Sea"], ["Lac", "ŨŨ’Ũ", "Lake"]],
  [["Pirate", "Ũ¤ŨŨ¨Ũ˜", "Pirate"], ["Voleur", "Ũ’Ũ ŨŨ‘", "Thief"]],
  [["ChÃĒteau", "ŨŨŨ¨ŨŨ", "Castle"], ["Palais", "ŨŨŨŨ", "Palace"]],
  [["Vampire", "ŨŨŨ¤ŨŨ¨", "Vampire"], ["Zombie", "ŨŨŨŨŨ", "Zombie"]],
  [["Sushi", "Ũ¡ŨŨ©Ũ", "Sushi"], ["Raviolis", "ŨŨ¨ŨŨŨŨ", "Ravioli"]],
];

const rooms = {};

function makeCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
  } while (rooms[code]);
  return code;
}

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

function broadcast(room) {
  for (const p of room.players) {
    send(p.ws, stateFor(room, p));
  }
}

function stateFor(room, me) {
  return {
    type: "state",
    code: room.code,
    phase: room.phase,
    youId: me.id,
    hostId: room.hostId,
    myWord: room.phase !== "lobby" ? me.word : null, // [fr, he, en]
    turnIndex: room.turnIndex,
    round: room.round,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      clues: p.clues,
      voted: room.votes[p.id] !== undefined,
      word: room.phase === "result" ? p.word : undefined,
      isImpostor: room.phase === "result" ? p.isImpostor : undefined,
    })),
    result: room.phase === "result" ? room.result : null,
  };
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
}

function endVoting(room) {
  const tally = {};
  Object.values(room.votes).forEach((id) => (tally[id] = (tally[id] || 0) + 1));
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
  room.result = {
    tie,
    accusedName: accused ? accused.name : null,
    impostorName: impostor.name,
    groupWins: !tie && accused && accused.isImpostor,
  };
  room.phase = "result";
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
  } else if (room.phase === "clues") {
    if (room.turnIndex >= room.players.length) room.turnIndex = 0;
  }
  broadcast(room);
}

let nextId = 1;

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "create") {
      const name = String(msg.name || "").trim().slice(0, 16);
      if (!name) return send(ws, { type: "error", message: "needName" });
      const code = makeCode();
      const player = { id: String(nextId++), name, ws, clues: [] };
      rooms[code] = {
        code,
        hostId: player.id,
        players: [player],
        phase: "lobby",
        votes: {},
        turnIndex: 0,
        round: 1,
      };
      ws.roomCode = code;
      broadcast(rooms[code]);
      return;
    }

    if (msg.type === "join") {
      const name = String(msg.name || "").trim().slice(0, 16);
      const code = String(msg.code || "").trim().toUpperCase();
      if (!name) return send(ws, { type: "error", message: "needName" });
      const room = rooms[code];
      if (!room) return send(ws, { type: "error", message: "badCode" });
      if (room.phase !== "lobby")
        return send(ws, { type: "error", message: "alreadyStarted" });
      if (room.players.length >= 10)
        return send(ws, { type: "error", message: "roomFull" });
      if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase()))
        return send(ws, { type: "error", message: "nameTaken" });
      const player = { id: String(nextId++), name, ws, clues: [] };
      room.players.push(player);
      ws.roomCode = code;
      broadcast(room);
      return;
    }

    const room = rooms[ws.roomCode];
    if (!room) return;
    const me = room.players.find((p) => p.ws === ws);
    if (!me) return;

    if (msg.type === "start") {
      if (me.id !== room.hostId) return;
      if (room.players.length < 3)
        return send(ws, { type: "error", message: "min3" });
      startGame(room);
      broadcast(room);
    }

    if (msg.type === "clue" && room.phase === "clues") {
      if (room.players[room.turnIndex].id !== me.id) return;
      const word = String(msg.word || "").trim().slice(0, 24);
      if (!word) return;
      me.clues.push(word);
      room.turnIndex++;
      if (room.turnIndex >= room.players.length) {
        if (room.round >= 2) {
          room.phase = "voting";
        } else {
          room.round++;
          room.turnIndex = 0;
        }
      }
      broadcast(room);
    }

    if (msg.type === "vote" && room.phase === "voting") {
      if (room.votes[me.id] !== undefined) return;
      if (!room.players.some((p) => p.id === msg.target) || msg.target === me.id) return;
      room.votes[me.id] = msg.target;
      if (Object.keys(room.votes).length === room.players.length) endVoting(room);
      broadcast(room);
    }

    if (msg.type === "again") {
      if (me.id !== room.hostId) return;
      room.phase = "lobby";
      room.players.forEach((p) => (p.clues = []));
      room.votes = {};
      room.result = null;
      broadcast(room);
    }
  });

  ws.on("close", () => removePlayer(ws));
});

server.listen(PORT, () => console.log("Serveur sur le port " + PORT));
